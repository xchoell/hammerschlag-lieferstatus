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

// Schreibender Request (POST/PATCH) mit JSON-Body. Für Retoure-Anlage/Freigabe.
// WICHTIG: braucht einen PAT MIT Schreib-Scopes (siehe .env.example).
async function xentralWrite(method, path, body) {
  const res = await fetch(new URL(config.xentral.baseUrl + path), {
    method,
    headers: {
      Authorization: `Bearer ${config.xentral.token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Xentral ${res.status} bei ${method} ${path}`);
    err.status = res.status;
    err.body = text.slice(0, 500);
    throw err;
  }
  // 204/leerer Body tolerieren. Location-Header mitgeben: der V1-Create
  // antwortet mit 201 OHNE Body — die neue ID steckt nur im Location-Header.
  const text = await res.text();
  return {
    data: text ? JSON.parse(text) : {},
    location: res.headers.get('location') || '',
    status: res.status,
  };
}

// Binär-Download (Retourenlabel/-beleg als PDF oder Bild).
// Gibt { contentType, buffer } zurück.
async function xentralFetchBinary(path, accept = 'application/pdf, image/*') {
  const res = await fetch(new URL(config.xentral.baseUrl + path), {
    headers: { Authorization: `Bearer ${config.xentral.token}`, Accept: accept },
  });
  if (!res.ok) {
    const err = new Error(`Xentral ${res.status} bei ${path}`);
    err.status = res.status;
    throw err;
  }
  return {
    contentType: res.headers.get('content-type') || 'application/octet-stream',
    buffer: Buffer.from(await res.arrayBuffer()),
  };
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
// Retouren (MVP0). Generations-Mix bewusst (siehe Recherche/RETOURE.md):
//   • Lesen (Gründe, Versandarten) -> nur V1 vorhanden.
//   • Anlegen + Label -> V1 (einziger Pfad mit shippingMethod + PDF-Download).
//   • Positionen -> V1 salesOrders/{id}, damit die Position-IDs zum V1-Create passen.
// ───────────────────────────────────────────────────────────────────────────

// V1-Pagination: page[number] + page[size] sind Pflicht, size muss 10..50 sein
// (per POC verifiziert: page=1 bzw. page[size]=100 -> HTTP 400). Lädt alle Seiten.
async function paginateV1(path, extra = {}) {
  const out = [];
  for (let number = 1; number <= 50; number++) {
    const json = await xentralRequest(path, { ...extra, 'page[number]': number, 'page[size]': 50 });
    const data = json.data || [];
    out.push(...data);
    if (data.length < 50) break;
  }
  return out;
}

// Rücksendegründe. Scope: returnReason:read
// Hinweis: die Filter `project`/`language` erwarten Array-Syntax (project[]=…);
// MVP0 holt alle Gründe und filtert die Sprache client-seitig (s. returns.js).
// TODO: projekt-genaues Scoping über project[] nachrüsten.
export async function listReturnReasons() {
  return paginateV1('/api/v1/returnReasons');
}

// Versandarten, gefiltert auf supportReturns=true (= in Xentral angelegte
// Retouren-Versandarten). KEINE Zweitpflege im Portal nötig.
export async function listReturnShippingMethods() {
  const all = await paginateV1('/api/v1/shippingMethods');
  return all.filter((m) => m.supportReturns === true || m.supportReturns === 1);
}

// Einzelner Auftrag inkl. Positionen (V1). Scope: salesOrder:read
export async function getSalesOrderById(id) {
  const json = await xentralRequest(`/api/v1/salesOrders/${id}`);
  return json.data || json || null;
}

// Retoure anlegen. Scope: return:create (Schreibrecht!)
// Antwort: 201 ohne Body -> ID aus dem Location-Header (/api/v1/returns/{id}).
export async function createReturn(payload) {
  const { data, location } = await xentralWrite('POST', '/api/v1/returns', payload);
  const id = data?.data?.id ?? data?.id ?? (String(location).match(/(\d+)\/?$/) || [])[1] ?? null;
  return { id };
}

// Retoure freigeben. Scope: return:update/return:send
export async function releaseReturn(id) {
  return xentralWrite('POST', `/api/v1/returns/${id}/actions/release`, undefined);
}

// Dokumente einer Retoure (Label, Retourenbeleg, ...).
export async function listReturnDocuments(id) {
  const json = await xentralRequest(`/api/v1/returns/${id}/documents`);
  return json.data || [];
}

// Ein Dokument als Binärdatei (PDF/Bild) holen.
export async function getReturnDocument(id, documentId) {
  return xentralFetchBinary(`/api/v1/returns/${id}/documents/${documentId}`);
}

// Alle Retouren eines Auftrags (für die „bereits retourniert"-Prüfung).
// Filter-Key ist `salesOrderId` (per POC verifiziert; NICHT `salesOrder.id`).
export async function listReturnsForSalesOrder(salesOrderId) {
  const json = await xentralRequest(
    '/api/v1/returns',
    equalsFilter([['salesOrderId', salesOrderId]], { size: 50, number: 1 }),
  );
  return json.data || [];
}

// Einzelne Retoure inkl. Positionen (quantity + salesOrderPosition + product).
export async function getReturn(id) {
  const json = await xentralRequest(`/api/v1/returns/${id}`);
  return json.data || json || null;
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
