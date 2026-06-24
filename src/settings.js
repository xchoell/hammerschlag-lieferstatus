import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// Laufzeit-Einstellungen: überlagern die .env-Defaults und werden in
// data/settings.json persistiert (gitignored, enthält Secrets).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'settings.json');

// Über die Settings-Page editierbare Felder. key = Pfad im config-Objekt.
export const EDITABLE = [
  { key: 'xentral.baseUrl', label: 'Xentral Basis-URL', type: 'text', hint: 'z. B. https://66d6a9db98f2b.xentral.biz' },
  { key: 'xentral.token', label: 'Xentral PAT (Personal Access Token)', type: 'secret' },
  { key: 'dhl.apiKey', label: 'DHL API Key', type: 'secret' },
  { key: 'dhl.service', label: 'DHL Service-Code', type: 'text', hint: 'parcel-de, express, parcel-nl …' },
  { key: 'expectedDeliveryWorkingDays', label: 'Voraussichtl. Liefertag: Werktage nach Auftragsanlage (0 = aus)', type: 'number', hint: 'z. B. 3 – nur Fallback, wenn kein Wunsch-/Carrier-Datum vorliegt' },
  { key: 'deliveredFallbackOnOrderStatus', label: '„Zugestellt" notfalls aus ERP-Status ableiten (Demo, ohne DHL-Key)', type: 'bool' },
  { key: 'useMock', label: 'Mock-Modus (Demo-Daten statt echter Instanz)', type: 'bool' },
  { key: 'brand.name', label: 'Firmenname', type: 'text' },
  { key: 'brand.supportEmail', label: 'Support-E-Mail', type: 'text' },
  { key: 'brand.color', label: 'Akzentfarbe (HEX)', type: 'text', hint: 'z. B. #1a1a1a' },
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
export function saveSettings(body = {}) {
  const stored = readRaw();
  for (const f of EDITABLE) {
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
