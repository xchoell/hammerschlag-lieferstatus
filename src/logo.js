import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// Verwaltet ein zur Laufzeit über /admin hochgeladenes Logo. Datei liegt in
// data/ (gitignored, persistent) und wird über GET /brand/logo ausgeliefert.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const META = path.join(DATA_DIR, 'logo.json');

export const MAX_BYTES = 1024 * 1024; // 1 MB
export const MAX_WIDTH = 1000; // px – nur für Rasterformate prüfbar
const EXTS = ['png', 'jpg', 'gif', 'webp', 'svg'];

// Logo-URL, die ohne Upload gilt (.env-Default bzw. /logo.svg). Beim Import
// gelesen – also BEVOR ein Upload config.brand.logoUrl überschreibt.
const DEFAULT_LOGO_URL = config.brand.logoUrl;

let current = null; // { file, mime, v } des hochgeladenen Logos oder null

const logoUrl = (meta) => `/brand/logo?v=${meta.v || 1}`;

function readMeta() {
  try {
    return fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, 'utf8')) : null;
  } catch {
    return null;
  }
}

// Beim Start: ein zuvor hochgeladenes Logo (falls vorhanden) reaktivieren.
export function loadLogo() {
  const meta = readMeta();
  if (meta?.file && fs.existsSync(path.join(DATA_DIR, meta.file))) {
    current = meta;
    config.brand.logoUrl = logoUrl(meta);
  }
}

// Für die Serve-Route: absoluter Pfad + MIME oder null.
export function currentLogo() {
  return current ? { mime: current.mime, file: path.join(DATA_DIR, current.file) } : null;
}

// Für die Settings-Anzeige: aktuelle URL + ob ein eigenes Logo hochgeladen ist.
export function logoStatus() {
  return { url: config.brand.logoUrl, custom: !!current };
}

// Upload validieren + speichern. Rückgabe: Fehlertext (string) oder null bei Erfolg.
export function saveLogo(buffer) {
  if (!buffer?.length) return 'Keine Datei empfangen.';
  if (buffer.length > MAX_BYTES) return 'Logo ist zu groß – maximal 1 MB erlaubt.';
  const kind = detectImage(buffer);
  if (!kind) return 'Nicht unterstütztes Format. Erlaubt: PNG, JPG, GIF, WebP, SVG.';
  const w = imageWidth(buffer, kind.ext);
  if (w != null && w > MAX_WIDTH) return `Logo ist zu breit (${w}px) – maximal ${MAX_WIDTH}px erlaubt.`;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  removeFiles(); // alte Variante(n) wegräumen, damit nur ein Logo existiert
  const file = `brand-logo.${kind.ext}`;
  fs.writeFileSync(path.join(DATA_DIR, file), buffer);
  current = { file, mime: kind.mime, v: (current?.v || 0) + 1 };
  fs.writeFileSync(META, JSON.stringify(current, null, 2));
  config.brand.logoUrl = logoUrl(current);
  return null;
}

// Hochgeladenes Logo entfernen, zurück auf den Default.
export function removeLogo() {
  removeFiles();
  try {
    if (fs.existsSync(META)) fs.unlinkSync(META);
  } catch {
    /* egal */
  }
  current = null;
  config.brand.logoUrl = DEFAULT_LOGO_URL;
}

function removeFiles() {
  for (const ext of EXTS) {
    const p = path.join(DATA_DIR, `brand-logo.${ext}`);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* egal */
    }
  }
}

// ── Bild-Sniffing (Magic Bytes – Dateiendung/Client-MIME NICHT vertrauen) ────
function detectImage(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { ext: 'png', mime: 'image/png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 6 && buf.toString('ascii', 0, 4) === 'GIF8')
    return { ext: 'gif', mime: 'image/gif' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return { ext: 'webp', mime: 'image/webp' };
  const head = buf.slice(0, 512).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
  if ((head.startsWith('<?xml') || head.startsWith('<svg')) && head.includes('<svg'))
    return { ext: 'svg', mime: 'image/svg+xml' };
  return null;
}

// Pixelbreite oder null (SVG/vektoriell bzw. nicht ermittelbar -> keine Prüfung).
function imageWidth(buf, ext) {
  try {
    if (ext === 'png') return buf.readUInt32BE(16);
    if (ext === 'gif') return buf.readUInt16LE(6);
    if (ext === 'jpg') return jpegWidth(buf);
    if (ext === 'webp') return webpWidth(buf);
  } catch {
    /* defekter Header -> unbekannt */
  }
  return null;
}

function jpegWidth(buf) {
  let off = 2; // SOI (FF D8) überspringen
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = buf[off + 1];
    // SOF0..SOF15, außer DHT(C4), JPG(C8), DAC(CC): hier stehen die Maße.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return buf.readUInt16BE(off + 7); // FF Cn | len(2) | prec(1) | height(2) | width(2)
    }
    off += 2 + buf.readUInt16BE(off + 2);
  }
  return null;
}

function webpWidth(buf) {
  const fmt = buf.toString('ascii', 12, 16);
  if (fmt === 'VP8 ') return buf.readUInt16LE(26) & 0x3fff; // lossy
  if (fmt === 'VP8L') return (buf.readUInt32LE(21) & 0x3fff) + 1; // lossless
  if (fmt === 'VP8X') return ((buf[24] | (buf[25] << 8) | (buf[26] << 16)) & 0xffffff) + 1; // extended
  return null;
}
