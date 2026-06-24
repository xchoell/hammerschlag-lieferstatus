import {
  listSalesOrders,
  listDeliveryNotes,
  listDeliveryNotesForOrder,
  getDeliveryNoteShipments,
  f,
} from './xentral.js';
import { config } from './config.js';
import { getCarrierDeliveryState } from './carriers.js';
import { mockLookup } from './mock.js';

// Die vier Kunden-Stufen, die auf der Seite angezeigt werden.
export const STAGES = ['Auftrag erhalten', 'Auftrag wird gepackt', 'Versendet', 'Zugestellt'];

const normZip = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
const normNum = (v) => String(v ?? '').trim();

// Reihenfolge der Identifier-Strategien. Jeder Eintrag: [Quelle, v3-Filter-Key].
// Deckt ab: Auftragsnummer, Bestellnummer (eigene Ref), Internetnummer (Shop),
// Lieferscheinnummer.
const STRATEGIES = [
  ['salesOrder', 'documentNumber'], // Auftragsnummer (AU-...)
  ['salesOrder', 'customerOrderNumber'], // Bestellnummer (eigene Referenz des Kunden)
  ['salesOrder', 'externalOrderNumber'], // Internetnummer (Shop-Bestellnummer)
  ['deliveryNote', 'documentNumber'], // Lieferscheinnummer (LS-...)
];

// Haupt-Einstieg. Gibt ein Status-Objekt für die View zurück, oder null.
// null bedeutet IMMER "generisch nicht gefunden" - egal ob Nummer unbekannt
// oder PLZ falsch (kein Oracle).
export async function lookupStatus(rawQuery, rawZip) {
  const query = normNum(rawQuery);
  const zip = normZip(rawZip);
  if (!query || !zip) return null;

  if (config.useMock) return mockLookup(query, zip);

  const candidate = await resolveCandidate(query, zip);
  if (!candidate) return null;
  return assembleStatus(candidate, zip);
}

// Probiert die Strategien durch, prüft den zweiten Faktor (PLZ) serverseitig
// und liefert den ersten Treffer.
async function resolveCandidate(query, zip) {
  for (const [type, key] of STRATEGIES) {
    let records = [];
    try {
      records =
        type === 'salesOrder' ? await listSalesOrders(key, query) : await listDeliveryNotes(key, query);
    } catch (err) {
      // API-Fehler nicht nach außen geben - nächste Strategie versuchen.
      console.warn(`[lookup] ${type}.${key} fehlgeschlagen: ${err.status || err.message}`);
      continue;
    }

    for (const record of records) {
      const verified = await zipMatches(type, record, zip);
      if (verified) return { type, record };
    }
  }
  return null;
}

// Zweiter Faktor: PLZ muss zur Lieferadresse passen. Vergleich in Code (nicht
// per API-Filter), damit "abweichende vs. Standard-Lieferadresse" sauber
// abgedeckt ist. Fail-closed: ist nirgends eine PLZ auffindbar, gilt es als
// nicht verifiziert (Feldnamen ggf. via `npm run probe` anpassen).
async function zipMatches(type, record, zip) {
  const zips = [];
  const ownZip = f.deliveryZip(record);
  if (ownZip) zips.push(ownZip);

  // Für Aufträge zusätzlich die PLZ der zugehörigen Lieferscheine prüfen
  // (dort steht die tatsächliche Versandadresse).
  if (type === 'salesOrder' && !ownZip) {
    try {
      const notes = await listDeliveryNotesForOrder(f.id(record));
      for (const n of notes) {
        const z = f.deliveryZip(n);
        if (z) zips.push(z);
      }
    } catch {
      /* ignorieren - dann bleibt zips ggf. leer */
    }
  }

  if (zips.length === 0) {
    console.warn(
      '[lookup] Keine PLZ im Response gefunden - Feld-Mapping prüfen (npm run probe). ' +
        'Treffer wird sicherheitshalber verworfen.',
    );
    return false;
  }
  return zips.some((z) => normZip(z) === zip);
}

// Baut aus dem Treffer das anzeigbare Status-Objekt zusammen.
async function assembleStatus(candidate, zip) {
  const { type, record } = candidate;

  let order = type === 'salesOrder' ? record : null;
  let notes = [];
  if (type === 'salesOrder') {
    notes = await safe(() => listDeliveryNotesForOrder(f.id(record)), []);
  } else {
    notes = [record];
    // Elternauftrag nachladen, damit Status/Liefertag konsistent zum
    // Auftragsnummer-Pfad sind (sonst zeigt LS-Lookup "Versendet" statt "Zugestellt").
    const soId = record.salesOrder?.id ?? record.attributes?.salesOrder?.id;
    if (soId) {
      const orders = await safe(() => listSalesOrders('id', soId), []);
      order = orders[0] || null;
    }
  }

  // Sendungen über alle Lieferscheine einsammeln.
  const shipments = [];
  let packageCount = 0;
  for (const note of notes) {
    const raw = await safe(() => getDeliveryNoteShipments(f.id(note)), []);
    for (const s of raw) {
      const extras = Array.isArray(s.additionalPackages) ? s.additionalPackages.length : 0;
      packageCount += 1 + extras;
      shipments.push({
        carrier: prettyCarrier(f.carrier(s)),
        carrierCode: f.carrier(s) || null,
        trackingNumber: f.trackingNumber(s) || null,
        trackingLink: f.trackingLink(s) || null,
        shippedAt: f.shippedAt(s) || null,
      });
    }
  }

  const hasTracking = shipments.some((s) => s.trackingNumber || s.trackingLink);
  const anyNoteSent = notes.some((n) => /sent|versendet|shipped/.test(String(f.status(n) || '').toLowerCase()));
  const shipped = hasTracking || anyNoteSent;

  // Zustellung DIREKT beim Carrier abfragen (DHL live; andere -> unbekannt).
  const states = await Promise.all(
    shipments.map((s) =>
      s.trackingNumber
        ? getCarrierDeliveryState({ carrierCode: s.carrierCode, trackingNumber: s.trackingNumber, zip })
        : Promise.resolve({ delivered: null }),
    ),
  );
  const known = states.filter((st) => st && st.delivered !== null);
  let delivered = known.length > 0 && known.every((st) => st.delivered === true);
  const deliveredAt = states.find((st) => st && st.deliveredAt)?.deliveredAt || null;

  // Optionaler Fallback auf den ERP-Status, NUR wenn kein Carrier abfragbar war.
  if (!delivered && known.length === 0 && config.deliveredFallbackOnOrderStatus) {
    const orderStatus = String(f.status(order) || f.status(record) || '').toLowerCase();
    delivered = shipped && /deliver|zugestellt|abgeschlossen|completed|closed/.test(orderStatus);
  }

  let stage = 0; // Auftrag erhalten
  if (notes.length > 0) stage = 1; // Lieferschein existiert -> wird gepackt
  if (shipped) stage = 2; // versendet / Tracking vorhanden -> Versendet
  if (delivered && shipped) stage = 3; // Carrier bestätigt -> Zugestellt

  // Liefertag: bei Zustellung das Carrier-Datum, sonst der geplante Liefertag.
  const deliveryDate =
    delivered && deliveredAt ? deliveredAt : f.deliveryDate(order) || f.deliveryDate(record) || null;

  return {
    orderNumber: f.documentNumber(order || record) || '',
    stage,
    stageLabel: STAGES[stage],
    deliveryDate,
    packageCount: packageCount || shipments.length,
    shipments,
  };
}

// Carrier-Code (z. B. "dhl_1") in einen lesbaren Namen wandeln.
function prettyCarrier(raw) {
  if (!raw) return 'Versanddienstleister';
  const key = String(raw).toLowerCase().split('_')[0];
  const map = {
    dhl: 'DHL',
    dhlversenden: 'DHL',
    dhlexpress: 'DHL Express',
    dpd: 'DPD',
    gls: 'GLS',
    ups: 'UPS',
    hermes: 'Hermes',
    fedex: 'FedEx',
    tnt: 'TNT',
    dpag: 'Deutsche Post',
    deutschepost: 'Deutsche Post',
    post: 'Post',
  };
  return map[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[lookup] Teil-Abruf fehlgeschlagen: ${err.status || err.message}`);
    return fallback;
  }
}
