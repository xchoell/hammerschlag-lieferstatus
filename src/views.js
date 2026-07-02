import { config } from './config.js';
import { STAGES, CANCELLED_STAGES } from './lookup.js';
import { logoStatus } from './logo.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Fasst die Versanddienstleister der Sendungen zusammen, z. B. " · 1× DHL, 1× DPD".
// Ein einzelner Dienstleister wird ohne Anzahl gezeigt (die steckt schon in "X Paket(e)").
// Bei mehr als MAX_CARRIERS verschiedenen Dienstleistern wird mit "… u. a." gekürzt.
const MAX_CARRIERS = 2;
function carrierSummary(shipments) {
  const counts = new Map();
  for (const sh of shipments) {
    if (!sh.carrier) continue;
    counts.set(sh.carrier, (counts.get(sh.carrier) || 0) + 1);
  }
  const entries = [...counts.entries()];
  if (entries.length === 0) return '';
  const parts =
    entries.length === 1
      ? [esc(entries[0][0])]
      : entries.slice(0, MAX_CARRIERS).map(([name, n]) => `${n}× ${esc(name)}`);
  const more = entries.length > MAX_CARRIERS ? ' … u. a.' : '';
  return ' · ' + parts.join(', ') + more;
}

const brand = config.brand;

function layout(title, body, opts = {}) {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · ${esc(brand.name)}</title>
<style>
  :root { --accent: ${esc(brand.color)}; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f4f5; color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5; }
  .wrap { max-width: 420px; margin: 0 auto; padding: 24px 16px 48px; }
  .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 16px; overflow: hidden; }
  .head { display: flex; align-items: center; gap: 10px; padding: 16px 18px; border-bottom: 1px solid #eee; }
  .head--logo { flex-direction: column; align-items: flex-start; gap: 8px; }
  .logo { width: 32px; height: 32px; border-radius: 8px; background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center; font-weight: 600; }
  .logo-img { width: 100%; height: auto; display: block; }
  .head b { font-size: 14px; display: block; }
  .body { padding: 20px 18px; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  p.sub { color: #6b7280; font-size: 13px; margin: 0 0 18px; }
  label { display: block; font-size: 13px; font-weight: 500; margin: 14px 0 6px; }
  input { width: 100%; height: 44px; padding: 0 12px; font-size: 16px; border: 1px solid #d1d5db;
    border-radius: 10px; background: #fff; }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(0,0,0,.06); }
  button { width: 100%; height: 46px; margin-top: 20px; border: 0; border-radius: 10px;
    background: var(--accent); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:active { transform: scale(.99); }
  .hint { font-size: 12px; color: #6b7280; margin-top: 16px; }
  .hint ul { margin: 6px 0 0; padding-left: 18px; }
  .label-row { display: flex; align-items: center; gap: 6px; margin: 14px 0 6px; }
  .label-row label { margin: 0; }
  .info { position: relative; display: inline-flex; cursor: help; }
  .info-ic { width: 16px; height: 16px; border-radius: 50%; border: 1px solid #9ca3af;
    color: #6b7280; font-size: 11px; font-weight: 600; line-height: 1;
    display: flex; align-items: center; justify-content: center; }
  .info-pop { position: absolute; left: 0; top: 24px; z-index: 10; width: 240px;
    background: #1f2937; color: #fff; font-size: 12px; font-weight: 400; line-height: 1.45;
    padding: 10px 12px; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.18);
    opacity: 0; visibility: hidden; transition: opacity .12s; }
  .info-pop ul { margin: 6px 0 0; padding-left: 16px; }
  .info:hover .info-pop, .info:focus .info-pop, .info:focus-within .info-pop {
    opacity: 1; visibility: visible; }
  .err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; font-size: 13px;
    border-radius: 10px; padding: 10px 12px; margin-bottom: 16px; }
  .ok { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; font-size: 13px;
    border-radius: 10px; padding: 10px 12px; margin-bottom: 16px; }
  .chk { display: flex; align-items: flex-start; gap: 8px; font-weight: 400; font-size: 14px; margin: 16px 0 0; }
  .chk input { width: auto; height: auto; margin-top: 2px; }
  .logo-preview { text-align: center; padding: 14px; }
  .logo-preview img { max-height: 60px; max-width: 100%; display: inline-block; }
  input.file { height: auto; padding: 9px 12px; font-size: 13px; }
  button.ghost { background: transparent; color: #6b7280; border: 1px solid #d1d5db; margin-top: 10px; }
  .statusline { display: flex; align-items: center; gap: 8px; margin: 6px 0 18px; }
  .statusline .dot { font-size: 22px; }
  .statusline b { font-size: 18px; }
  .steps { margin: 0 0 18px; }
  .step { display: flex; gap: 12px; }
  .step .rail { display: flex; flex-direction: column; align-items: center; }
  .step .bullet { width: 18px; height: 18px; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; font-size: 11px; color: #fff; flex: none; }
  .step .line { width: 2px; flex: 1; min-height: 22px; }
  .step .txt { padding-bottom: 10px; }
  .step .txt b { font-size: 13px; font-weight: 500; }
  .step .txt span { display: block; font-size: 11px; color: #6b7280; }
  .done .bullet { background: #16a34a; } .done .line { background: #16a34a; }
  .current .bullet { background: var(--accent); } .current .line { background: #e5e7eb; }
  .current .txt b { color: var(--accent); }
  .todo .bullet { background: #fff; border: 2px solid #d1d5db; } .todo .line { background: #e5e7eb; }
  .todo .txt b { color: #9ca3af; font-weight: 400; }
  .cancelled .bullet { background: #dc2626; } .cancelled .line { background: #dc2626; }
  .cancelled .txt b { color: #dc2626; }
  .eta { background: #f9fafb; border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; }
  .eta small { color: #6b7280; font-size: 11px; display: block; }
  .eta b { font-size: 15px; }
  .eta--deviating { background: #fffbeb; border: 1px solid #fde68a; }
  .eta--deviating small { color: #92400e; font-weight: 600; }
  .track { display: block; text-align: center; text-decoration: none; background: var(--accent);
    color: #fff; padding: 13px; border-radius: 10px; font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  .btn-outline { display: block; text-align: center; text-decoration: none; background: #fff;
    border: 1px solid var(--accent); color: var(--accent); padding: 12px; border-radius: 10px;
    font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  select { width: 100%; height: 44px; padding: 0 12px; font-size: 16px; border: 1px solid #d1d5db;
    border-radius: 10px; background: #fff; }
  .group-summary { font-size: 12px; color: #6b7280; margin: 0 0 16px; }
  .part { border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 14px 4px; margin-bottom: 14px; }
  .part-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
  .part-head b { font-size: 15px; }
  .part-tag { font-size: 11px; font-weight: 600; color: #fff; background: var(--accent);
    border-radius: 6px; padding: 2px 7px; flex: none; }
  .part .statusline { margin: 0 0 14px; }
  .part .statusline b { font-size: 16px; }
  .foot { font-size: 11px; color: #9ca3af; text-align: center; margin-top: 16px; }
  .foot a { color: #6b7280; }
  a.back { display: inline-block; margin-top: 14px; font-size: 13px; color: #6b7280; }
  /* Admin: breitere Variante + linke Sektions-Navigation */
  .wrap--wide { max-width: 760px; }
  .admin { display: flex; gap: 20px; align-items: flex-start; }
  .admin-nav { flex: 0 0 160px; display: flex; flex-direction: column; gap: 4px; }
  .admin-nav a { display: block; padding: 9px 12px; border-radius: 8px; text-decoration: none;
    color: #374151; font-size: 14px; }
  .admin-nav a:hover { background: #f3f4f6; }
  .admin-nav a.active { background: var(--accent); color: #fff; font-weight: 600; }
  .admin-content { flex: 1; min-width: 0; }
  @media (max-width: 560px) {
    .admin { flex-direction: column; }
    .admin-nav { flex: 1 1 auto; flex-direction: row; flex-wrap: wrap; }
    .admin-nav a { flex: 1; text-align: center; }
  }
</style>
</head>
<body>
  <div class="wrap${opts.wide ? ' wrap--wide' : ''}">
    <div class="card">
      <div class="head${brand.logoUrl ? ' head--logo' : ''}">
        ${brand.logoUrl
          ? `<img class="logo-img" src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" />`
          : `<div class="logo">${esc(brand.name.charAt(0))}</div><div><b>${esc(brand.name)}</b></div>`}
      </div>
      <div class="body">${body}</div>
    </div>
    ${brand.supportEmail ? `<p class="foot">Fragen zur Lieferung? <a href="mailto:${esc(brand.supportEmail)}">${esc(brand.supportEmail)}</a></p>` : ''}
  </div>
</body>
</html>`;
}

export function renderForm({ error, query } = {}) {
  return layout(
    'Lieferstatus',
    `
    <h1>Auftragsstatus und Retourenportal</h1>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <form method="post" action="/status" autocomplete="off">
      <div class="label-row">
        <label for="query">Nummer</label>
        <span class="info" tabindex="0" role="button" aria-label="Welche Nummern sind erlaubt?">
          <span class="info-ic" aria-hidden="true">i</span>
          <span class="info-pop" role="tooltip">Gib eine der folgenden Nummern ein, um den Auftragsstatus einzusehen:
            <ul>
              <li>Auftragsnummer</li>
              <li>Bestellnummer</li>
              <li>Internet-/Shop-Bestellnummer</li>
              <li>Lieferscheinnummer</li>
            </ul>
          </span>
        </span>
      </div>
      <input id="query" name="query" inputmode="text" required value="${esc(query || '')}" placeholder="z. B. AU-20294" />
      <label for="zip">Liefer-PLZ</label>
      <input id="zip" name="zip" inputmode="numeric" required placeholder="z. B. 80331" />
      <button type="submit">Status anzeigen</button>
    </form>`,
  );
}

export function renderNotFound() {
  return layout(
    'Nicht gefunden',
    `
    <h1>Wir konnten nichts finden</h1>
    <p class="sub">Bitte prüfe Nummer und PLZ und versuche es erneut. Achte auf Tippfehler
      und nutze die Liefer-PLZ (nicht die Rechnungsadresse).</p>
    <a class="back" href="/">← Zurück zur Eingabe</a>`,
  );
}

function greetingHtml(name) {
  return name
    ? `<p style="font-size:16px;font-weight:500;margin:0 0 10px;">Hallo ${esc(name)}</p>`
    : '';
}

function addressHtml(a, { deviating = false } = {}) {
  if (!a) return '';
  const label = deviating ? 'Abweichende Lieferadresse' : 'Lieferadresse';
  return `<div class="eta${deviating ? ' eta--deviating' : ''}"><small>${esc(label)}</small>${[
    a.name,
    a.contactPerson && a.contactPerson !== a.name ? a.contactPerson : null,
    a.street,
    [a.zipCode, a.city].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .map((line) => `<div style="font-size:14px;line-height:1.4;">${esc(line)}</div>`)
    .join('')}</div>`;
}

// Sekundär-Button "Retoure anmelden". Nur mit gültigem Token (= Auftrag mit
// serverseitig geprüftem PLZ-Zweitfaktor). Ohne Token kein Button.
function retoureButtonHtml(token) {
  if (!token) return '';
  return `<a class="btn-outline" href="/retoure?t=${encodeURIComponent(token)}">Retoure anmelden</a>`;
}

// Verlauf eines normalen Auftrags (4 Stufen).
function normalStepsHtml(s) {
  return STAGES.map((name, i) => {
    const isLast = i === STAGES.length - 1;
    // Die erreichte Endstufe (Zugestellt) gilt als abgeschlossen -> Haken, nicht "aktuell".
    const reached = i < s.stage || (i === s.stage && isLast);
    const cls = reached ? 'done' : i === s.stage ? 'current' : 'todo';
    const bullet = reached ? '✓' : i === s.stage ? '●' : '';
    let sub = '';
    if (i === 2 && s.stage >= 2 && (s.packageCount || s.shipments.length)) {
      const total = s.packageCount || s.shipments.length;
      sub = `<span>${total} Paket(e)${carrierSummary(s.shipments)}</span>`;
    }
    return `<div class="step ${cls}">
      <div class="rail"><div class="bullet">${bullet}</div>${isLast ? '' : '<div class="line"></div>'}</div>
      <div class="txt"><b>${esc(name)}</b>${sub}</div>
    </div>`;
  }).join('');
}

// Verlauf eines stornierten Auftrags (eigener 2-Stufen-Verlauf).
function cancelledStepsHtml() {
  return CANCELLED_STAGES.map((name, i) => {
    const isLast = i === CANCELLED_STAGES.length - 1;
    const cls = i === 0 ? 'done' : 'cancelled';
    const bullet = i === 0 ? '✓' : '✕';
    return `<div class="step ${cls}">
      <div class="rail"><div class="bullet">${bullet}</div>${isLast ? '' : '<div class="line"></div>'}</div>
      <div class="txt"><b>${esc(name)}</b></div>
    </div>`;
  }).join('');
}

function etaHtml(s) {
  const etaLabels = {
    wish: 'Wunschliefertermin',
    carrier: 'Voraussichtlicher Liefertag',
    estimated: 'Voraussichtlicher Liefertag (geschätzt)',
  };
  if (s.deliveryDate && s.deliveryDateKind === 'delivered') {
    // Zugestellt: nur das echte Carrier-Zustelldatum zeigen.
    return `<div class="eta"><small>Zugestellt am</small><b>${fmtDate(s.deliveryDate)}</b></div>`;
  }
  if (s.deliveryDate && s.stage < 3) {
    const label = etaLabels[s.deliveryDateKind] || 'Voraussichtlicher Liefertag';
    return `<div class="eta"><small>${esc(label)}</small><b>${fmtDate(s.deliveryDate)}</b></div>`;
  }
  return '';
}

function trackingHtml(s) {
  return s.shipments
    .filter((sh) => sh.trackingLink || sh.trackingNumber)
    .map((sh, i) => {
      const label = s.shipments.length > 1 ? `Paket ${i + 1} verfolgen` : 'Sendung live verfolgen';
      if (sh.trackingLink) return `<a class="track" href="${esc(sh.trackingLink)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
      return `<div class="eta"><small>Sendungsnummer ${esc(sh.carrier || '')}</small><b>${esc(sh.trackingNumber)}</b></div>`;
    })
    .join('');
}

// Kompletter Status-Block EINES (Teil-)Auftrags: Statuszeile + Verlauf + ETA +
// Lieferadresse (direkt unter der Statushistorie) + Tracking.
// Wird sowohl für den Einzelauftrag als auch je Teilauftrag der Gruppe genutzt.
function partStatusBlock(s) {
  if (s.cancelled) {
    return `<div class="statusline"><span class="dot">🚫</span><b>Auftrag storniert</b></div>
      <div class="steps">${cancelledStepsHtml()}</div>
      <div class="err">Dieser Auftrag wurde storniert. Bei Fragen wende dich bitte an deinen Ansprechpartner${brand.supportEmail ? ` (${esc(brand.supportEmail)})` : ''}.</div>
      ${addressHtml(s.deliveryAddress, { deviating: s.addressIsDeviating })}`;
  }
  const icon = s.stage === 3 ? '📦' : s.stage === 2 ? '🚚' : '🛠️';
  const overdueHtml = s.overdue
    ? `<div class="err">Bitte kontaktiere uns, hier scheint etwas schiefgelaufen zu sein.${brand.supportEmail ? ` (${esc(brand.supportEmail)})` : ''}</div>`
    : '';
  return `<div class="statusline"><span class="dot">${icon}</span><b>${esc(STAGES[s.stage] ?? s.stageLabel)}</b></div>
    ${overdueHtml}
    <div class="steps">${normalStepsHtml(s)}</div>
    ${etaHtml(s)}
    ${addressHtml(s.deliveryAddress, { deviating: s.addressIsDeviating })}
    ${trackingHtml(s)}`;
}

// Einstieg aus dem Server. `result` ist eine Auftragsgruppe ({ parts: [...] }).
// 1 Teilauftrag -> klassische Einzelansicht; mehrere -> Teilauftrags-Ansicht.
export function renderResult(result) {
  const parts = result.parts || [result];
  return parts.length <= 1 ? renderSingle(result, parts[0]) : renderGroup(result, parts);
}

function renderSingle(result, s) {
  return layout(
    `Bestellung ${s.orderNumber}`,
    `
    ${greetingHtml(result.recipientName)}
    <p class="sub">Bestellung ${esc(s.orderNumber)}</p>
    ${partStatusBlock(s)}
    ${s.cancelled ? '' : retoureButtonHtml(result.retoureToken)}
    <a class="back" href="/">← Andere Bestellung verfolgen</a>`,
  );
}

// Alle Teilaufträge eines Ursprungsauftrags auf einer Seite. Jeder Teilauftrag
// zeigt seine eigene Lieferadresse unter seiner Statushistorie (können je
// Split abweichen).
function renderGroup(result, parts) {
  const delivered = parts.filter((p) => !p.cancelled && p.stage === 3).length;
  const cancelled = parts.filter((p) => p.cancelled).length;
  const summary = [
    `${parts.length} Teilaufträge`,
    delivered ? `${delivered} zugestellt` : null,
    cancelled ? `${cancelled} storniert` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const partsHtml = parts
    .map(
      (p, i) => `
    <div class="part">
      <div class="part-head">
        <span class="part-tag">${i + 1}/${parts.length}</span>
        <b>${esc(p.orderNumber)}</b>
      </div>
      ${partStatusBlock(p)}
    </div>`,
    )
    .join('');

  return layout(
    `Bestellung ${result.groupNumber}`,
    `
    ${greetingHtml(result.recipientName)}
    <p class="sub">Bestellung ${esc(result.groupNumber)}</p>
    <div class="ok">Dein Auftrag wurde in mehrere Teillieferungen aufgeteilt. Unten siehst du den Status und die Lieferadresse jedes Teilauftrags.</div>
    <div class="group-summary">${esc(summary)}</div>
    ${partsHtml}
    ${retoureButtonHtml(result.retoureToken)}
    <a class="back" href="/">← Andere Bestellung verfolgen</a>`,
  );
}

// Schritt 1: Artikelauswahl. Ein Artikel gilt als ausgewählt, sobald ein Grund
// gewählt ist - kein Client-JS nötig (CSP erlaubt keins).
export function renderRetoure(data, token) {
  const reasonOptions = data.reasons
    .map((r) => `<option value="${esc(r.id)}">${esc(r.designation)}</option>`)
    .join('');
  const itemsHtml = data.items
    .map((it) => {
      const head = `<div><b>${esc(it.name)}</b>${it.number ? ` <span style="color:#6b7280;font-size:12px;">· ${esc(it.number)}</span>` : ''}</div>`;
      // Vollständig retourniert -> ausgegraut, keine Eingabefelder.
      if (it.remaining <= 0) {
        return `
    <div class="part" style="padding:12px 14px;opacity:.5;">
      ${head}
      <div style="color:#6b7280;font-size:12px;margin-top:4px;">Bereits vollständig retourniert (${esc(it.returned)} von ${esc(it.quantity)})</div>
    </div>`;
      }
      const info =
        it.remaining < it.quantity
          ? `Bestellt: ${esc(it.quantity)} · bereits retourniert: ${esc(it.returned)} · noch retournierbar: <b>${esc(it.remaining)}</b>`
          : `Bestellt: ${esc(it.quantity)}`;
      return `
    <div class="part" style="padding:12px 14px;">
      ${head}
      <div style="color:#6b7280;font-size:12px;margin-top:2px;">${info}</div>
      <div style="display:flex;gap:10px;margin-top:10px;">
        <div style="flex:0 0 84px;">
          <label for="qty_${esc(it.id)}" style="margin:0 0 4px;">Menge</label>
          <input id="qty_${esc(it.id)}" name="qty_${esc(it.id)}" type="number" min="1" max="${esc(it.remaining)}" value="${esc(it.remaining)}" />
        </div>
        <div style="flex:1;">
          <label for="reason_${esc(it.id)}" style="margin:0 0 4px;">Grund</label>
          <select id="reason_${esc(it.id)}" name="reason_${esc(it.id)}">
            <option value="">— nicht zurücksenden —</option>
            ${reasonOptions}
          </select>
        </div>
      </div>
    </div>`;
    })
    .join('');
  // Stufe A: Versandart ist fix konfiguriert -> nur Anzeige, keine Kundenauswahl.
  const shippingInfo = data.shippingMethod
    ? `<div class="eta"><small>Rücksendung mit</small><b>${esc(data.shippingMethod.designation)}</b></div>`
    : '';

  // Bereits angemeldete Retouren: Label/Beleg direkt zum Download anbieten.
  const existing = data.existingReturns || [];
  const existingBlock = existing.length
    ? `<div class="ok">Du hast für diese Bestellung bereits ${existing.length === 1 ? 'eine Retoure' : esc(existing.length) + ' Retouren'} angemeldet. Hier kannst du dein Versandlabel erneut herunterladen.</div>
    ${existing
      .map((er) => {
        const links = (er.documents || []).length
          ? er.documents
              .map(
                (d) =>
                  `<a class="track" href="/retoure/label?t=${encodeURIComponent(er.labelToken)}&doc=${encodeURIComponent(d.id)}" target="_blank" rel="noopener">${esc(docLabel(d))} ↗</a>`,
              )
              .join('')
          : `<div class="eta"><small>Versandlabel</small>Wird noch erstellt – du erhältst es per E-Mail, sobald es bereitsteht.</div>`;
        return `<div class="part" style="padding:12px 14px;">
          <div><b>Retoure ${esc(er.documentNumber || er.returnId)}</b></div>
          ${links}
        </div>`;
      })
      .join('')}`
    : '';

  // Formular nur, wenn noch etwas retournierbar ist UND eine Versandart konfiguriert ist.
  const hasReturnable = data.items.some((i) => i.remaining > 0);
  const canReturn = hasReturnable && !!data.shippingMethod;
  const note = !hasReturnable
    ? '<p class="sub">Für diese Bestellung sind alle Artikel bereits zur Retoure angemeldet.</p>'
    : '<p class="sub">Eine neue Retoure ist derzeit nicht möglich. Bitte kontaktiere den Kundenservice.</p>';
  const formOrNote = canReturn
    ? `<p class="sub">${existing.length ? 'Weitere Artikel zurücksenden? ' : ''}Wähle bei den Artikeln, die du zurücksenden möchtest, einen Grund und die Menge.</p>
    <form method="post" action="/retoure">
      <input type="hidden" name="t" value="${esc(token)}" />
      ${itemsHtml}
      ${shippingInfo}
      <button type="submit">Retoure anmelden</button>
    </form>`
    : note;

  return layout(
    'Retoure anmelden',
    `
    <h1>Retoure anmelden</h1>
    <p class="sub">Bestellung ${esc(data.orderNumber)}</p>
    ${existingBlock}
    ${formOrNote}
    <a class="back" href="/">← Zurück</a>`,
  );
}

// Schritt 2: Bestätigung + Label/Beleg-Download (falls Dokumente bereitstehen).
export function renderRetoureDone({ orderNumber, returnId, docs = [], token }) {
  const links = docs
    .map(
      (d) =>
        `<a class="track" href="/retoure/label?t=${encodeURIComponent(token)}&doc=${encodeURIComponent(d.id)}" target="_blank" rel="noopener">${esc(docLabel(d))} ↗</a>`,
    )
    .join('');
  const noDocs =
    docs.length === 0
      ? `<div class="eta"><small>Versandlabel</small>Dein Retourenlabel wird erstellt. Du erhältst es per E-Mail, sobald es bereitsteht.</div>`
      : '';
  return layout(
    'Retoure angemeldet',
    `
    <h1>Retoure angemeldet ✓</h1>
    <p class="sub">${orderNumber ? `Bestellung ${esc(orderNumber)} · ` : ''}Retoure ${esc(returnId)}</p>
    <div class="ok">Vielen Dank! Deine Retoure ist angemeldet. Drucke das Versandlabel aus und lege den Retourenschein bei.</div>
    ${links}
    ${noDocs}
    <a class="back" href="/">← Zur Startseite</a>`,
  );
}

// Lesbares Label je Dokumenttyp (Heuristik über keyword/filename/title).
function docLabel(d) {
  const k = `${d.keyword || ''} ${d.filename || ''} ${d.title || ''}`.toLowerCase();
  if (/label|versand|paketmarke|shipping/.test(k)) return 'Versandlabel herunterladen';
  if (/retoure|return|beleg|schein|invoice|gutschrift/.test(k)) return 'Retourenschein herunterladen';
  return `Dokument ${d.title || d.id} herunterladen`;
}

// Fehler-/Hinweisseite im Retoure-Flow (ungültiges Token, keine Artikel, …).
export function renderRetoureError(message) {
  return layout(
    'Retoure',
    `
    <h1>Retoure</h1>
    <div class="err">${esc(message)}</div>
    <a class="back" href="/">← Zur Startseite</a>`,
  );
}

export function renderLogin({ error } = {}) {
  return layout(
    'Login',
    `
    <h1>Einstellungen</h1>
    <p class="sub">Bitte mit dem Admin-Kennwort anmelden.</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <form method="post" action="/admin/login" autocomplete="off">
      <label for="password">Kennwort</label>
      <input id="password" name="password" type="password" required autofocus />
      <button type="submit">Anmelden</button>
    </form>`,
  );
}

export function renderSettings(fields, { saved, warning, error, section = 'allgemein', sections = [] } = {}) {
  const active = sections.find((s) => s.id === section) || sections[0] || { id: section, label: 'Einstellungen' };
  const nav = sections
    .map(
      (s) =>
        `<a href="/admin?s=${esc(s.id)}"${s.id === active.id ? ' class="active"' : ''}>${esc(s.label)}</a>`,
    )
    .join('');

  const rows = fields
    .filter((field) => field.section === active.id)
    .map((field) => {
      const name = field.key.replace(/\./g, '__');
      if (field.type === 'bool') {
        return `<label class="chk"><input type="checkbox" name="${name}" ${field.value ? 'checked' : ''} /> <span>${esc(field.label)}</span></label>`;
      }
      if (field.type === 'select') {
        const opts = (field.options || [])
          .map(
            (o) =>
              `<option value="${esc(o.value)}"${String(o.value) === String(field.value) ? ' selected' : ''}>${esc(o.label)}</option>`,
          )
          .join('');
        return `<label for="${name}">${esc(field.label)}</label>
      <select id="${name}" name="${name}"><option value="">— nicht gesetzt —</option>${opts}</select>
      ${field.hint ? `<p class="hint">${esc(field.hint)}</p>` : ''}`;
      }
      const isSecret = field.type === 'secret';
      const isNumber = field.type === 'number';
      const inputType = isSecret ? 'password' : isNumber ? 'number' : 'text';
      const ph = isSecret
        ? field.isSet
          ? '•••••••• gesetzt – leer lassen = unverändert'
          : 'nicht gesetzt'
        : field.hint || '';
      return `<label for="${name}">${esc(field.label)}</label>
      <input id="${name}" name="${name}" type="${inputType}"${isNumber ? ' min="0" step="1"' : ''} value="${isSecret ? '' : esc(field.value)}" placeholder="${esc(ph)}" autocomplete="off" />`;
    })
    .join('');

  // Logo nur in der Allgemein-Sektion (gehört zum Branding).
  const logo = logoStatus();
  const logoBlock =
    active.id === 'allgemein'
      ? `
    <label for="logo">Logo</label>
    ${logo.url
      ? `<div class="eta logo-preview"><img src="${esc(logo.url)}" alt="Aktuelles Logo" /></div>`
      : '<p class="sub">Kein Logo gesetzt – es wird die Buchstaben-Kachel angezeigt.</p>'}
    <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" class="file" />
    <p class="hint">PNG, JPG, GIF, WebP oder SVG · max. 1 MB · max. 1000px Breite.</p>
    ${logo.custom ? '<label class="chk"><input type="checkbox" name="removeLogo" /> <span>Hochgeladenes Logo entfernen (Standard verwenden)</span></label>' : ''}`
      : '';

  return layout(
    'Einstellungen',
    `
    <div class="admin">
      <nav class="admin-nav">${nav}</nav>
      <div class="admin-content">
        <h1>${esc(active.label)}</h1>
        <p class="sub">Änderungen wirken sofort und werden gespeichert.</p>
        ${saved ? '<div class="ok">Gespeichert.</div>' : ''}
        ${error ? `<div class="err">${esc(error)}</div>` : ''}
        ${warning ? `<div class="err">${esc(warning)}</div>` : ''}
        <form method="post" action="/admin" enctype="multipart/form-data" autocomplete="off">
          <input type="hidden" name="__section" value="${esc(active.id)}" />
          ${rows}
          ${logoBlock}
          <button type="submit">Speichern</button>
        </form>
        <form method="post" action="/admin/logout"><button type="submit" class="ghost">Abmelden</button></form>
      </div>
    </div>`,
    { wide: true },
  );
}
