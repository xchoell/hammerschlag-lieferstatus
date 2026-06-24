import { config } from './config.js';

// ───────────────────────────────────────────────────────────────────────────
// Carrier-Abstraktion: Zustellstatus DIREKT beim Versanddienstleister abfragen.
// Erster Entwurf: DHL live angebunden. DPD/GLS/UPS/Hermes sind als Stubs
// vorgesehen und liefern aktuell "unbekannt" (delivered: null) zurück.
// ───────────────────────────────────────────────────────────────────────────

// Carrier-Code aus Xentral (z. B. "dhl_1", "dhlversenden_1", "dpd_1") -> Provider.
export function detectCarrier(code) {
  const k = String(code || '').toLowerCase().split('_')[0];
  if (k.startsWith('dhl')) return 'dhl';
  if (k.startsWith('dpd')) return 'dpd';
  if (k.startsWith('gls')) return 'gls';
  if (k.startsWith('ups')) return 'ups';
  if (k.startsWith('hermes')) return 'hermes';
  if (k.startsWith('fedex')) return 'fedex';
  return 'unknown';
}

// Liefert den Zustellstatus einer Sendung.
//   delivered: true  -> Carrier bestätigt Zustellung
//   delivered: false -> Carrier kennt die Sendung, aber (noch) nicht zugestellt
//   delivered: null  -> nicht abfragbar (kein Key, anderer Carrier, Fehler) -> konservativ
export async function getCarrierDeliveryState({ carrierCode, trackingNumber, zip }) {
  if (!trackingNumber) return unknownState();
  const provider = detectCarrier(carrierCode);
  try {
    if (provider === 'dhl') return await trackDhl({ trackingNumber, zip, carrierCode });
    // TODO: DPD & Co. anbinden (eigene APIs/Keys). Bis dahin: unbekannt.
    return unknownState(`Carrier "${provider}" noch nicht angebunden`);
  } catch (err) {
    console.warn(`[carrier] ${provider} Abfrage fehlgeschlagen: ${err.status || err.message}`);
    return unknownState('Abfrage fehlgeschlagen');
  }
}

function unknownState(note) {
  return { delivered: null, statusText: null, deliveredAt: null, estimatedDeliveryAt: null, note: note || null };
}

// ── DHL Shipment Tracking - Unified API ────────────────────────────────────
// Doku: https://developer.dhl.com/api-reference/shipment-tracking
const dhlCache = new Map(); // key -> { at, value }

async function trackDhl({ trackingNumber, zip, carrierCode }) {
  if (!config.dhl.apiKey) return unknownState('kein DHL_API_KEY gesetzt');

  // DHL Express nutzt einen eigenen Service-Code, Standard-Paket sonst parcel-de.
  const service = String(carrierCode || '').toLowerCase().startsWith('dhlexpress')
    ? 'express'
    : config.dhl.service;

  const cacheKey = `${trackingNumber}|${service}|${zip || ''}`;
  const cached = dhlCache.get(cacheKey);
  if (cached && Date.now() - cached.at < config.dhl.cacheTtlMs) return cached.value;

  const url = new URL('https://api-eu.dhl.com/track/shipments');
  url.searchParams.set('trackingNumber', trackingNumber);
  if (service) url.searchParams.set('service', service);
  if (zip) url.searchParams.set('recipientPostalCode', zip); // bessere Detailtiefe für DE/NL-Pakete
  url.searchParams.set('requesterCountryCode', 'DE');
  url.searchParams.set('language', 'de');

  const res = await fetch(url, {
    headers: { 'DHL-API-Key': config.dhl.apiKey, Accept: 'application/json' },
  });
  if (!res.ok) {
    // 404 = Sendung (noch) unbekannt, 429 = Rate-Limit -> beides: unbekannt.
    const err = new Error(`DHL ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const json = await res.json();
  const sh0 = json?.shipments?.[0];
  const st = sh0?.status;
  const code = String(st?.statusCode || st?.status || '').toLowerCase();
  const delivered = /delivered|zugestellt/.test(code);
  // Voraussichtliches Lieferdatum, falls DHL es liefert (best effort - Feldname
  // je nach Produkt unterschiedlich; null = nicht vorhanden -> Fallback greift).
  const estimatedDeliveryAt = delivered
    ? null
    : sh0?.estimatedTimeOfDelivery ||
      sh0?.estimatedDeliveryTimeFrame?.estimatedThrough ||
      sh0?.estimatedDeliveryTimeFrame?.estimatedFrom ||
      sh0?.details?.estimatedDeliveryDate ||
      null;
  const value = {
    delivered,
    statusText: st?.status || st?.description || null,
    deliveredAt: delivered ? st?.timestamp || null : null,
    estimatedDeliveryAt,
    note: null,
  };
  dhlCache.set(cacheKey, { at: Date.now(), value });
  return value;
}
