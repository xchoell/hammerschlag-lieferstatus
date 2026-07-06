import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';
import { currentPortal } from './portal-context.js';

// ─────────────────────────────────────────────────────────────────────────────
// i18n für alle kundensichtbaren Texte (Admin bleibt bewusst Deutsch).
// Locale pro Request via AsyncLocalStorage: ?lang= > Cookie > Accept-Language
// > config.defaultLocale. t() fällt bei fehlendem Key auf DE zurück.
// ─────────────────────────────────────────────────────────────────────────────
export const SUPPORTED = ['de', 'en'];

const store = new AsyncLocalStorage();

export function currentLocale() {
  return store.getStore()?.locale || (SUPPORTED.includes(config.defaultLocale) ? config.defaultLocale : 'de');
}

// Express-Middleware: Locale bestimmen + als Cookie persistieren.
export function localeMiddleware(req, res, next) {
  let locale = null;
  const q = String(req.query?.lang || '').toLowerCase();
  if (SUPPORTED.includes(q)) {
    locale = q;
    res.setHeader('Set-Cookie', `lang=${locale}; SameSite=Lax; Path=/; Max-Age=31536000`);
  }
  if (!locale) {
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)lang=(\w{2})/);
    if (m && SUPPORTED.includes(m[1])) locale = m[1];
  }
  if (!locale) {
    const al = String(req.headers['accept-language'] || '').toLowerCase();
    locale = SUPPORTED.find((l) => al.startsWith(l)) || null;
  }
  // Projekt-Portal (/p/<slug>): dessen Standardsprache schlägt die globale.
  if (!locale) {
    const projectDefault = String(currentPortal()?.settings?.raw?.defaultLocale || '').toLowerCase();
    if (SUPPORTED.includes(projectDefault)) locale = projectDefault;
  }
  if (!locale) locale = SUPPORTED.includes(config.defaultLocale) ? config.defaultLocale : 'de';
  store.run({ locale }, next);
}

// Programmatischer Locale-Scope (Tests, spätere E-Mail-Erzeugung).
export function withLocale(locale, fn) {
  return store.run({ locale: SUPPORTED.includes(locale) ? locale : 'de' }, fn);
}

// Übersetzen mit {param}-Interpolation. Fehlender Key -> DE -> Key selbst.
export function t(key, params = {}) {
  const locale = currentLocale();
  let s = CATALOG[locale]?.[key] ?? CATALOG.de[key] ?? key;
  for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

const de = {
  // Titel
  'title.status': 'Lieferstatus',
  'title.notFound': 'Nicht gefunden',
  'title.order': 'Bestellung {n}',
  'title.retoure': 'Retoure anmelden',
  'title.retoureConfirm': 'Retoure prüfen',
  'title.retoureDone': 'Retoure angemeldet',
  'title.retoureError': 'Retoure',
  // Startseite
  'form.heading': 'Auftragsstatus und Retourenportal',
  'form.number': 'Nummer',
  'form.numberInfoIntro': 'Gib eine der folgenden Nummern ein, um den Auftragsstatus einzusehen:',
  'form.numberKinds.order': 'Auftragsnummer',
  'form.numberKinds.customer': 'Bestellnummer',
  'form.numberKinds.web': 'Internet-/Shop-Bestellnummer',
  'form.numberKinds.deliveryNote': 'Lieferscheinnummer',
  'form.secret.zip': 'Liefer-PLZ',
  'form.secret.email': 'E-Mail-Adresse',
  'form.secret.customerNumber': 'Kundennummer',
  'form.numberPlaceholder': 'z. B. AU-20294',
  'form.secretPlaceholder.zip': 'z. B. 80331',
  'form.secretPlaceholder.email': 'z. B. max@beispiel.de',
  'form.secretPlaceholder.customerNumber': 'z. B. 10001',
  'form.submit': 'Status anzeigen',
  'form.missing.zip': 'Bitte Nummer und PLZ eingeben.',
  'form.missing.email': 'Bitte Nummer und E-Mail-Adresse eingeben.',
  'form.missing.customerNumber': 'Bitte Nummer und Kundennummer eingeben.',
  'form.error': 'Es ist ein Fehler aufgetreten. Bitte versuche es später erneut.',
  'form.rateLimited': 'Zu viele Anfragen. Bitte warte einen Moment und versuche es erneut.',
  // Nicht gefunden
  'notFound.heading': 'Wir konnten nichts finden',
  'notFound.text.zip': 'Bitte prüfe Nummer und PLZ und versuche es erneut. Achte auf Tippfehler und nutze die Liefer-PLZ (nicht die Rechnungsadresse).',
  'notFound.text.email': 'Bitte prüfe Nummer und E-Mail-Adresse und versuche es erneut. Nutze die E-Mail-Adresse, mit der bestellt wurde.',
  'notFound.text.customerNumber': 'Bitte prüfe Nummer und Kundennummer und versuche es erneut.',
  'notFound.back': '← Zurück zur Eingabe',
  // Status
  'status.hello': 'Hallo {name}',
  'status.order': 'Bestellung {n}',
  'stages.0': 'Auftrag erhalten',
  'stages.1': 'Auftrag wird gepackt',
  'stages.2': 'Versendet',
  'stages.3': 'Zugestellt',
  'stages.cancelled': 'Auftrag storniert',
  'status.packages': '{n} Paket(e)',
  'status.cancelledInfo': 'Dieser Auftrag wurde storniert. Bei Fragen wende dich bitte an deinen Ansprechpartner{contact}.',
  'status.overdue': 'Bitte kontaktiere uns, hier scheint etwas schiefgelaufen zu sein.{contact}',
  'status.deliveredAt': 'Zugestellt am',
  'status.wishDate': 'Wunschliefertermin',
  'status.carrierDate': 'Voraussichtlicher Liefertag',
  'status.estimatedDate': 'Voraussichtlicher Liefertag (geschätzt)',
  'status.address': 'Lieferadresse',
  'status.addressDeviating': 'Abweichende Lieferadresse',
  'status.trackOne': 'Sendung live verfolgen',
  'status.trackN': 'Paket {n} verfolgen',
  'status.trackingNumber': 'Sendungsnummer {carrier}',
  'status.splitInfo': 'Dein Auftrag wurde in mehrere Teillieferungen aufgeteilt. Unten siehst du den Status und die Lieferadresse jedes Teilauftrags.',
  'status.splitParts': '{n} Teilaufträge',
  'status.splitDelivered': '{n} zugestellt',
  'status.splitCancelled': '{n} storniert',
  'status.otherOrder': '← Andere Bestellung verfolgen',
  'status.retoureButton': 'Retoure anmelden',
  'footer.question': 'Fragen zur Lieferung?',
  'legal.shop': 'Shop',
  'legal.imprint': 'Impressum',
  'legal.terms': 'AGB',
  'legal.privacy': 'Datenschutz',
  // Retoure-Flow
  'retoure.heading': 'Retoure anmelden',
  'retoure.chooseIntro': 'Wähle bei den Artikeln, die du zurücksenden möchtest, einen Grund und die Menge.',
  'retoure.chooseMore': 'Weitere Artikel zurücksenden? ',
  'retoure.ordered': 'Bestellt: {n}',
  'retoure.orderedDetail': 'Bestellt: {n} · bereits retourniert: {r} · noch retournierbar:',
  'retoure.fullyReturned': 'Bereits vollständig retourniert ({r} von {n})',
  'retoure.qty': 'Menge',
  'retoure.reason': 'Grund',
  'retoure.noReturn': '— nicht zurücksenden —',
  'retoure.shipWith': 'Rücksendung mit',
  'retoure.submit': 'Retoure anmelden',
  'retoure.back': '← Zurück',
  'retoure.allReturned': 'Für diese Bestellung sind alle Artikel bereits zur Retoure angemeldet.',
  'retoure.notPossible': 'Eine neue Retoure ist derzeit nicht möglich. Bitte kontaktiere den Kundenservice.',
  'retoure.windowExpired': 'Die Rückgabefrist für diese Bestellung ist leider abgelaufen. Bitte kontaktiere den Kundenservice.',
  'retoure.tooFresh': 'Eine Retoure ist erst {h} Stunden nach der Bestellung möglich. Bitte versuche es später erneut.',
  'retoure.singleLimit': 'Für diese Bestellung wurde bereits eine Retoure angemeldet – eine weitere ist nicht möglich. Bitte kontaktiere den Kundenservice.',
  'retoure.conditionBlocked': 'Für diese Bestellung ist eine Retoure über das Portal nicht möglich. Bitte kontaktiere den Kundenservice.',
  'retoure.itemExcluded': 'Dieser Artikel ist vom Umtausch ausgeschlossen.',
  'retoure.existing.one': 'Du hast für diese Bestellung bereits eine Retoure angemeldet. Hier kannst du dein Versandlabel erneut herunterladen.',
  'retoure.existing.many': 'Du hast für diese Bestellung bereits {n} Retouren angemeldet. Hier kannst du dein Versandlabel erneut herunterladen.',
  'retoure.existing.title': 'Retoure {n}',
  'retoure.labelPending': 'Wird noch erstellt – du erhältst es per E-Mail, sobald es bereitsteht.',
  'retoure.labelPendingShort': 'Versandlabel',
  'retoure.downloadLabel': 'Versandlabel herunterladen',
  'retoure.downloadReceipt': 'Retourenschein herunterladen',
  'retoure.downloadDoc': 'Dokument {n} herunterladen',
  // Prüfen/Bestätigen
  'confirm.heading': 'Retoure prüfen',
  'confirm.sub': 'Bestellung {n} · Bitte prüfe deine Auswahl.',
  'confirm.reason': 'Grund: {r}',
  'confirm.submit': 'Retoure verbindlich anmelden',
  'confirm.edit': '← Auswahl ändern',
  // Fertig
  'done.heading': 'Retoure angemeldet ✓',
  'done.sub': 'Retoure {n}',
  'done.text': 'Vielen Dank! Deine Retoure ist angemeldet. Drucke das Versandlabel aus und lege den Retourenschein bei.',
  'done.labelPending': 'Dein Retourenlabel wird erstellt. Du erhältst es per E-Mail, sobald es bereitsteht.',
  'done.home': '← Zur Startseite',
  // Fehler
  'err.tokenInvalid': 'Dieser Retoure-Link ist ungültig oder abgelaufen. Bitte rufe den Lieferstatus erneut auf.',
  'err.notDelivered': 'Eine Retoure ist erst möglich, sobald deine Sendung zugestellt wurde. Bitte versuche es nach der Zustellung erneut.',
  'err.returnsDisabled': 'Die Retoure-Anmeldung ist derzeit deaktiviert. Bitte kontaktiere den Kundenservice.',
  'err.noItems': 'Für diese Bestellung sind keine retournierbaren Artikel hinterlegt.',
  'err.selectOne': 'Bitte mindestens einen Artikel mit Menge und Grund auswählen.',
  'err.loadFailed': 'Die Artikel konnten nicht geladen werden. Bitte versuche es später erneut.',
  'err.createFailed': 'Die Retoure konnte nicht angelegt werden. Bitte versuche es später erneut.',
  'err.rateLimited': 'Zu viele Anfragen. Bitte warte einen Moment.',
  // Bestätigungsmail (C4)
  'mail.return.subject': 'Deine Retoure zur Bestellung {order}',
  'mail.return.greeting': 'Hallo {name},',
  'mail.return.greetingGeneric': 'Hallo,',
  'mail.return.intro': 'deine Retoure zur Bestellung {order} ist angemeldet. Du sendest zurück:',
  'mail.return.item': 'Artikel',
  'mail.return.shipping': 'Rücksendung mit: {method}',
  'mail.return.labelAttached': 'Dein Versandlabel und der Retourenbeleg sind angehängt. Bitte lege den Beleg dem Paket bei.',
  'mail.return.labelPending': 'Dein Versandlabel wird erstellt und kommt in einer separaten E-Mail.',
  'mail.return.signoff': 'Vielen Dank – {shop}',
};

const en = {
  'title.status': 'Delivery status',
  'title.notFound': 'Not found',
  'title.order': 'Order {n}',
  'title.retoure': 'Register return',
  'title.retoureConfirm': 'Review return',
  'title.retoureDone': 'Return registered',
  'title.retoureError': 'Return',
  'form.heading': 'Order status and returns portal',
  'form.number': 'Number',
  'form.numberInfoIntro': 'Enter one of the following numbers to view your order status:',
  'form.numberKinds.order': 'Order number',
  'form.numberKinds.customer': 'Purchase order number',
  'form.numberKinds.web': 'Web/shop order number',
  'form.numberKinds.deliveryNote': 'Delivery note number',
  'form.secret.zip': 'Delivery ZIP code',
  'form.secret.email': 'Email address',
  'form.secret.customerNumber': 'Customer number',
  'form.numberPlaceholder': 'e.g. AU-20294',
  'form.secretPlaceholder.zip': 'e.g. 80331',
  'form.secretPlaceholder.email': 'e.g. jane@example.com',
  'form.secretPlaceholder.customerNumber': 'e.g. 10001',
  'form.submit': 'Show status',
  'form.missing.zip': 'Please enter number and ZIP code.',
  'form.missing.email': 'Please enter number and email address.',
  'form.missing.customerNumber': 'Please enter number and customer number.',
  'form.error': 'Something went wrong. Please try again later.',
  'form.rateLimited': 'Too many requests. Please wait a moment and try again.',
  'notFound.heading': 'Nothing found',
  'notFound.text.zip': 'Please check number and ZIP code and try again. Watch out for typos and use the delivery ZIP (not the billing address).',
  'notFound.text.email': 'Please check number and email address and try again. Use the email address the order was placed with.',
  'notFound.text.customerNumber': 'Please check number and customer number and try again.',
  'notFound.back': '← Back to search',
  'status.hello': 'Hello {name}',
  'status.order': 'Order {n}',
  'stages.0': 'Order received',
  'stages.1': 'Order being packed',
  'stages.2': 'Shipped',
  'stages.3': 'Delivered',
  'stages.cancelled': 'Order cancelled',
  'status.packages': '{n} package(s)',
  'status.cancelledInfo': 'This order has been cancelled. If you have questions, please contact your contact person{contact}.',
  'status.overdue': 'Please contact us — something seems to have gone wrong here.{contact}',
  'status.deliveredAt': 'Delivered on',
  'status.wishDate': 'Requested delivery date',
  'status.carrierDate': 'Expected delivery date',
  'status.estimatedDate': 'Expected delivery date (estimated)',
  'status.address': 'Delivery address',
  'status.addressDeviating': 'Different delivery address',
  'status.trackOne': 'Track shipment live',
  'status.trackN': 'Track package {n}',
  'status.trackingNumber': 'Tracking number {carrier}',
  'status.splitInfo': 'Your order was split into multiple partial deliveries. Below you can see the status and delivery address of each part.',
  'status.splitParts': '{n} partial orders',
  'status.splitDelivered': '{n} delivered',
  'status.splitCancelled': '{n} cancelled',
  'status.otherOrder': '← Track another order',
  'status.retoureButton': 'Register return',
  'footer.question': 'Questions about your delivery?',
  'legal.shop': 'Shop',
  'legal.imprint': 'Imprint',
  'legal.terms': 'Terms',
  'legal.privacy': 'Privacy',
  'retoure.heading': 'Register return',
  'retoure.chooseIntro': 'For each item you want to send back, choose a reason and quantity.',
  'retoure.chooseMore': 'Return more items? ',
  'retoure.ordered': 'Ordered: {n}',
  'retoure.orderedDetail': 'Ordered: {n} · already returned: {r} · still returnable:',
  'retoure.fullyReturned': 'Already fully returned ({r} of {n})',
  'retoure.qty': 'Quantity',
  'retoure.reason': 'Reason',
  'retoure.noReturn': '— do not return —',
  'retoure.shipWith': 'Return shipping via',
  'retoure.submit': 'Register return',
  'retoure.back': '← Back',
  'retoure.allReturned': 'All items of this order have already been registered for return.',
  'retoure.notPossible': 'A new return is currently not possible. Please contact customer service.',
  'retoure.windowExpired': 'Unfortunately the return period for this order has expired. Please contact customer service.',
  'retoure.tooFresh': 'A return is only possible {h} hours after ordering. Please try again later.',
  'retoure.singleLimit': 'A return has already been registered for this order – another one is not possible. Please contact customer service.',
  'retoure.conditionBlocked': 'A return via the portal is not possible for this order. Please contact customer service.',
  'retoure.itemExcluded': 'This item cannot be returned.',
  'retoure.existing.one': 'You have already registered a return for this order. You can download your shipping label again here.',
  'retoure.existing.many': 'You have already registered {n} returns for this order. You can download your shipping label again here.',
  'retoure.existing.title': 'Return {n}',
  'retoure.labelPending': 'Still being created — you will receive it by email as soon as it is ready.',
  'retoure.labelPendingShort': 'Shipping label',
  'retoure.downloadLabel': 'Download shipping label',
  'retoure.downloadReceipt': 'Download return receipt',
  'retoure.downloadDoc': 'Download document {n}',
  'confirm.heading': 'Review return',
  'confirm.sub': 'Order {n} · Please review your selection.',
  'confirm.reason': 'Reason: {r}',
  'confirm.submit': 'Register return bindingly',
  'confirm.edit': '← Change selection',
  'done.heading': 'Return registered ✓',
  'done.sub': 'Return {n}',
  'done.text': 'Thank you! Your return has been registered. Print the shipping label and enclose the return receipt.',
  'done.labelPending': 'Your return label is being created. You will receive it by email as soon as it is ready.',
  'done.home': '← Back to start',
  'err.tokenInvalid': 'This return link is invalid or has expired. Please open the delivery status again.',
  'err.notDelivered': 'A return is only possible once your shipment has been delivered. Please try again after delivery.',
  'err.returnsDisabled': 'Return registration is currently disabled. Please contact customer service.',
  'err.noItems': 'There are no returnable items for this order.',
  'err.selectOne': 'Please select at least one item with quantity and reason.',
  'err.loadFailed': 'The items could not be loaded. Please try again later.',
  'err.createFailed': 'The return could not be created. Please try again later.',
  'err.rateLimited': 'Too many requests. Please wait a moment.',
  // Confirmation mail (C4)
  'mail.return.subject': 'Your return for order {order}',
  'mail.return.greeting': 'Hello {name},',
  'mail.return.greetingGeneric': 'Hello,',
  'mail.return.intro': 'your return for order {order} has been registered. You are sending back:',
  'mail.return.item': 'Item',
  'mail.return.shipping': 'Return shipping with: {method}',
  'mail.return.labelAttached': 'Your shipping label and the return slip are attached. Please include the slip in the parcel.',
  'mail.return.labelPending': 'Your shipping label is being created and will arrive in a separate email.',
  'mail.return.signoff': 'Thank you – {shop}',
};

const CATALOG = { de, en };
