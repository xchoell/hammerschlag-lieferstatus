import crypto from 'node:crypto';
import { config } from './config.js';
import { activeConditions, rulesNeedProductDetails, productDetails, applyConditions } from './conditions.js';
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
  listDeliveryNotesForOrder,
  getDeliveryNoteShipments,
  f,
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
// Payload = kind + Segmente + Ablaufzeit, HMAC-signiert.
function makeToken(kind, segments) {
  const payload = [kind, ...segments, Date.now() + TOKEN_TTL_MS].join(':');
  return `${b64url(payload)}.${sign(payload)}`;
}
// Gibt die Segmente (ohne kind/exp) zurück oder null.
function readToken(kind, token, segmentCount) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const payload = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return null;
  const parts = payload.split(':');
  if (parts.length !== segmentCount + 2) return null;
  const k = parts[0];
  const exp = parts[parts.length - 1];
  if (k !== kind || Number(exp) < Date.now()) return null;
  return parts.slice(1, -1);
}

// Order-Token trägt den geprüften Zustell-Status mit (Delivered-Gate wird in
// /retoure serverseitig erneut geprüft, nicht nur beim Rendern des Buttons)
// sowie das Projekt des Auftrags (Schlüssel für die Xentral-Settings, erspart
// /retoure einen zusätzlichen Auftrags-Abruf vor dem Gate).
export const orderToken = (salesOrderId, delivered = false, projectId = '') =>
  makeToken('order', [salesOrderId, delivered ? '1' : '0', projectId || '']);
export function verifyOrderToken(t) {
  const seg = readToken('order', t, 3);
  return seg ? { salesOrderId: seg[0], delivered: seg[1] === '1', projectId: seg[2] || null } : null;
}
export const labelToken = (returnId) => makeToken('label', [returnId]);
export function verifyLabelToken(t) {
  const seg = readToken('label', t, 1);
  return seg ? seg[0] : null;
}

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

// ── C1: Retoure-Zeitfenster (Frist, Bestelldatum-Sperre, Mehrfach-Limit) ─────

const toDate = (v) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Prüft das Retoure-Fenster gegen die Xentral-Settings des Projekts.
// Rückgabe: { blocked: null | 'deadline' | 'orderAge' | 'multiReturn', deadline }.
// Ohne Remote-Settings (lokaler Fallback) gibt es keine Fristen -> offen.
// deadlineBasis ist aktuell nur 'shipping' (Produktentscheid 2026-07-03);
// ohne bekanntes Versanddatum fällt die Frist aufs Auftragsdatum zurück
// (konservativ: Auftragsdatum <= Versanddatum, Frist endet also nie später).
export function assessReturnWindow({ orderDate, shippingDate, existingCount = 0 }, settings, now = new Date()) {
  const raw = settings?.raw;
  if (!raw) return { blocked: null, deadline: null, limitHours: 0 };

  const limitHours = Number(raw.orderDateLimitHours) || 0;

  const days = Number(raw.returnDeadlineDays) || 0;
  if (days > 0) {
    const basis = toDate(shippingDate) || toDate(orderDate);
    if (basis) {
      const deadline = new Date(basis.getTime() + days * 86_400_000);
      if (now > deadline) return { blocked: 'deadline', deadline, limitHours };
    }
  }

  if (limitHours > 0) {
    const ordered = toDate(orderDate);
    if (ordered) {
      const readyAt = new Date(ordered.getTime() + limitHours * 3_600_000);
      if (now < readyAt) return { blocked: 'orderAge', deadline: readyAt, limitHours };
    }
  }

  if (raw.shouldLimitToSingleReturn === true && existingCount > 0) {
    return { blocked: 'multiReturn', deadline: null, limitHours };
  }

  return { blocked: null, deadline: null, limitHours };
}

// Spätester Versandzeitpunkt des Auftrags (Fristbasis). null = nichts bekannt.
async function latestShipmentDate(salesOrderId) {
  try {
    const notes = await listDeliveryNotesForOrder(salesOrderId);
    let latest = null;
    for (const note of notes) {
      const shipments = await getDeliveryNoteShipments(note.id).catch(() => []);
      for (const s of shipments) {
        const at = toDate(f.shippedAt(s));
        if (at && (!latest || at > latest)) latest = at;
      }
    }
    return latest;
  } catch (err) {
    console.warn(`[returns] Versanddatum für ${salesOrderId} nicht ermittelbar: ${err.status || err.message}`);
    return null;
  }
}

// Retournierbare Positionen + Gründe + Retouren-Versandarten für einen Auftrag.
// locale steuert die Sprache der Rücksendegründe (Fallback DE, dann alle).
// settings = effektive Retouren-Settings (aus Xentral bzw. lokaler Fallback,
// s. xentral-settings.js); ohne Angabe greifen die lokalen config-Werte.
export async function loadReturnable(salesOrderId, locale = 'de', settings = null) {
  const order = await getSalesOrderById(salesOrderId);
  if (!order) return null;

  const rawPositions = order.positions || order.attributes?.positions || [];
  // C6 Stücklisten: mit shouldSplitBillOfMaterials werden die BOM-KINDER
  // einzeln retournierbar (Blatt-Positionen; Eltern mit Kindern fallen raus).
  // Ohne das Setting wie bisher nur Top-Level-Positionen (Kinder unsichtbar).
  const splitBom = settings?.raw?.shouldSplitBillOfMaterials === true;
  // Eltern NUR über parent-Referenzen erkennen: das v1-Feld hasChildren steht
  // (live verifiziert) fälschlich auf den KINDERN, nicht auf dem Elternteil.
  const parentIds = new Set(
    rawPositions
      .filter((p) => p.parent)
      .map((p) => String(typeof p.parent === 'object' ? p.parent?.id : p.parent)),
  );
  const isBomParent = (p) => parentIds.has(String(p.id));
  const items = rawPositions
    .filter((p) => (splitBom ? !isBomParent(p) : !p.parent) && Number(p.quantity) > 0)
    .map((p) => ({
      id: String(p.id),
      productId: pick(p, ['product.id']) || null,
      name: pick(p, ['product.name', 'name', 'product.number']) || 'Artikel',
      number: pick(p, ['product.number', 'articleNumber']) || '',
      quantity: Number(p.quantity) || 0,
      // Brutto-Einzelpreis (Feldform live verifiziert: grossRevenueSingle.amount/currency).
      price: (() => {
        const amount = Number(pick(p, ['grossRevenueSingle.amount', 'price.amount']));
        const currency = pick(p, ['grossRevenueSingle.currency', 'price.currency']) || 'EUR';
        return Number.isFinite(amount) && amount > 0 ? { amount, currency } : null;
      })(),
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

  // Sprache client-seitig filtern (Server-Filter erwartet Array-Syntax).
  // Kundensprache bevorzugt, dann DE, sonst alle (statt leerer Liste).
  const wanted = String(locale).toUpperCase();
  const inLocale = reasonsRaw.filter((r) => String(r.language || '').toUpperCase() === wanted);
  const inDe = reasonsRaw.filter((r) => String(r.language || '').toUpperCase() === 'DE');
  const reasons = (inLocale.length ? inLocale : inDe.length ? inDe : reasonsRaw).map((r) => ({
    id: String(r.id),
    designation: r.designation,
  }));

  // C2 Bedingungen: Regeln der Settings-Zeile auswerten. Produkt-Details
  // (Gewicht/Hersteller) nur nachladen, wenn Regeln sie brauchen.
  const rules = activeConditions(settings);
  if (rules.length && rulesNeedProductDetails(rules)) {
    await Promise.all(
      items.map(async (it) => {
        const detail = await productDetails(it.productId);
        it.weightKg = detail?.weightKg ?? null;
        it.manufacturer = detail?.manufacturer ?? '';
      }),
    );
  }
  const orderCtx = {
    country: pick(order, ['delivery.shippingAddress.country', 'financials.billingAddress.country']) || '',
    // Geschäftskunde: v1 mappt den Xentral-Adresstyp 'firma' auf 'company'
    // (billingAddress.type, live verifiziert).
    isB2b: ['company', 'firma'].includes(
      String(pick(order, ['financials.billingAddress.type', 'financials.billingAddress.salutation']) || '').toLowerCase(),
    ),
  };
  const conditionResult = rules.length ? applyConditions(rules, orderCtx, items) : null;
  // Ausgeschlossene Artikel: remaining=0 macht den Server-Clamp im POST
  // automatisch wirksam; die View zeigt den Regel-Hinweis.
  for (const it of items) {
    if (it.excluded) it.remaining = 0;
  }

  // Stufe A: feste Retouren-Versandart — seit B5 aus den Xentral-Settings des
  // Projekts (Fallback: lokale Config); eine useShippingMethod-Regel (C2)
  // überschreibt sie. selected=null, wenn keine konfiguriert ist oder die ID
  // keiner supportReturns-Versandart mehr entspricht.
  const configuredId = String(
    conditionResult?.shippingMethodOverrideId ?? settings?.shippingMethodId ?? config.returns?.shippingMethodId ?? '',
  );
  const selected = configuredId
    ? shippingMethods.find((m) => String(m.id) === configuredId) || null
    : null;

  // C1-Zeitfenster: Versanddatum nur nachladen, wenn eine Frist konfiguriert ist.
  const needsShippingDate = Number(settings?.raw?.returnDeadlineDays) > 0;
  const window = assessReturnWindow(
    {
      orderDate: pick(order, ['documentDate', 'orderDate', 'date', 'createdAt']),
      shippingDate: needsShippingDate ? await latestShipmentDate(salesOrderId) : null,
      existingCount: orderReturns.existing.length,
    },
    settings,
  );
  // C2 blockReturn: greift nach den C1-Gates (deren Hinweis ist spezifischer).
  if (!window.blocked && conditionResult?.blocked) {
    window.blocked = 'condition';
    window.note = conditionResult.blockedNote || '';
  }

  return {
    salesOrderId: String(salesOrderId),
    orderNumber: pick(order, ['documentNumber', 'number', 'belegnr']) || String(salesOrderId),
    // Für die Bestätigungsmail (C4): Kundenadresse aus dem Auftrag.
    customerEmail:
      pick(order, ['delivery.shippingAddress.email', 'financials.billingAddress.email', 'deliveryAddress.email']) || '',
    customerName:
      f.recipientName(order) ||
      pick(order, ['delivery.shippingAddress.name', 'financials.billingAddress.name']) ||
      '',
    items,
    reasons,
    shippingMethod: selected ? { id: String(selected.id), designation: selected.designation } : null,
    existingReturns: orderReturns.existing,
    showPrices: settings ? !!settings.showPrices : !!config.returns?.showPrices,
    window,
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
