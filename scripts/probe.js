// Dump der echten API-Responses gegen die konfigurierte Xentral-Instanz.
// Zweck: die in src/xentral.js angenommenen Feldnamen (Tracking, PLZ, Liefertag)
// gegen die Realität prüfen und das Mapping bei Bedarf anpassen.
//
// Nutzung:
//   node scripts/probe.js                  -> nimmt die erste Sales Order
//   node scripts/probe.js AU-20294         -> sucht diese documentNumber
//
// Voraussetzung: XENTRAL_BASE_URL + XENTRAL_API_TOKEN in .env (USE_MOCK egal).

import { config } from '../src/config.js';

if (!config.xentral.baseUrl || !config.xentral.token) {
  console.error('Bitte XENTRAL_BASE_URL und XENTRAL_API_TOKEN in .env setzen.');
  process.exit(1);
}

async function get(path, params = {}) {
  const url = new URL(config.xentral.baseUrl + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.xentral.token}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function show(label, payload) {
  console.log('\n' + '─'.repeat(70));
  console.log(label);
  console.log('─'.repeat(70));
  console.log(JSON.stringify(payload, null, 2)?.slice(0, 4000));
}

const arg = process.argv[2];

const soParams = arg
  ? { 'filter[0][key]': 'documentNumber', 'filter[0][op]': 'equals', 'filter[0][value]': arg, 'page[size]': 1 }
  : { 'page[size]': 1 };

const so = await get('/api/v3/salesOrders', soParams);
show(`GET /api/v3/salesOrders  (status ${so.status})`, so.json);

const order = (so.json?.data || [])[0];
if (!order) {
  console.log('\nKeine Sales Order gefunden – mit anderer Nummer probieren.');
  process.exit(0);
}
console.log('\n>> Felder der Sales Order:', Object.keys(order));

const orderId = order.id ?? order.attributes?.id;
const dn = await get('/api/v3/deliveryNotes', {
  'filter[0][key]': 'salesOrder.id', 'filter[0][op]': 'equals', 'filter[0][value]': orderId, 'page[size]': 5,
});
show(`GET /api/v3/deliveryNotes?salesOrder.id=${orderId}  (status ${dn.status})`, dn.json);

const note = (dn.json?.data || [])[0];
if (note) {
  console.log('\n>> Felder des Lieferscheins:', Object.keys(note));
  const noteId = note.id ?? note.attributes?.id;
  const sh = await get(`/api/v1/deliveryNotes/${noteId}/shipments`);
  show(`GET /api/v1/deliveryNotes/${noteId}/shipments  (status ${sh.status})`, sh.json);
  const ship = (sh.json?.data || sh.json || [])[0];
  if (ship) console.log('\n>> Felder einer Sendung (Tracking hier verifizieren!):', Object.keys(ship));
}

console.log(
  '\nAbgleich: passen trackingNumber / trackingLink / carrier / zipCode / deliveryDate zu den Gettern in src/xentral.js? Wenn nicht, dort die Kandidatenliste anpassen.',
);
