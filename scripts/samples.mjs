import { config } from '../src/config.js';

async function get(path, params = {}) {
  const url = new URL(config.xentral.baseUrl + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.xentral.token}`, Accept: 'application/json' },
  });
  return res.json().catch(() => null);
}

const PRETTY = { dhl: 'DHL', dhlversenden: 'DHL', dpd: 'DPD', gls: 'GLS', ups: 'UPS', hermes: 'Hermes', fedex: 'FedEx' };
const carrier = (c) => (c ? PRETTY[String(c).toLowerCase().split('_')[0]] || c : '–');

// 1) Lieferscheine holen
const dn = await get('/api/v3/deliveryNotes', { 'page[size]': 50 });
const notes = dn?.data || [];

const rows = [];
for (const n of notes) {
  // 2) Sendungen/Tracking pro Lieferschein
  const sh = await get(`/api/v1/deliveryNotes/${n.id}/shipments`);
  const ships = sh?.data || sh || [];
  const first = Array.isArray(ships) ? ships[0] : null;
  const hasTracking = !!(first?.tracking?.number || first?.tracking?.link);

  // 3) zugehörige Auftragsnummer + Status
  let orderNr = null;
  let orderStatus = null;
  if (n.salesOrder?.id) {
    const so = await get('/api/v3/salesOrders', {
      'filter[0][key]': 'id', 'filter[0][op]': 'equals', 'filter[0][value]': n.salesOrder.id,
    });
    const o = so?.data?.[0];
    orderNr = o?.documentNumber || null;
    orderStatus = o?.status || null;
  }

  const shipped = hasTracking || /sent|shipped/.test(String(n.status).toLowerCase());
  const delivered = /completed|closed|deliver/.test(String(orderStatus).toLowerCase());
  const stage = delivered && shipped ? 'Zugestellt' : shipped ? 'Versendet' : 'Wird kommissioniert';

  rows.push({
    orderNr,
    deliveryNr: n.documentNumber,
    zip: n.documentAddress?.zipCode || '–',
    stage,
    carrier: hasTracking ? carrier(first.tracking.carrier) : '–',
    tracking: first?.tracking?.number || '–',
  });
}

// Ausgewogene Auswahl: bevorzugt Beispiele mit echtem Tracking, gemischte Stufen.
const withTracking = rows.filter((r) => r.tracking !== '–');
const komm = rows.filter((r) => r.stage === 'Wird kommissioniert');
const rest = rows.filter((r) => !withTracking.includes(r) && !komm.includes(r));

const picked = [];
const add = (arr, n) => arr.slice(0, n).forEach((r) => picked.includes(r) || picked.push(r));
add(withTracking, 5); // Versendet/Zugestellt mit Tracking
add(komm, 3); // Wird kommissioniert
add(rest, 10); // auffüllen

console.log(JSON.stringify(picked.slice(0, 10), null, 2));
