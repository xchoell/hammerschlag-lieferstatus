import dotenv from 'dotenv';

dotenv.config();

function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  xentral: {
    // Basis-URL ohne abschließenden Slash.
    baseUrl: (process.env.XENTRAL_BASE_URL || '').replace(/\/+$/, ''),
    token: process.env.XENTRAL_API_TOKEN || '',
  },
  port: int(process.env.PORT, 3000),
  useMock: bool(process.env.USE_MOCK, true),
  trustProxy: bool(process.env.TRUST_PROXY, false),
  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: int(process.env.RATE_LIMIT_MAX, 10),
  },
  brand: {
    name: process.env.BRAND_NAME || 'Sendungsverfolgung',
    supportEmail: process.env.BRAND_SUPPORT_EMAIL || '',
    color: process.env.BRAND_COLOR || '#1a1a1a',
    // Pfad/URL zum Logo. Leer lassen -> Fallback auf Buchstaben-Kachel.
    logoUrl: process.env.BRAND_LOGO_URL ?? '/logo.svg',
  },
  // DHL Shipment Tracking - Unified API (developer.dhl.com).
  dhl: {
    apiKey: process.env.DHL_API_KEY || '',
    service: process.env.DHL_SERVICE || 'parcel-de',
    cacheTtlMs: int(process.env.DHL_CACHE_TTL_MS, 600_000),
  },
  // "Zugestellt" wird per Carrier-API bestimmt. Optionaler Fallback auf den
  // ERP-Auftragsstatus, NUR wenn der Carrier nicht abfragbar ist (Default aus).
  deliveredFallbackOnOrderStatus: bool(process.env.DELIVERED_FALLBACK_ON_ORDER_STATUS, false),
};

// Beim echten Betrieb (kein Mock) müssen Basis-URL und Token gesetzt sein.
export function assertConfig() {
  if (config.useMock) return;
  const missing = [];
  if (!config.xentral.baseUrl) missing.push('XENTRAL_BASE_URL');
  if (!config.xentral.token) missing.push('XENTRAL_API_TOKEN');
  if (missing.length) {
    throw new Error(
      `Fehlende Konfiguration: ${missing.join(', ')}. ` +
        `Setze sie in .env oder starte mit USE_MOCK=true.`,
    );
  }
}
