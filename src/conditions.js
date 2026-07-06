import { getProductById } from './xentral.js';

// ─────────────────────────────────────────────────────────────────────────────
// C2: Retourenbedingungen-Engine (RETURN-212).
//
// Regeln kommen als `conditions`-Collection mit der Settings-Zeile aus Xentral
// (ein Fetch, eager). Kriterien INNERHALB einer Regel sind UND-verknüpft
// (Gewicht min/max, Artikelnummer exakt oder Prefix mit *, Hersteller, Land,
// B2B-Filter); Regeln werden nach Priorität ausgewertet. Effekte:
//   excludeProduct   – passende Artikel sind nicht retournierbar
//   blockReturn      – die ganze Retoure ist nicht möglich (erste Regel zählt)
//   useShippingMethod – Retouren-Versandart wird überschrieben (erste Regel)
//
// Unbekanntes Artikelgewicht (0/fehlend) matcht KEINE Gewichtsregel —
// fail-open für den Kunden, keine ungewollten Ausschlüsse.
// ─────────────────────────────────────────────────────────────────────────────

// Die Regeln heißen API-seitig `lineItems` (Framework-Konvention für die
// Line-Items-Sektion der Xentral-Settings-Seite).
export function activeConditions(settings) {
  return (settings?.raw?.lineItems || [])
    .filter((c) => c.isActive !== false)
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0));
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const norm = (s) => String(s ?? '').trim().toLowerCase();

function hasItemCriteria(rule) {
  return !!(rule.productNumber || rule.manufacturer || num(rule.minWeightKg) !== null || num(rule.maxWeightKg) !== null);
}

// Artikelnummer: exakter Vergleich; endet das Muster auf *, gilt es als Prefix.
function matchesProductNumber(pattern, number) {
  const p = norm(pattern);
  const n = norm(number);
  if (!p) return true;
  if (p.endsWith('*')) return n.startsWith(p.slice(0, -1));
  return n === p;
}

// ctx = { country, isB2b }; item = { number, weightKg, manufacturer } oder null
// (null = nur Auftrags-Kriterien prüfen, Regel mit Artikel-Kriterien matcht nie).
export function ruleMatchesItem(rule, ctx, item) {
  if (rule.country && norm(rule.country) !== norm(ctx.country)) return false;
  if (rule.b2bFilter === 'b2b' && !ctx.isB2b) return false;
  if (rule.b2bFilter === 'b2c' && ctx.isB2b) return false;

  if (!hasItemCriteria(rule)) return true;
  if (!item) return false;

  if (rule.productNumber && !matchesProductNumber(rule.productNumber, item.number)) return false;
  if (rule.manufacturer && norm(rule.manufacturer) !== norm(item.manufacturer)) return false;

  const min = num(rule.minWeightKg);
  const max = num(rule.maxWeightKg);
  if (min !== null || max !== null) {
    const weight = num(item.weightKg);
    if (weight === null || weight <= 0) return false; // Gewicht unbekannt -> kein Match
    if (min !== null && weight < min) return false;
    if (max !== null && weight > max) return false;
  }
  return true;
}

// Nur laden, was Regeln wirklich brauchen (spart die Produkt-Detailabrufe).
export function rulesNeedProductDetails(rules) {
  return rules.some((c) => num(c.minWeightKg) !== null || num(c.maxWeightKg) !== null || c.manufacturer);
}

// Produkt-Details (Gewicht kg, Hersteller) mit In-Prozess-Cache.
const PRODUCT_TTL_MS = 10 * 60 * 1000;
const productCache = new Map();

export async function productDetails(productId) {
  if (!productId) return null;
  const key = String(productId);
  const hit = productCache.get(key);
  if (hit && Date.now() - hit.at < PRODUCT_TTL_MS) return hit.value;
  try {
    const p = await getProductById(productId);
    const value = {
      weightKg: Number(p?.measurements?.weight?.value) || 0,
      manufacturer: p?.manufacturer?.name || '',
    };
    productCache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.warn(`[conditions] Produkt ${productId} nicht ladbar: ${err.status || err.message}`);
    return null;
  }
}

// Wendet die Regeln an. Mutiert die Items (excluded/excludedNote) und liefert
// { blockedNote (null = nicht blockiert, sonst string|'' ), shippingMethodOverrideId }.
export function applyConditions(rules, ctx, items) {
  let blockedNote = null;
  let blocked = false;
  let shippingMethodOverrideId = null;

  for (const rule of rules) {
    if (rule.effect === 'excludeProduct') {
      for (const it of items) {
        if (!it.excluded && ruleMatchesItem(rule, ctx, it)) {
          it.excluded = true;
          it.excludedNote = rule.customerNote || null;
        }
      }
    } else if (rule.effect === 'blockReturn' && !blocked) {
      const match = hasItemCriteria(rule)
        ? items.some((it) => ruleMatchesItem(rule, ctx, it))
        : ruleMatchesItem(rule, ctx, null);
      if (match) {
        blocked = true;
        blockedNote = rule.customerNote || '';
      }
    } else if (rule.effect === 'useShippingMethod' && rule.shippingMethod?.id && !shippingMethodOverrideId) {
      const match = hasItemCriteria(rule)
        ? items.some((it) => !it.excluded && ruleMatchesItem(rule, ctx, it))
        : ruleMatchesItem(rule, ctx, null);
      if (match) shippingMethodOverrideId = String(rule.shippingMethod.id);
    }
  }

  return { blocked, blockedNote, shippingMethodOverrideId };
}
