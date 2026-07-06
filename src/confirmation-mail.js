import { t, withLocale } from './i18n.js';
import { sendEmailViaAccount } from './xentral.js';
import { fetchReturnDocument } from './returns.js';
import { currentBrand } from './portal-context.js';

// ─────────────────────────────────────────────────────────────────────────────
// C4: Bestätigungsmail nach der Retoure-Anmeldung.
//
// Versand über das Xentral-E-Mail-Konto aus den Projekt-Settings
// (emailAccountId); ohne Konto oder ohne Kunden-E-Mail wird still übersprungen
// (Retoure ist dann trotzdem angelegt — die Mail ist Komfort, kein Gate).
// Liegen schon Belege vor (Retourenbeleg; Label erst nach Versandzentrum/P0),
// gehen sie als Anhang mit, sonst kündigt der Text das Label per E-Mail an.
// Aufrufer feuern fire-and-forget — Fehler landen nur im Log.
// ─────────────────────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MAX_ATTACHMENTS = 3;

async function buildAttachments(returnId, documents) {
  const attachments = [];
  for (const doc of (documents || []).slice(0, MAX_ATTACHMENTS)) {
    try {
      const { buffer } = await fetchReturnDocument(returnId, doc.id);
      attachments.push({
        fileName: doc.filename || `retoure-${returnId}-${doc.id}.pdf`,
        fileContent: buffer.toString('base64'),
      });
    } catch (err) {
      console.warn(`[mail] Anhang ${doc.id} nicht ladbar: ${err.status || err.message}`);
    }
  }
  return attachments;
}

// selections: [{posId, quantity, reasonId}] + items aus loadReturnable für Namen.
function buildBody({ customerName, orderNumber, items, selections, shippingMethodName, hasLabel }) {
  const byId = new Map(items.map((it) => [String(it.id), it]));
  const lines = selections
    .map((s) => {
      const it = byId.get(String(s.posId));
      return `<li>${esc(s.quantity)}× ${esc(it?.name || t('mail.return.item'))}</li>`;
    })
    .join('');

  return [
    `<p>${esc(customerName ? t('mail.return.greeting', { name: customerName }) : t('mail.return.greetingGeneric'))}</p>`,
    `<p>${esc(t('mail.return.intro', { order: orderNumber }))}</p>`,
    `<ul>${lines}</ul>`,
    shippingMethodName ? `<p>${esc(t('mail.return.shipping', { method: shippingMethodName }))}</p>` : '',
    `<p>${esc(hasLabel ? t('mail.return.labelAttached') : t('mail.return.labelPending'))}</p>`,
    `<p>${esc(t('mail.return.signoff', { shop: currentBrand().name }))}</p>`,
  ].join('\n');
}

// Nie werfen — Aufrufer verlassen sich auf fire-and-forget.
export async function sendReturnConfirmation({ settings, locale, data, selections, returnId, returnNumber, documents }) {
  const accountId = Number(settings?.raw?.emailAccountId) || 0;
  const to = data.customerEmail;
  if (!accountId || !to) {
    console.log(`[mail] Bestätigungsmail übersprungen (Konto: ${accountId || '—'}, Empfänger: ${to || '—'})`);
    return false;
  }

  try {
    const attachments = await buildAttachments(returnId, documents);
    const payload = withLocale(locale, () => ({
      to,
      name: data.customerName || undefined,
      subject: t('mail.return.subject', { order: data.orderNumber, nr: returnNumber || returnId }),
      body: buildBody({
        customerName: data.customerName,
        orderNumber: data.orderNumber,
        items: data.items,
        selections,
        shippingMethodName: data.shippingMethod?.designation || '',
        hasLabel: attachments.length > 0,
      }),
    }));
    if (attachments.length) payload.attachments = attachments;

    await sendEmailViaAccount(accountId, payload);
    console.log(`[mail] Bestätigungsmail für Retoure ${returnId} an ${to} übergeben (Konto ${accountId}).`);
    return true;
  } catch (err) {
    console.warn(`[mail] Bestätigungsmail für Retoure ${returnId} fehlgeschlagen: ${err.status || err.message}`);
    return false;
  }
}
