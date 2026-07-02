import {
  listSalesOrders,
  listDeliveryNotes,
  listDeliveryNotesForOrder,
  getDeliveryNoteShipments,
  f,
} from './xentral.js';
import { config } from './config.js';
import { getCarrierDeliveryState, detectCarrier } from './carriers.js';
import { mockLookup } from './mock.js';

// Die vier Kunden-Stufen, die auf der Seite angezeigt werden.
export const STAGES = ['Auftrag erhalten', 'Auftrag wird gepackt', 'Versendet', 'Zugestellt'];

// Stornierte Aufträge laufen NICHT durch die normale Kette, sondern zeigen nur
// diese zwei Stufen. Wird ausschließlich bei cancelled === true verwendet.
export const CANCELLED_STAGES = ['Auftrag erhalten', 'Auftrag storniert'];

// Erkennt einen stornierten Auftrag am ERP-Status (de/en, diverse Schreibweisen).
const isCancelledStatus = (s) => /storn|cancel|abgebroch/.test(String(s ?? '').toLowerCase());

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
  return assembleGroup(candidate, zip);
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

// Zweiter Faktor: PLZ muss zu einer bekannten Adresse des Auftrags passen.
// Akzeptiert sowohl die Liefer- als auch die Rechnungs-PLZ, damit Aufträge mit
// abweichender Lieferadresse über die Stamm-PLZ gefunden werden können.
// Fail-closed: ist nirgends eine PLZ auffindbar, gilt es als nicht verifiziert.
async function zipMatches(type, record, zip) {
  const zips = f.allZips(record);

  // Für Aufträge zusätzlich die PLZ der zugehörigen Lieferscheine prüfen.
  if (type === 'salesOrder' && zips.length === 0) {
    try {
      const notes = await listDeliveryNotesForOrder(f.id(record));
      for (const n of notes) {
        zips.push(...f.allZips(n));
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

// Baut aus dem Treffer die komplette Auftragsgruppe zusammen: den getroffenen
// Auftrag PLUS alle gesplitteten Teilaufträge desselben Ursprungsauftrags.
async function assembleGroup(candidate, zip) {
  const orders = await resolveGroupOrders(candidate);

  // Fallback: Lieferschein-Treffer ohne ladbaren Elternauftrag -> Einzel-Teil
  // direkt aus dem Lieferschein bauen.
  if (orders.length === 0) {
    const part = await buildPart({ fallbackNote: candidate.record, zip });
    return finalizeGroup([part], null);
  }

  const parts = [];
  for (const order of orders) {
    parts.push(await buildPart({ order, zip }));
  }

  // Gruppen-Überschrift: die Belegnummer-Basis (z. B. "2026-201505" für die
  // Teilaufträge 2026-201505 + 2026-201505-1), sonst die Bestellnummer des Kunden.
  const groupNumber =
    docBase(f.documentNumber(orders[0])) || f.customerOrderNumber(orders[0]) || null;
  return finalizeGroup(parts, groupNumber);
}

// Belegnummer-Basis: entfernt NUR ein angehängtes Split-Suffix "-N".
// Belegnummern haben die Form "JAHR-LAUFNR" (z. B. 2026-201505); ein Split
// hängt ein weiteres "-N" mit KLEINER Laufnummer an (2026-201505-1). Nur dieses
// letzte Segment (max. 2 Stellen) entfernen - so bleibt die große LAUFNR der
// Basis erhalten. Deckt auch das einfache Schema ohne Jahr ab (200039-1 -> 200039).
function docBase(documentNumber) {
  const s = String(documentNumber ?? '');
  const m = s.match(/^(.+)-\d{1,2}$/);
  return m ? m[1] : s;
}

// Splits gehören immer demselben Kunden. Fehlt eine Kundennummer, wird nicht
// blockiert (fail-open); bei Abweichung NICHT gruppieren (fail-closed).
function sameCustomer(a, b) {
  const ca = f.customerNumber(a);
  const cb = f.customerNumber(b);
  return !ca || !cb || String(ca) === String(cb);
}

// Ermittelt alle Aufträge der Gruppe. Verankert beim getroffenen Auftrag
// (bzw. dem Elternauftrag eines Lieferschein-Treffers).
//
// Verknüpfungs-Strategien (gegen die echte Instanz verifiziert, npm run probe):
//   1. Belegnummer-Basis: gesplittete Teilaufträge tragen das Suffix "-N"
//      (200039 -> 200039-1). Das ist hier der verlässliche Split-Link.
//   2. Gemeinsame Bestell-/Internetnummer (Fallback, falls befüllt).
// Sicherheitsnetz: nur Aufträge derselben Kundennummer werden gruppiert.
async function resolveGroupOrders(candidate) {
  const { type, record } = candidate;

  let anchor = null;
  if (type === 'salesOrder') {
    anchor = record;
  } else {
    const soId = record.salesOrder?.id ?? record.attributes?.salesOrder?.id;
    if (soId) {
      const orders = await safe(() => listSalesOrders('id', soId), []);
      anchor = orders[0] || null;
    }
    if (!anchor) return []; // -> Fallback aus dem Lieferschein
  }

  const byId = new Map();
  const add = (o) => {
    const id = f.id(o);
    if (id != null && !byId.has(id) && sameCustomer(anchor, o)) byId.set(id, o);
  };
  add(anchor);

  // Strategie 1: Belegnummer-Basis + Teilaufträge -1, -2, ... (bis zur Lücke).
  const base = docBase(f.documentNumber(anchor));
  if (base) {
    const baseOrders = await safe(() => listSalesOrders('documentNumber', base), []);
    baseOrders.forEach(add);
    for (let i = 1; i <= 30; i++) {
      const partOrders = await safe(() => listSalesOrders('documentNumber', `${base}-${i}`), []);
      if (partOrders.length === 0) break; // sequentiell vergeben -> erste Lücke beendet
      partOrders.forEach(add);
    }
  }

  // Strategie 2: gemeinsame Bestellnummer des Kunden (nur falls befüllt).
  // ACHTUNG: NICHT über externalOrderNumber gruppieren - dieses Feld ist in der
  // Praxis eine nicht-eindeutige Sammelreferenz (ein Wert hängt an vielen
  // fremden Aufträgen) und führte zu massiver Falsch-Gruppierung.
  const customerOrderNumber = f.customerOrderNumber(anchor);
  if (customerOrderNumber) {
    const siblings = await safe(
      () => listSalesOrders('customerOrderNumber', customerOrderNumber, { size: 50, number: 1 }),
      [],
    );
    siblings.forEach(add);
  }

  // Stabile, nachvollziehbare Reihenfolge nach Belegnummer.
  return [...byId.values()].sort((a, b) =>
    String(f.documentNumber(a) ?? '').localeCompare(String(f.documentNumber(b) ?? ''), 'de', {
      numeric: true,
    }),
  );
}

// Baut den anzeigbaren Status EINES Auftrags (= ein Teilauftrag der Gruppe).
async function buildPart({ order = null, fallbackNote = null, zip }) {
  const record = order || fallbackNote;
  let notes = [];
  if (order) {
    notes = await safe(() => listDeliveryNotesForOrder(f.id(order)), []);
  } else if (fallbackNote) {
    notes = [fallbackNote];
  }

  // Sendungen über alle Lieferscheine einsammeln.
  const shipments = [];
  let packageCount = 0;
  for (const note of notes) {
    const raw = await safe(() => getDeliveryNoteShipments(f.id(note)), []);
    for (const s of raw) {
      const extras = Array.isArray(s.additionalPackages) ? s.additionalPackages.length : 0;
      packageCount += 1 + extras;
      const carrierCode = f.carrier(s) || null;
      const trackingNumber = f.trackingNumber(s) || null;
      shipments.push({
        carrier: prettyCarrier(carrierCode),
        carrierCode,
        trackingNumber,
        // Xentral-Link bevorzugen; sonst aus Carrier + Nummer selbst erzeugen.
        trackingLink: f.trackingLink(s) || carrierTrackingUrl(carrierCode, trackingNumber),
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

  // Storniert hat Vorrang: ein abgebrochener Auftrag zeigt NIE die normale Kette.
  const cancelled = isCancelledStatus(f.status(order) || f.status(record));

  let stage = 0; // Auftrag erhalten
  if (notes.length > 0) stage = 1; // Lieferschein existiert -> wird gepackt
  if (shipped) stage = 2; // versendet / Tracking vorhanden -> Versendet
  if (delivered && shipped) stage = 3; // Carrier bestätigt -> Zugestellt

  // Liefertag nach Priorität: zugestellt (Carrier-Ist) > Wunschlieferdatum >
  // Carrier-Voraussichtlich > berechnet (Auftragsdatum + x Werktage).
  const carrierEta = states.find((st) => st && st.estimatedDeliveryAt)?.estimatedDeliveryAt || null;
  const { date: deliveryDate, kind: deliveryDateKind } = resolveDeliveryDate({
    delivered,
    deliveredAt,
    order,
    record,
    carrierEta,
  });

  // Empfängername + Lieferadresse - bevorzugt aus dem AUFTRAG, damit die
  // (ggf. abweichende) Lieferadresse des jeweiligen Teilauftrags sichtbar bleibt.
  // Der Lieferschein dient nur als Fallback (z. B. wenn der Auftrag keine Adresse trägt).
  const recipientName = f.recipientName(order) || f.recipientName(record) || f.recipientName(notes[0]) || '';
  const deliveryAddress = f.deliveryAddress(order) || f.deliveryAddress(record) || f.deliveryAddress(notes[0]);

  // Abweichende Lieferadresse explizit kennzeichnen, damit die View sie als
  // solche labeln kann (Pflicht: muss als abweichend sichtbar sein).
  const addressIsDeviating = !!(
    f.deviatingAddress(order) ||
    f.deviatingAddress(record) ||
    f.deviatingAddress(notes[0])
  );

  // "Lieferdatum überschritten"-Hinweis (optional).
  const overdue = isOverdue({ deliveryDate, deliveryDateKind, delivered, cancelled });

  return {
    orderNumber: f.documentNumber(order || record) || '',
    // Nur echte Aufträge sind retournierbar (Lieferschein-Fallback hat keine
    // verwertbare salesOrderId für die V1-Retouren-Anlage).
    salesOrderId: order ? f.id(order) : null,
    recipientName,
    deliveryAddress,
    addressIsDeviating,
    cancelled,
    overdue,
    stage,
    stageLabel: cancelled ? 'Auftrag storniert' : STAGES[stage],
    deliveryDate,
    deliveryDateKind,
    packageCount: packageCount || shipments.length,
    shipments,
  };
}

// Fasst die Teilaufträge zur Gruppe zusammen, die an die View geht.
// `parts` ist 1..n; isSplit steuert, ob die Teilauftrags-Ansicht gezeigt wird.
// Empfänger/Adresse bleiben pro Teilauftrag erhalten (können je Split abweichen);
// auf Gruppenebene wird der erste echte Treffer als Fallback gehalten.
function finalizeGroup(parts, groupNumber) {
  parts = parts.filter(Boolean);
  if (parts.length === 0) return null;

  const recipientName = parts.find((p) => p.recipientName)?.recipientName || '';
  const deliveryAddress = parts.find((p) => p.deliveryAddress)?.deliveryAddress || null;

  return {
    groupNumber: groupNumber || parts[0].orderNumber,
    isSplit: parts.length > 1,
    recipientName,
    deliveryAddress,
    // Für die Retoure-Anmeldung: erster Teilauftrag mit echter salesOrderId.
    // MVP0 bietet Retoure auf diesen Auftrag an (Multi-Order -> TODO).
    primarySalesOrderId: parts.find((p) => p.salesOrderId)?.salesOrderId || null,
    parts,
  };
}

// True, wenn der voraussichtliche Liefertag + Karenz überschritten ist und die
// Sendung noch nicht zugestellt wurde. Prüft NUR gegen ein voraussichtliches
// Datum (nicht gegen das tatsächliche Zustelldatum).
function isOverdue({ deliveryDate, deliveryDateKind, delivered, cancelled }) {
  if (!config.deliveryOverdue.enabled) return false;
  if (cancelled || delivered) return false;
  if (!deliveryDate || deliveryDateKind === 'delivered') return false;

  const due = new Date(deliveryDate);
  if (Number.isNaN(due.getTime())) return false;
  due.setDate(due.getDate() + (config.deliveryOverdue.days || 0));
  due.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today > due;
}

// Liefertag-Priorität. Gibt { date, kind } zurück; kind steuert das Label.
//   delivered : tatsächliches Zustelldatum vom Carrier
//   wish      : Wunschlieferdatum (desiredDeliveryDate vom Auftrag)
//   carrier   : voraussichtliches Datum aus der Carrier-API
//   estimated : berechnet aus Auftragsdatum + x Werktage (Einstellung)
function resolveDeliveryDate({ delivered, deliveredAt, order, record, carrierEta }) {
  if (delivered && deliveredAt) return { date: deliveredAt, kind: 'delivered' };

  const wish = f.wishDate(order) || f.wishDate(record);
  if (wish) return { date: wish, kind: 'wish' };

  if (carrierEta) return { date: carrierEta, kind: 'carrier' };

  const days = config.expectedDeliveryWorkingDays;
  if (days > 0) {
    const computed = addWorkingDays(f.orderDate(order) || f.orderDate(record), days);
    if (computed) return { date: computed, kind: 'estimated' };
  }
  return { date: null, kind: null };
}

// Datum + n Werktage (Mo–Fr; Feiertage werden NICHT berücksichtigt).
// Gibt ISO-Datum (YYYY-MM-DD) zurück oder null.
function addWorkingDays(isoDate, n) {
  if (!isoDate || !(n > 0)) return null;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay(); // 0 = So, 6 = Sa
    if (day !== 0 && day !== 6) added += 1;
  }
  return d.toISOString().slice(0, 10);
}

// Tracking-Link aus Carrier + Sendungsnummer erzeugen, wenn Xentral keinen liefert.
// Liefert null für unbekannte Carrier oder fehlende Nummer -> dann kein Button.
function carrierTrackingUrl(carrierCode, trackingNumber) {
  if (!trackingNumber) return null;
  const n = encodeURIComponent(trackingNumber);
  const isExpress = String(carrierCode || '').toLowerCase().startsWith('dhlexpress');
  switch (detectCarrier(carrierCode)) {
    case 'dhl':
      return isExpress
        ? `https://www.dhl.com/de-de/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`
        : `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${n}`;
    case 'dpd':
      return `https://tracking.dpd.de/status/de_DE/parcel/${n}`;
    case 'gls':
      return `https://gls-group.com/DE/de/paketverfolgung?match=${n}`;
    case 'ups':
      return `https://www.ups.com/track?loc=de_DE&tracknum=${n}`;
    case 'hermes':
      return `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#${n}`;
    case 'fedex':
      return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    default:
      return null;
  }
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
