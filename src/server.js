import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, assertConfig } from './config.js';
import { lookupStatus } from './lookup.js';
import { loadSettings, viewSettings, saveSettings } from './settings.js';
import { renderForm, renderResult, renderNotFound, renderLogin, renderSettings } from './views.js';

loadSettings(); // persistierte Overrides aus data/settings.json anwenden
assertConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1); // hinter Reverse-Proxy auf dem VPS

// Statische Assets (Logo etc.) aus public/
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// Security-Header. CSP bewusst eng: nur inline-CSS (eigene <style>), keine externen Skripte.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);
app.use(express.urlencoded({ extended: false, limit: '4kb' }));

// Rate-Limit nur auf den Lookup (Schutz gegen Enumeration der Nummern).
const lookupLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).send(
      renderForm({ error: 'Zu viele Anfragen. Bitte warte einen Moment und versuche es erneut.' }),
    ),
});

app.get('/healthz', (_req, res) => res.json({ ok: true, mock: config.useMock }));

app.get('/', (_req, res) => res.send(renderForm()));

app.post('/status', lookupLimiter, async (req, res) => {
  const { query, zip } = req.body || {};
  if (!query || !zip) {
    return res.status(400).send(renderForm({ error: 'Bitte Nummer und PLZ eingeben.', query }));
  }
  try {
    const status = await lookupStatus(query, zip);
    if (!status) return res.status(404).send(renderNotFound());
    return res.send(renderResult(status));
  } catch (err) {
    // Nie Interna nach außen geben.
    console.error('[status] unerwarteter Fehler:', err);
    return res
      .status(500)
      .send(renderForm({ error: 'Es ist ein Fehler aufgetreten. Bitte versuche es später erneut.', query }));
  }
});

// ── Admin / Settings-Page ──────────────────────────────────────────────────
const sign = (v) => crypto.createHmac('sha256', config.admin.password).update(v).digest('hex');
function makeCookie() {
  const exp = String(Date.now() + config.admin.sessionTtlMs);
  const secure = config.trustProxy ? '; Secure' : '';
  return `admin=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(config.admin.sessionTtlMs / 1000)}${secure}`;
}
function cookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function isAuthed(req) {
  const token = cookie(req, 'admin');
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
function passwordOk(input) {
  const a = Buffer.from(String(input ?? ''));
  const b = Buffer.from(config.admin.password);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function liveWarning() {
  if (!config.useMock && !config.xentral.token)
    return 'Live-Modus aktiv, aber kein PAT gesetzt – Lookups schlagen fehl, bis du einen PAT hinterlegst.';
  return null;
}

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).send(renderLogin({ error: 'Zu viele Versuche. Bitte kurz warten.' })),
});

app.get('/admin', (req, res) => {
  if (!isAuthed(req)) return res.send(renderLogin());
  res.send(renderSettings(viewSettings(), { warning: liveWarning() }));
});
app.post('/admin/login', loginLimiter, (req, res) => {
  if (!passwordOk(req.body?.password)) {
    return res.status(401).send(renderLogin({ error: 'Falsches Kennwort.' }));
  }
  res.setHeader('Set-Cookie', makeCookie());
  res.redirect('/admin');
});
app.post('/admin', (req, res) => {
  if (!isAuthed(req)) return res.status(401).send(renderLogin({ error: 'Bitte zuerst anmelden.' }));
  saveSettings(req.body || {});
  res.send(renderSettings(viewSettings(), { saved: true, warning: liveWarning() }));
});
app.post('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.redirect('/admin');
});

app.use((_req, res) => res.status(404).send(renderNotFound()));

app.listen(config.port, () => {
  console.log(
    `Lieferstatus läuft auf http://localhost:${config.port}  (Mock: ${config.useMock ? 'an' : 'aus'})`,
  );
});
