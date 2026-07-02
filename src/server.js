import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { config, assertConfig } from './config.js';
import { localeMiddleware, currentLocale, t } from './i18n.js';
import { lookupStatus } from './lookup.js';
import { loadSettings, viewSettings, saveSettings, SECTIONS, DEFAULT_SECTION } from './settings.js';
import { loadLogo, currentLogo, saveLogo, removeLogo, MAX_BYTES } from './logo.js';
import {
  orderToken,
  verifyOrderToken,
  labelToken,
  verifyLabelToken,
  loadReturnable,
  submitReturn,
  returnDocuments,
  fetchReturnDocument,
} from './returns.js';
import { listReturnShippingMethods } from './xentral.js';
import {
  renderForm,
  renderResult,
  renderNotFound,
  renderLogin,
  renderSettings,
  renderRetoure,
  renderRetoureConfirm,
  renderRetoureDone,
  renderRetoureError,
} from './views.js';

loadSettings(); // persistierte Overrides aus data/settings.json anwenden
loadLogo(); // ggf. hochgeladenes Logo reaktivieren (überschreibt brand.logoUrl)
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
// 32kb: das Retoure-Formular kann mehrere Positionen (Menge + Grund je Artikel)
// posten. Weiterhin klein genug als Missbrauchsschutz; Writes sind rate-limited.
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
// Kundensprache pro Request (?lang= > Cookie > Accept-Language > Default).
app.use(localeMiddleware);

// Rate-Limit nur auf den Lookup (Schutz gegen Enumeration der Nummern).
const lookupLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).send(
      renderForm({ error: t('form.rateLimited') }),
    ),
});

app.get('/healthz', (_req, res) => res.json({ ok: true, mock: config.useMock }));

app.get('/', (_req, res) => res.send(renderForm()));

app.post('/status', lookupLimiter, async (req, res) => {
  const { query, zip } = req.body || {};
  if (!query || !zip) {
    return res.status(400).send(renderForm({ error: t('form.missingInput'), query }));
  }
  try {
    const status = await lookupStatus(query, zip);
    if (!status) return res.status(404).send(renderNotFound());
    // Signiertes Retoure-Token: trägt den geprüften PLZ-Zweitfaktor in den
    // Retoure-Flow, ohne die PLZ erneut abzufragen. Nur für echte Aufträge.
    // Delivered-Gate: ohne Zustellung (falls aktiv) gibt es keinen Token
    // -> kein Button; der Zustell-Status wandert zusätzlich in den Token,
    // damit /retoure das Gate unabhängig erneut prüfen kann.
    if (
      status.primarySalesOrderId &&
      (!config.returns.onlyDelivered || status.primaryDelivered)
    ) {
      status.retoureToken = orderToken(status.primarySalesOrderId, !!status.primaryDelivered);
    }
    return res.send(renderResult(status));
  } catch (err) {
    // Nie Interna nach außen geben.
    console.error('[status] unerwarteter Fehler:', err);
    return res
      .status(500)
      .send(renderForm({ error: t('form.error'), query }));
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

// Logo-Upload: nur im Speicher, hartes 1-MB-Limit (multer bricht darüber ab).
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });
function parseAdminPost(req, res, next) {
  if (!isAuthed(req)) return next(); // Unauth -> Route gibt 401, kein Parsen nötig
  logoUpload.single('logo')(req, res, (err) => {
    if (err)
      req.logoError =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Logo ist zu groß – maximal 1 MB erlaubt.'
          : 'Logo-Upload fehlgeschlagen.';
    next();
  });
}

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).send(renderLogin({ error: 'Zu viele Versuche. Bitte kurz warten.' })),
});

// Hochgeladenes Logo ausliefern (CSP imgSrc 'self' erlaubt das).
app.get('/brand/logo', (_req, res) => {
  const logo = currentLogo();
  if (!logo) return res.status(404).end();
  res.type(logo.mime);
  res.sendFile(logo.file, { headers: { 'Cache-Control': 'public, max-age=300' } }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// Settings-Felder + Live-Optionen für die Retouren-Versandart-Auswahl
// (die in Xentral als Retoure markierten Versandarten, supportReturns=true).
async function buildSettingsView() {
  const fields = viewSettings();
  const sel = fields.find((f) => f.key === 'returns.shippingMethodId');
  if (sel) {
    try {
      const methods = await listReturnShippingMethods();
      sel.options = methods.map((m) => ({ value: String(m.id), label: m.designation }));
    } catch (err) {
      console.warn('[admin] Retouren-Versandarten nicht ladbar:', err.status || err.message);
      sel.options = [];
    }
  }
  return fields;
}

// Nur bekannte Sektions-IDs zulassen (Default = Allgemein).
const sectionOf = (v) => (SECTIONS.some((s) => s.id === v) ? v : DEFAULT_SECTION);

app.get('/admin', async (req, res) => {
  if (!isAuthed(req)) return res.send(renderLogin());
  const section = sectionOf(req.query.s);
  res.send(renderSettings(await buildSettingsView(), { warning: liveWarning(), section, sections: SECTIONS }));
});
app.post('/admin/login', loginLimiter, (req, res) => {
  if (!passwordOk(req.body?.password)) {
    return res.status(401).send(renderLogin({ error: 'Falsches Kennwort.' }));
  }
  res.setHeader('Set-Cookie', makeCookie());
  res.redirect('/admin');
});
app.post('/admin', parseAdminPost, async (req, res) => {
  if (!isAuthed(req)) return res.status(401).send(renderLogin({ error: 'Bitte zuerst anmelden.' }));
  const section = sectionOf(req.body?.__section);
  saveSettings(req.body || {}, section); // nur Felder der aktiven Sektion schreiben
  let error = req.logoError || null;
  if (!error && req.file) error = saveLogo(req.file.buffer);
  else if (!error && req.body?.removeLogo) removeLogo();
  res.send(
    renderSettings(await buildSettingsView(), { saved: !error, error, warning: liveWarning(), section, sections: SECTIONS }),
  );
});
app.post('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.redirect('/admin');
});

// ── Retoure-Anmeldung (MVP0) ────────────────────────────────────────────────
// Schutz: alle Retoure-Routen erfordern ein gültiges, signiertes Token aus dem
// /status-Lookup (trägt den geprüften PLZ-Zweitfaktor). Writes rate-limited.

const retoureLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).send(renderRetoureError(t('err.rateLimited'))),
});



// Schritt 1: Artikelauswahl + Gründe + Retouren-Versandart anzeigen.
app.get('/retoure', async (req, res) => {
  const verified = verifyOrderToken(req.query.t);
  if (!verified) return res.status(403).send(renderRetoureError(t('err.tokenInvalid')));
  if (config.returns.onlyDelivered && !verified.delivered)
    return res.status(403).send(renderRetoureError(t('err.notDelivered')));
  const salesOrderId = verified.salesOrderId;
  try {
    const data = await loadReturnable(salesOrderId, currentLocale());
    if (!data || data.items.length === 0)
      return res.send(renderRetoureError(t('err.noItems')));
    // Alle weiteren Fälle (alles bereits retourniert / keine Versandart /
    // bestehende Retouren mit Label) rendert renderRetoure selbst inkl. der
    // Label-Downloads bereits angemeldeter Retouren.
    return res.send(renderRetoure(data, req.query.t));
  } catch (err) {
    console.error('[retoure] laden fehlgeschlagen:', err);
    return res.status(500).send(renderRetoureError(t('err.loadFailed')));
  }
});

// Schritt 2: Retoure anlegen + freigeben, dann Label/Beleg verlinken.
app.post('/retoure', retoureLimiter, async (req, res) => {
  const verified = verifyOrderToken(req.body?.t);
  if (!verified) return res.status(403).send(renderRetoureError(t('err.tokenInvalid')));
  if (config.returns.onlyDelivered && !verified.delivered)
    return res.status(403).send(renderRetoureError(t('err.notDelivered')));
  const salesOrderId = verified.salesOrderId;
  try {
    const data = await loadReturnable(salesOrderId, currentLocale()); // erneut laden -> Mengen serverseitig validieren
    // Auswahl = für die Position wurde ein Grund gewählt (kein JS nötig).
    // Menge gegen die bestellte/gelieferte Menge clampen (keine Over-Returns).
    const selections = (data?.items || [])
      .map((item) => ({
        posId: item.id,
        // gegen die RESTmenge clampen: Bestellmenge − bereits retourniert.
        // Verhindert Mehrfach-/Über-Retoure auch bei manipuliertem POST.
        quantity: Math.max(0, Math.min(Number(req.body[`qty_${item.id}`]) || item.remaining, item.remaining)),
        reasonId: req.body[`reason_${item.id}`] || '',
      }))
      .filter((s) => s.reasonId && s.quantity > 0);
    if (!selections.some((s) => s.quantity > 0 && s.reasonId))
      return res.send(renderRetoureError(t('err.selectOne')));

    // "Ändern" aus der Zusammenfassung: zurück zur Auswahl, Werte erhalten.
    if (req.body.edit) return res.send(renderRetoure(data, req.body.t, req.body));

    // Zwischenschritt: erst die Zusammenfassung zeigen, anlegen nur mit confirm=1.
    if (req.body.confirm !== '1') return res.send(renderRetoureConfirm(data, selections, req.body.t));

    // Versandart kommt aus der Server-Config (Stufe A), NICHT aus dem Client.
    const { returnId } = await submitReturn({
      salesOrderId,
      selections,
      shippingMethodId: config.returns.shippingMethodId || '',
    });
    const docs = await returnDocuments(returnId);
    return res.send(
      renderRetoureDone({ orderNumber: data?.orderNumber, returnId, docs, token: labelToken(returnId) }),
    );
  } catch (err) {
    console.error('[retoure] anlegen fehlgeschlagen:', err);
    return res.status(500).send(renderRetoureError(t('err.createFailed')));
  }
});

// Label/Beleg streamen (token-geschützt, kein direkter Zugriff ohne gültiges Token).
app.get('/retoure/label', async (req, res) => {
  const returnId = verifyLabelToken(req.query.t);
  if (!returnId) return res.status(403).end();
  const documentId = String(req.query.doc || '').replace(/[^0-9]/g, '');
  if (!documentId) return res.status(400).end();
  try {
    const { contentType, buffer } = await fetchReturnDocument(returnId, documentId);
    res.type(contentType);
    res.setHeader('Content-Disposition', `inline; filename="retoure-${returnId}-${documentId}"`);
    return res.send(buffer);
  } catch (err) {
    console.error('[retoure/label] Download fehlgeschlagen:', err.status || err.message);
    return res.status(404).end();
  }
});

app.use((_req, res) => res.status(404).send(renderNotFound()));

app.listen(config.port, config.host, () => {
  console.log(
    `Lieferstatus läuft auf http://${config.host}:${config.port}  (Mock: ${config.useMock ? 'an' : 'aus'})`,
  );
});
