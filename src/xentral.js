import { config } from './config.js';

// ───────────────────────────────────────────────────────────────────────────
// Low-level HTTP gegen die Xentral REST-API.
// Auth: Personal Access Token als Bearer (serverseitig, nie ins Frontend).
// Doku: https://developer.xentral.com/reference/authentication
// ───────────────────────────────────────────────────────────────────────────
async function xentralRequest(path, params = {}) {
  const url = new URL(config.xentral.baseUrl + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.append(key, value);
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.xentral.token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    // Bewusst kein Detail nach außen geben - der Aufrufer mappt auf generisch.
    const body = await res.text().catch(() => '');
    const err = new Error(`Xentral ${res.status} bei ${path}`);
    err.status = res.status;
    err.body = body.slice(0, 500);
    throw err;
  }
  return res.json();
}

// v3-Filter: filter[i][key]=..&filter[i][op]=equals&filter[i][value]=..
// SICHERHEIT: ausschließlich op=equals zulassen. contains/startsWith würde
// Enumeration/Fishing über die öffentliche Seite ermöglichen.
function equalsFilter(pairs, page = { size: 5, number: 1 }) {
  const params = {};
  pairs.forEach(([key, value], i) => {
    params[`filter[${i}][key]`] = key;
    params[`filter[${i}][op]`] = 'equals';
    params[`filter[${i}][value]`] = value;
  });
  params['page[size]'] = page.size;
  params['page[number]'] = page.number;
  return params;
}

// Liste Sales Orders (v3). Scope: salesOrder:read
// https://developer.xentral.com/reference/getapi-v3-salesorders
// `page` optional: für die Teilauftrags-Gruppierung wird eine größere Seite
// gebraucht (mehrere Aufträge mit derselben Referenz).
export async function listSalesOrders(key, value, page) {
  const json = await xentralRequest('/api/v3/salesOrders', equalsFilter([[key, value]], page));
  return json.data || [];
}

// Liste Delivery Notes (v3). Scope: deliveryNote:read (Feature-Flag api-v3-delivery-notes)
// https://developer.xentral.com/reference/getapi-v3-deliverynotes
export async function listDeliveryNotes(key, value) {
  const json = await xentralRequest('/api/v3/deliveryNotes', equalsFilter([[key, value]]));
  return json.data || [];
}

export async function listDeliveryNotesForOrder(salesOrderId) {
  const json = await xentralRequest(
    '/api/v3/deliveryNotes',
    equalsFilter([['salesOrder.id', salesOrderId]], { size: 20, number: 1 }),
  );
  return json.data || [];
}

// Sendungen/Tracking eines Lieferscheins (v1).
// https://developer.xentral.com/reference/deliverynoteshipmentslist
export async function getDeliveryNoteShipments(deliveryNoteId) {
  const json = await xentralRequest(`/api/v1/deliveryNotes/${deliveryNoteId}/shipments`);
  return json.data || json || [];
}

// ───────────────────────────────────────────────────────────────────────────
// Tolerante Feld-Getter.
// Die v3/v1-Responses geben Felder mal flach, mal unter `attributes` zurück,
// und die exakten Tracking-Feldnamen sind in der öffentlichen Doku nicht
// ausgeschrieben. Diese Getter probieren mehrere Namensvarianten.
// -> Mit `npm run probe` die echten Shapes gegen die Instanz prüfen und hier
//    bei Bedarf die Kandidatenliste anpassen.
// ───────────────────────────────────────────────────────────────────────────
function deepGet(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

// Erstes Adress-Objekt mit echtem Inhalt (Name/Straße/PLZ/Ort) zurückgeben.
function pickAddress(record, paths) {
  if (!record) return null;
  for (const p of paths) {
    const v = deepGet(record, p) ?? deepGet(record.attributes || {}, p);
    if (v && typeof v === 'object' && (v.zipCode || v.street || v.city || v.name)) return v;
  }
  return null;
}

const ADDRESS_PATHS = ['effectiveAddresses.shipTo', 'deviatingShipToAddress', 'documentAddress', 'address'];

// Liest ein Feld aus dem Record - flach ODER unter attributes - über mehrere
// mögliche Pfade hinweg. Erster nicht-leerer Treffer gewinnt.
function pick(record, paths) {
  if (!record) return undefined;
  for (const p of paths) {
    const direct = deepGet(record, p);
    if (direct !== undefined && direct !== null && direct !== '') return direct;
    const attr = deepGet(record.attributes || {}, p);
    if (attr !== undefined && attr !== null && attr !== '') return attr;
  }
  return undefined;
}

// Feldpfade gegen die echte Instanz verifiziert (npm run probe / scripts/explore.mjs):
// - salesOrder: effectiveAddresses.shipTo.zipCode bzw. documentAddress.zipCode
// - shipment:   tracking.{number,link,carrier}, sentAt
export const f = {
  id: (r) => pick(r, ['id']),
  status: (r) => pick(r, ['status', 'state', 'documentStatus']),
  documentNumber: (r) => pick(r, ['documentNumber', 'number', 'belegnr']),

  // Referenznummern, über die zusammengehörige Teilaufträge verknüpft sein
  // können (Fallback zur Belegnummer-Basis). + Kundennummer als Sicherheitsnetz.
  customerOrderNumber: (r) =>
    pick(r, ['customerOrderNumber', 'customerOrderNo', 'orderNumberCustomer', 'customerReference']),
  externalOrderNumber: (r) =>
    pick(r, ['externalOrderNumber', 'internetOrderNumber', 'shopOrderNumber', 'externalReference']),
  customerNumber: (r) => pick(r, ['customerNumber']),

  // Liefer-PLZ (zur serverseitigen Prüfung des zweiten Faktors).
  // effectiveAddresses.shipTo = tatsächliche Versandadresse (deckt abweichende ab).
  deliveryZip: (r) =>
    pick(r, [
      'effectiveAddresses.shipTo.zipCode',
      'deviatingShipToAddress.zipCode',
      'documentAddress.zipCode',
      'deliveryAddress.zipCode',
      'address.zipCode',
      'zipCode',
    ]),

  // Alle PLZ des Records (Liefer- UND Rechnungsadresse) für den Zweifaktor-Check.
  // Kunde kann beide eingeben: entweder die abweichende Lieferadresse oder die Stamm-PLZ.
  allZips: (r) => {
    const paths = [
      'effectiveAddresses.shipTo.zipCode',
      'deviatingShipToAddress.zipCode',
      'effectiveAddresses.soldTo.zipCode',
      'documentAddress.zipCode',
      'deliveryAddress.zipCode',
      'address.zipCode',
      'zipCode',
    ];
    return [...new Set(paths.map((p) => pick(r, [p])).filter(Boolean))];
  },

  // Geplanter Liefertag.
  deliveryDate: (r) =>
    pick(r, ['desiredDeliveryDate', 'deliveryDate', 'estimatedDeliveryDate', 'shippingDate']),

  // Wunschlieferdatum (nur das explizite Feld) und Auftragsdatum.
  wishDate: (r) => pick(r, ['desiredDeliveryDate']),
  orderDate: (r) => pick(r, ['documentDate', 'orderDate', 'date', 'createdAt']),

  // Shipment / Tracking (tracking ist im v1-Response ein verschachteltes Objekt).
  trackingNumber: (s) => pick(s, ['tracking.number', 'trackingNumber', 'trackingNo']),
  trackingLink: (s) => pick(s, ['tracking.link', 'trackingLink', 'trackingUrl', 'trackingURL']),
  carrier: (s) => pick(s, ['tracking.carrier', 'shippingMethod.name', 'carrier', 'shippingProvider']),
  shippedAt: (s) => pick(s, ['sentAt', 'shippedAt', 'dispatchedAt', 'shippingDate']),

  // Lieferadresse (komplettes Objekt) + Name des Empfängers/Bestellers.
  deliveryAddress: (r) => pickAddress(r, ADDRESS_PATHS),

  // Explizit abweichende Lieferadresse (nur gesetzt, wenn sie von der
  // Dokument-/Stammadresse abweicht). Liefert das Adress-Objekt oder null.
  deviatingAddress: (r) => pickAddress(r, ['deviatingShipToAddress']),
  recipientName: (r) => {
    const a = pickAddress(r, ADDRESS_PATHS) || {};
    return a.contactPerson || a.name || '';
  },
};
