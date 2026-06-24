import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, assertConfig } from './config.js';
import { lookupStatus } from './lookup.js';
import { renderForm, renderResult, renderNotFound } from './views.js';

assertConfig();

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1); // hinter Reverse-Proxy auf dem VPS

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

app.use((_req, res) => res.status(404).send(renderNotFound()));

app.listen(config.port, () => {
  console.log(
    `Lieferstatus läuft auf http://localhost:${config.port}  (Mock: ${config.useMock ? 'an' : 'aus'})`,
  );
});
