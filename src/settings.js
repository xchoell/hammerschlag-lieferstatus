import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// Laufzeit-Einstellungen: überlagern die .env-Defaults und werden in
// data/settings.json persistiert (gitignored, enthält Secrets).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'settings.json');

// Sektionen der Settings-Page (linke Navigation). Reihenfolge = Anzeige.
export const SECTIONS = [
  { id: 'allgemein', label: 'Allgemein' },
  { id: 'auftragsstatus', label: 'Auftragsstatus' },
  { id: 'retouren', label: 'Retouren' },
];
export const DEFAULT_SECTION = 'allgemein';

// Über die Settings-Page editierbare Felder. key = Pfad im config-Objekt,
// section = Zuordnung zur linken Navigation.
export const EDITABLE = [
  // ── Allgemein ──────────────────────────────────────────────────────────
  { section: 'allgemein', key: 'xentral.baseUrl', label: 'Xentral Basis-URL', type: 'text', hint: 'z. B. https://66d6a9db98f2b.xentral.biz' },
  { section: 'allgemein', key: 'xentral.token', label: 'Xentral PAT (Personal Access Token)', type: 'secret' },
  { section: 'allgemein', key: 'brand.name', label: 'Firmenname', type: 'text' },
  { section: 'allgemein', key: 'brand.supportEmail', label: 'Support-E-Mail', type: 'text' },
  { section: 'allgemein', key: 'brand.color', label: 'Akzentfarbe (HEX)', type: 'text', hint: 'z. B. #1a1a1a' },
  { section: 'allgemein', key: 'brand.secondaryColor', label: 'Sekundärfarbe (HEX)', type: 'text', hint: 'für zweitrangige Elemente, z. B. #6b7280' },
  { section: 'allgemein', key: 'brand.links.shop', label: 'Shop-Link', type: 'text', hint: 'https://…' },
  { section: 'allgemein', key: 'brand.links.imprint', label: 'Impressum-Link', type: 'text', hint: 'https://…' },
  { section: 'allgemein', key: 'brand.links.terms', label: 'AGB-Link', type: 'text', hint: 'https://…' },
  { section: 'allgemein', key: 'brand.links.privacy', label: 'Datenschutz-Link', type: 'text', hint: 'https://…' },
  { section: 'allgemein', key: 'defaultLocale', label: 'Standardsprache Kundenseiten (de/en)', type: 'text', hint: 'de oder en; Besucher können per ?lang= umschalten' },
  { section: 'allgemein', key: 'useMock', label: 'Mock-Modus (Demo-Daten statt echter Instanz)', type: 'bool' },
  // ── Auftragsstatus ─────────────────────────────────────────────────────
  { section: 'auftragsstatus', key: 'dhl.apiKey', label: 'DHL API Key', type: 'secret' },
  { section: 'auftragsstatus', key: 'dhl.service', label: 'DHL Service-Code', type: 'text', hint: 'parcel-de, express, parcel-nl …' },
  { section: 'auftragsstatus', key: 'expectedDeliveryWorkingDays', label: 'Voraussichtl. Liefertag: Werktage nach Auftragsanlage (0 = aus)', type: 'number', hint: 'z. B. 3 – nur Fallback, wenn kein Wunsch-/Carrier-Datum vorliegt' },
  { section: 'auftragsstatus', key: 'deliveryOverdue.enabled', label: '„Lieferdatum überschritten"-Hinweis aktiv', type: 'bool' },
  { section: 'auftragsstatus', key: 'deliveryOverdue.days', label: 'Hinweis nach X Tagen Überschreitung', type: 'number', hint: '0 = sobald der voraussichtliche Liefertag vorbei ist' },
  { section: 'auftragsstatus', key: 'deliveredFallbackOnOrderStatus', label: '„Zugestellt" notfalls aus ERP-Status ableiten (Demo, ohne DHL-Key)', type: 'bool' },
  // ── Retouren ───────────────────────────────────────────────────────────
  { section: 'retouren', key: 'returns.shippingMethodId', label: 'Retouren-Versandart', type: 'select', hint: 'Mit dieser Versandart werden alle Retouren erstellt. Auswahl = in Xentral als Retoure markierte Versandarten (supportReturns).' },
  { section: 'retouren', key: 'returns.onlyDelivered', label: 'Retoure erst nach Zustellung erlauben', type: 'bool' },
  { section: 'retouren', key: 'returns.showPrices', label: 'Artikelpreise in der Retoure-Auswahl anzeigen', type: 'bool' },
];

// Formularfeld-Name <-> config-Pfad (Punkte sind in name-Attributen unschön).
export const fieldName = (key) => key.replace(/\./g, '__');

const getPath = (obj, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
function setPath(obj, p, v) {
  const keys = p.split('.');
  const last = keys.pop();
  const target = keys.reduce((a, k) => (a[k] ??= {}), obj);
  target[last] = v;
}

function readRaw() {
  try {
    return fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  } catch (err) {
    console.warn('[settings] settings.json nicht lesbar:', err.message);
    return {};
  }
}
function writeRaw(obj) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2));
}

// Beim Start: persistierte Overrides auf das config-Objekt legen.
export function loadSettings() {
  const stored = readRaw();
  for (const { key } of EDITABLE) if (key in stored) setPath(config, key, stored[key]);
  return stored;
}

// Aktuelle Werte fürs Formular (Secrets werden NICHT ausgegeben, nur "gesetzt?").
export function viewSettings() {
  return EDITABLE.map((f) => {
    const value = getPath(config, f.key);
    if (f.type === 'secret') return { ...f, isSet: !!value, value: '' };
    if (f.type === 'bool') return { ...f, value: !!value };
    if (f.type === 'number') return { ...f, value: Number(value) || 0 };
    return { ...f, value: value ?? '' };
  });
}

// Formular speichern: in config anwenden + persistieren.
// section (optional): nur Felder dieser Sektion schreiben — sonst würden beim
// Speichern einer Sektion die (nicht mitgesendeten) Felder anderer Sektionen
// geleert. null = alle Felder (Abwärtskompatibilität).
export function saveSettings(body = {}, section = null) {
  const stored = readRaw();
  const fields = section ? EDITABLE.filter((f) => f.section === section) : EDITABLE;
  for (const f of fields) {
    const raw = body[fieldName(f.key)];
    if (f.type === 'bool') {
      const v = raw === 'on' || raw === 'true' || raw === '1';
      setPath(config, f.key, v);
      stored[f.key] = v;
    } else if (f.type === 'secret') {
      // Leeres Feld -> bestehenden Wert beibehalten.
      if (raw && raw.trim()) {
        setPath(config, f.key, raw.trim());
        stored[f.key] = raw.trim();
      }
    } else if (f.type === 'number') {
      const n = Number.parseInt(raw, 10);
      const v = Number.isFinite(n) && n >= 0 ? n : 0;
      setPath(config, f.key, v);
      stored[f.key] = v;
    } else {
      let v = (raw ?? '').trim();
      if (f.key === 'xentral.baseUrl') v = v.replace(/\/+$/, '');
      setPath(config, f.key, v);
      stored[f.key] = v;
    }
  }
  writeRaw(stored);
}
