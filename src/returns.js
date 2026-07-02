import crypto from 'node:crypto';
import { config } from './config.js';
import {
  listReturnReasons,
  listReturnShippingMethods,
  getSalesOrderById,
  createReturn,
  releaseReturn,
  listReturnDocuments,
  getReturnDocument,
  listReturnsForSalesOrder,
  getReturn,
} from './xentral.js';

// ─────────────────────────────────────────────────────────────────────────────
// Retoure-Orchestrierung (MVP0).
//
// Sicherheit: /retoure bekommt KEINE PLZ mehr (die wurde nur beim /status-Lookup
// geprüft). Damit niemand allein mit einer Auftragsnummer Artikel sehen oder eine
// Retoure auslösen kann, signieren wir nach erfolgreichem Lookup die salesOrderId
// mit HMAC + kurzer Gültigkeit. /retoure akzeptiert nur ein gültiges Token.
// Schlüssel = PAT (serverseitiges Geheimnis, im Live-Betrieb immer gesetzt).
// ─────────────────────────────────────────────────────────────────────────────
const SECRET = config.xentral.token || 'dev-only-secret-change-me';
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 min

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sign(value) {
  return b64url(crypto.createHmac('sha256', SECRET).update(value).digest());
}

// Token über einem getaggten Payload ("order" | "label"), gegen Verwechslung.
function makeToken(kind, id) {
  const payload = `${kind}:${id}:${Date.now() + TOKEN_TTL_MS}`;
  return `${b64url(payload)}.${sign(payload)}`;
}
function readToken(kind, token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const payload = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return null;
  const [k, id, exp] = payload.split(':');
  if (k !== kind || Number(exp) < Date.now()) return null;
  return id;
}

export const orderToken = (salesOrderId) => makeToken('order', salesOrderId);
export const verifyOrderToken = (t) => readToken('order', t);
export const labelToken = (returnId) => makeToken('label', returnId);
export const verifyLabelToken = (t) => readToken('label', t);

// ── tolerante Getter (V1-salesOrder-Shape) ─────────────────────────────────
const dg = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const pick = (r, paths) => {
  for (const p of paths) {
    const v = dg(r, p) ?? dg(r?.attributes || {}, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

// Lädt einmalig alle NICHT-stornierten Retouren des Auftrags und liefert:
//  - byPosition: je salesOrderPosition.id die bereits retournierte Menge
//    (Matching über salesOrderPosition.id; manuelle Retouren ohne Positionsbezug
//     noch nicht erfasst -> TODO product.id-Fallback)
//  - existing:   je Retoure Belegdaten + Dokumente (Label) inkl. Download-Token
async function loadReturnsForOrder(salesOrderId) {
  const list = await listReturnsForSalesOrder(salesOrderId);
  const active = list.filter((r) => !/storn|cancel/i.test(String(r.status || '')));
  const byPosition = new Map();
  const existing = [];
  for (const r of active) {
    const [full, docs] = await Promise.all([
      getReturn(r.id).catch(() => null),
      listReturnDocuments(r.id).catch(() => []),
    ]);
    for (const p of full?.positions || []) {
      const posId = p.salesOrderPosition?.id;
      if (posId == null) continue;
      const key = String(posId);
      byPosition.set(key, (byPosition.get(key) || 0) + (Number(p.quantity) || 0));
    }
    existing.push({
      returnId: String(r.id),
      documentNumber: r.documentNumber || full?.documentNumber || '',
      status: r.status || full?.status || '',
      labelToken: labelToken(String(r.id)),
      documents: (docs || []).map((d) => ({
        id: String(d.id),
        filename: d.currentVersion?.filename || '',
        keyword: d.keyword || '',
        title: d.title || '',
      })),
    });
  }
  return { byPosition, existing };
}

// Retournierbare Positionen + Gründe + Retouren-Versandarten für einen Auftrag.
export async function loadReturnable(salesOrderId) {
  const order = await getSalesOrderById(salesOrderId);
  if (!order) return null;

  const rawPositions = order.positions || order.attributes?.positions || [];
  // MVP0: Top-Level-Positionen mit echter Artikelmenge. Stücklisten-Kinder
  // (parent gesetzt) bleiben außen vor -> TODO (Stücklisten-Aufteilung).
  const items = rawPositions
    .filter((p) => !p.parent && Number(p.quantity) > 0)
    .map((p) => ({
      id: String(p.id),
      name: pick(p, ['product.name', 'name', 'product.number']) || 'Artikel',
      number: pick(p, ['product.number', 'articleNumber']) || '',
      quantity: Number(p.quantity) || 0,
    }));

  const [reasonsRaw, shippingMethods, orderReturns] = await Promise.all([
    listReturnReasons(),
    listReturnShippingMethods(),
    loadReturnsForOrder(salesOrderId),
  ]);

  // Restmenge je Position = Bestellmenge − bereits retourniert. remaining<=0 ->
  // Artikel ist vollständig retourniert (View graut ihn aus, Server lehnt ab).
  for (const it of items) {
    it.returned = orderReturns.byPosition.get(it.id) || 0;
    it.remaining = Math.max(0, it.quantity - it.returned);
  }

  // Sprache client-seitig filtern (Server-Filter erwartet Array-Syntax). DE
  // bevorzugt; fällt nichts an, alle Gründe zeigen (statt leerer Liste).
  const de = reasonsRaw.filter((r) => String(r.language || '').toUpperCase() === 'DE');
  const reasons = (de.length ? de : reasonsRaw).map((r) => ({ id: String(r.id), designation: r.designation }));

  // Stufe A: feste Retouren-Versandart aus der Konfiguration (/admin) — der
  // Endkunde wählt nicht mehr. selected=null, wenn (noch) keine konfiguriert ist
  // oder die ID keiner supportReturns-Versandart mehr entspricht.
  const configuredId = String(config.returns?.shippingMethodId || '');
  const selected = configuredId
    ? shippingMethods.find((m) => String(m.id) === configuredId) || null
    : null;

  return {
    salesOrderId: String(salesOrderId),
    orderNumber: pick(order, ['documentNumber', 'number', 'belegnr']) || String(salesOrderId),
    items,
    reasons,
    shippingMethod: selected ? { id: String(selected.id), designation: selected.designation } : null,
    existingReturns: orderReturns.existing,
  };
}

// Legt die Retoure an und gibt sie frei. selections: [{posId, quantity, reasonId}].
export async function submitReturn({ salesOrderId, selections, shippingMethodId }) {
  const positions = selections
    .filter((s) => s.posId && Number(s.quantity) > 0 && s.reasonId)
    .map((s) => ({ id: String(s.posId), quantity: Number(s.quantity), returnReason: { id: String(s.reasonId) } }));
  if (positions.length === 0) throw new Error('Keine gültige Position ausgewählt.');

  const payload = { salesOrder: { id: String(salesOrderId), positions } };
  if (shippingMethodId) payload.shippingMethod = { id: String(shippingMethodId) };

  const created = await createReturn(payload);
  const returnId = String(created.id ?? created.data?.id ?? '');
  if (!returnId) throw new Error('Retoure ohne ID zurückgekommen.');

  // Freigabe (Label-Erzeugung ist hieran gekoppelt — siehe POC/RETOURE.md).
  // Schlägt sie fehl, bleibt die Retoure als Entwurf bestehen -> nicht hart abbrechen.
  try {
    await releaseReturn(returnId);
  } catch (err) {
    console.warn(`[returns] Freigabe von ${returnId} fehlgeschlagen: ${err.status || err.message}`);
  }
  return { returnId };
}

// Dokumente (Label/Beleg) einer Retoure auflisten — fürs Done-Page-Linking.
export async function returnDocuments(returnId) {
  try {
    const docs = await listReturnDocuments(returnId);
    return docs.map((d) => ({
      id: String(d.id),
      title: d.title || d.keyword || 'Dokument',
      keyword: d.keyword || '',
      filename: d.currentVersion?.filename || '',
    }));
  } catch (err) {
    console.warn(`[returns] Dokumente von ${returnId} nicht abrufbar: ${err.status || err.message}`);
    return [];
  }
}

// Ein Dokument als { contentType, buffer } (zum Streamen).
export function fetchReturnDocument(returnId, documentId) {
  return getReturnDocument(returnId, documentId);
}
