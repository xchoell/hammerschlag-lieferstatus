import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pro-Projekt-Frontend: Request-Kontext für /p/<slug>/… (AsyncLocalStorage,
// gleiches Muster wie die Locale in i18n.js). Ohne Kontext (unpräfixte Routen)
// verhält sich alles wie bisher: leerer Pfad-Präfix, Branding aus config.
// ─────────────────────────────────────────────────────────────────────────────

const store = new AsyncLocalStorage();

// ctx = { slug, settings } — settings ist die gemappte Xentral-Zeile
// (getSettingsBySlug in xentral-settings.js).
export function runWithPortal(ctx, fn) {
  return store.run(ctx, fn);
}

export function currentPortal() {
  return store.getStore() || null;
}

// Interner Link unter dem aktiven Projekt-Präfix ('' ohne Kontext).
// portalPath('/retoure') -> '/p/hammerschlag/retoure' bzw. '/retoure'.
export function portalPath(path = '/') {
  const slug = store.getStore()?.slug;
  if (!slug) return path;
  return path === '/' ? `/p/${slug}` : `/p/${slug}${path}`;
}

// Effektives Branding: Projekt-Settings aus Xentral überlagern die lokalen
// config.brand-Werte feldweise (leere Felder fallen auf lokal zurück).
// Logo bleibt vorerst global (B0-Entscheid: Logo-Upload lebt im Portal).
export function currentBrand() {
  const raw = store.getStore()?.settings?.raw || null;
  const b = config.brand;
  if (!raw) return b;
  return {
    name: raw.shopName || b.name,
    supportEmail: raw.serviceEmail || b.supportEmail,
    color: raw.accentColor || b.color,
    secondaryColor: raw.secondaryColor || b.secondaryColor,
    logoUrl: b.logoUrl,
    links: {
      shop: raw.shopLink || b.links.shop,
      imprint: raw.imprintLink || b.links.imprint,
      terms: raw.termsLink || b.links.terms,
      privacy: raw.privacyLink || b.links.privacy,
    },
  };
}
