import { config } from './config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Retouren-Settings aus Xentral (Option B).
//
// Quelle ist die Business Entity `returnsPortalSetting` (eine Zeile pro
// Projekt), gelesen über die Entity-API der Instanz:
//   GET /api/entity/returnsPortalSetting?filter[0][key]=project&…
// Auth wie alle anderen Calls per PAT; benötigter Scope (wenn die Instanz
// Scope-Durchsetzung aktiv hat): entity:returnsPortalSetting:read.
// Details + verifizierte Auth-Matrix: RETOURE.md, Abschnitt "Settings aus Xentral".
//
// Verhalten (DoD B5):
//   • Cache pro Projekt (~60 s) -> Änderungen in Xentral wirken ohne Neustart.
//   • API-Fehler: letzter bekannter Stand, sonst lokale .env-/settings.json-Werte
//     -> ein Ausfall der Settings-API bricht weder Lieferstatus noch Retoure.
//   • Keine Settings-Zeile fürs Projekt -> lokale Werte (Bootstrap-Verhalten).
//   • Zeile mit isActive=false -> Retourenportal für das Projekt bewusst AUS.
// ─────────────────────────────────────────────────────────────────────────────

const cache = new Map(); // projectId -> { at, value }

const apiBase = () => config.returnsSettingsApi.baseUrl || config.xentral.baseUrl;
const apiToken = () => config.returnsSettingsApi.token || config.xentral.token;

// Lokale Werte (.env + data/settings.json) als Fallback-Quelle.
function localSettings() {
  return {
    source: 'local',
    active: true,
    shippingMethodId: String(config.returns.shippingMethodId || ''),
    onlyDelivered: !!config.returns.onlyDelivered,
    showPrices: !!config.returns.showPrices,
    raw: null,
  };
}

// Entity-Zeile -> Portal-Shape. `raw` behält alle Felder (returnDeadlineDays,
// deadlineBasis, shouldLimitToSingleReturn, …) für die kommenden Gates (C1 ff.).
function mapRemote(row) {
  return {
    source: 'xentral',
    active: row.isActive === true,
    projectId: row.project?.id ? String(row.project.id) : '',
    urlSlug: row.urlSlug || '',
    shippingMethodId: row.shippingMethod?.id ? String(row.shippingMethod.id) : '',
    onlyDelivered: row.shouldRequireDelivery !== false,
    showPrices: row.shouldShowPrices === true,
    // Zweitfaktor im Kunden-Login (zip|email|customerNumber); Validierung
    // gegen die bekannten Varianten macht currentLoginVariant().
    loginVariant: row.loginVariant || 'zip',
    // Projekt-Gate fürs Pro-Projekt-Frontend: Aufträge fremder Projekte sind
    // unter diesem Portal nicht auffindbar (Default an).
    restrictToProject: row.shouldRestrictToProjectOrders !== false,
    raw: row,
  };
}

async function fetchRemote(filterKey, filterValue) {
  const url = new URL(apiBase() + '/api/entity/returnsPortalSetting');
  url.searchParams.set('filter[0][key]', filterKey);
  url.searchParams.set('filter[0][op]', 'equals');
  url.searchParams.set('filter[0][value]', String(filterValue));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken()}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const err = new Error(`Settings-API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return (json.data || [])[0] || null;
}

// Effektive Retouren-Settings für ein Projekt. Wirft nie - im Zweifel lokal.
export async function getReturnsSettings(projectId) {
  if (config.useMock || !config.returnsSettingsApi.enabled || !apiBase() || !apiToken()) {
    return localSettings();
  }
  // Ohne Projekt (z. B. Auftrag ohne Projektzuordnung) gibt es keine Zeile zum
  // Nachschlagen -> lokale Werte.
  if (!projectId) return localSettings();

  const key = String(projectId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < config.returnsSettingsApi.cacheTtlMs) return hit.value;

  try {
    const row = await fetchRemote('project', key);
    const value = row ? mapRemote(row) : localSettings();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.warn(
      `[settings-sync] Xentral-Settings für Projekt ${key} nicht ladbar (${err.status || err.message}) – ` +
        (hit ? 'nutze letzten bekannten Stand.' : 'nutze lokale Werte.'),
    );
    // Fehler-Backoff: Stale-Eintrag re-stempeln, damit erst nach Ablauf der TTL
    // erneut gegen die API gelaufen wird (kein Hammering bei Dauerausfall).
    const value = hit ? hit.value : localSettings();
    cache.set(key, { at: Date.now(), value });
    return value;
  }
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Settings-Zeile zum Portal-Slug (/p/<slug>/…). null = kein solches Portal
// (-> 404). Anders als getReturnsSettings gibt es hier KEINEN lokalen
// Fallback — ein Slug existiert nur remote; bei API-Fehlern hält der
// Stale-Cache laufende Portale am Leben.
export async function getSettingsBySlug(slug) {
  if (config.useMock || !config.returnsSettingsApi.enabled || !apiBase() || !apiToken()) return null;
  if (!slug || !SLUG_RE.test(slug) || slug.length > 64) return null;

  const key = `slug:${slug}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < config.returnsSettingsApi.cacheTtlMs) return hit.value;

  try {
    const row = await fetchRemote('urlSlug', slug);
    // Auch "nicht gefunden" cachen — schützt vor Slug-Scans.
    const value = row ? mapRemote(row) : null;
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.warn(
      `[settings-sync] Portal-Settings für Slug "${slug}" nicht ladbar (${err.status || err.message}) – ` +
        (hit ? 'nutze letzten bekannten Stand.' : 'Portal nicht erreichbar.'),
    );
    const value = hit ? hit.value : null;
    cache.set(key, { at: Date.now(), value });
    return value;
  }
}

// Für Tests/Diagnose: Cache leeren.
export function clearSettingsCache() {
  cache.clear();
}
