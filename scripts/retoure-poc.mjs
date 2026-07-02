// ─────────────────────────────────────────────────────────────────────────────
// Retoure-POC — beweist die Retouren-Kette über die Xentral REST-API end-to-end
// und klärt das offene Risiko: kommt das RETOURENLABEL als PDF heraus?
//
// Strategie (siehe Recherche):
//   • V3 hat KEINE Label-Kette (kein shippingMethod im Create, kein Dokument-GET).
//   • V1 ist der einzige Weg: POST /api/v1/returns nimmt salesOrder + positions
//     + shippingMethod (= Label-Hebel); Dokumente sind als PDF abrufbar.
//
// Ablauf:
//   1. GET /api/v1/returnReasons              (Rücksendegründe)
//   2. GET /api/v1/shippingMethods            -> Filter supportReturns=true
//   3. GET /api/v3/salesOrders (documentNumber) -> salesOrderId
//   4. GET /api/v1/salesOrders/{id}           -> Positionen (id, quantity, product)
//   --- ab hier nur mit --create (legt einen ECHTEN Beleg an!) ---
//   5. POST /api/v1/returns                   (mit shippingMethod = Label-Trigger)
//   6. GET  /api/v1/returns/{id}/documents    (direkt nach Create prüfen)
//   7. POST /api/v1/returns/{id}/actions/release
//   8. GET  /api/v1/returns/{id}/documents    (nach Release erneut prüfen)
//   9. GET  /api/v1/returns/{id}/documents/{documentId}  -> PDF/Bild nach ./poc-out/
//
// Lesen läuft immer (ungefährlich). Schreiben (Schritt 5–9) NUR mit --create.
//
// Aufruf:
//   node scripts/retoure-poc.mjs --order=AU-0001               (nur Discovery)
//   node scripts/retoure-poc.mjs --so=12345 --create           (legt Retoure an)
//   node scripts/retoure-poc.mjs --order=AU-0001 --create \
//        --shipping=21 --qty=1                                 (DHL Retoure = 21)
//
// Env (.env): XENTRAL_BASE_URL, XENTRAL_API_TOKEN
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = (process.env.XENTRAL_BASE_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.XENTRAL_API_TOKEN || '';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const log = (...a) => console.log(...a);
const step = (n, t) => log(`\n${'━'.repeat(60)}\n▶ ${n}. ${t}\n${'━'.repeat(60)}`);
const pretty = (o) => JSON.stringify(o, null, 2);

if (!BASE || !TOKEN) {
  console.error('✗ XENTRAL_BASE_URL und XENTRAL_API_TOKEN müssen in .env gesetzt sein.');
  process.exit(1);
}

// Low-level Request. Gibt {status, json|text, contentType, buffer} zurück.
async function api(method, path, { query, body, accept = 'application/json' } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.append(k, v);
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: accept,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const out = {
    status: res.status,
    ok: res.ok,
    contentType: ct,
    url: url.toString(),
    location: res.headers.get('location') || res.headers.get('content-location') || '',
  };
  if (ct.includes('application/json')) out.json = await res.json().catch(() => null);
  else if (ct.startsWith('application/pdf') || ct.startsWith('image/'))
    out.buffer = Buffer.from(await res.arrayBuffer());
  else out.text = await res.text().catch(() => '');
  if (!res.ok) log(`  ⚠ HTTP ${res.status} bei ${method} ${path}: ${pretty(out.json || out.text || '')?.slice(0, 400)}`);
  return out;
}

// Tolerante Extraktion (Felder mal flach, mal unter attributes).
const dg = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const pick = (r, paths) => {
  for (const p of paths) {
    const v = dg(r, p) ?? dg(r?.attributes || {}, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

// V1-Pagination: page[number] + page[size] (size 10..50, Pflichtfelder). Alle Seiten.
async function paginateV1(path, extraQuery = {}) {
  const out = [];
  for (let number = 1; number <= 50; number++) {
    const r = await api('GET', path, { query: { ...extraQuery, 'page[number]': number, 'page[size]': 50 } });
    const data = r.json?.data || [];
    out.push(...data);
    if (data.length < 50) break;
  }
  return out;
}

async function discoverReasons() {
  step(1, 'Rücksendegründe — GET /api/v1/returnReasons');
  const reasons = await paginateV1('/api/v1/returnReasons');
  log(`  ${reasons.length} Gründe gefunden:`);
  for (const x of reasons.slice(0, 30))
    log(`    • id=${x.id}  "${x.designation}"  [${x.language}]  projekt=${x.project?.id ?? '-'}`);
  return reasons;
}

async function discoverReturnShippingMethods() {
  step(2, 'Versandarten — GET /api/v1/shippingMethods (Filter supportReturns)');
  const all = await paginateV1('/api/v1/shippingMethods');
  const returns = all.filter((m) => m.supportReturns === true || m.supportReturns === 1);
  log(`  ${all.length} Versandarten gesamt, davon ${returns.length} mit supportReturns:`);
  for (const m of returns)
    log(`    • id=${m.id}  "${m.designation}"  modul=${m.module || m.type}  supportReturns=${m.supportReturns}`);
  return returns;
}

async function resolveSalesOrder() {
  step(3, 'Auftrag auflösen');
  let soId = args.so;
  if (!soId && args.order) {
    const r = await api('GET', '/api/v3/salesOrders', {
      query: {
        'filter[0][key]': 'documentNumber',
        'filter[0][op]': 'equals',
        'filter[0][value]': args.order,
        'page[size]': 5,
      },
    });
    soId = r.json?.data?.[0]?.id;
    log(`  documentNumber="${args.order}" -> salesOrderId=${soId ?? '(nicht gefunden)'}`);
  } else {
    log(`  salesOrderId=${soId} (direkt übergeben)`);
  }
  if (!soId) throw new Error('Kein salesOrderId — bitte --order=<Nr> oder --so=<id> angeben.');

  step(4, `Positionen — GET /api/v1/salesOrders/${soId}`);
  const r = await api('GET', `/api/v1/salesOrders/${soId}`);
  const data = r.json?.data || {};
  const positions = data.positions || data.attributes?.positions || [];
  log(`  ${positions.length} Positionen:`);
  for (const p of positions.slice(0, 30)) {
    const name = pick(p, ['product.name', 'name', 'product.number']);
    log(`    • posId=${p.id}  menge=${p.quantity}  produkt="${name ?? '?'}"  hasChildren=${p.hasChildren ?? '-'}`);
  }
  return { soId, positions };
}

async function createReturnFlow({ soId, positions, reasons, shippingMethods }) {
  const pos = positions.find((p) => !p.parent && !p.hasChildren) || positions[0];
  if (!pos) throw new Error('Keine Position zum Retournieren gefunden.');
  const reasonId = String(args.reason || reasons[0]?.id || '');
  const shippingId = String(args.shipping || shippingMethods[0]?.id || '');
  const qty = Number(args.qty || 1);
  if (!reasonId) throw new Error('Kein Retourengrund (returnReasons leer / --reason fehlt).');
  if (!shippingId) throw new Error('Keine Retouren-Versandart (supportReturns leer / --shipping fehlt).');

  const payload = {
    salesOrder: { id: String(soId), positions: [{ id: String(pos.id), quantity: qty, returnReason: { id: reasonId } }] },
    shippingMethod: { id: shippingId },
  };

  step(5, 'Retoure anlegen — POST /api/v1/returns  (⚠ erzeugt echten Beleg)');
  log('  Payload:\n' + pretty(payload));
  const created = await api('POST', '/api/v1/returns', { body: payload });
  log(`  -> HTTP ${created.status}  Location: ${created.location || '(keiner)'}`);
  const returnId =
    created.json?.data?.id ?? created.json?.id ?? (created.location.match(/(\d+)\/?$/) || [])[1];
  if (!returnId) {
    log('  ✗ Keine Retouren-ID (Body leer, kein Location-Header):\n' + pretty(created.json || created.text));
    return;
  }
  log(`  ✓ Retoure angelegt: id=${returnId}`);

  await dumpDocuments(returnId, 'direkt nach Create');

  step(7, `Freigeben — POST /api/v1/returns/${returnId}/actions/release`);
  const rel = await api('POST', `/api/v1/returns/${returnId}/actions/release`);
  log(`  -> HTTP ${rel.status}`);

  const docs = await dumpDocuments(returnId, 'nach Release');
  await downloadDocuments(returnId, docs);

  log(`\n✅ Fertig. Retoure id=${returnId}. Prüfe ./poc-out/ auf das Label-PDF.`);
  log('   In Xentral gegenprüfen: Lager > Retouren, Beleg ' + returnId + '.');
}

async function dumpDocuments(returnId, when) {
  step(when.includes('Release') ? 8 : 6, `Dokumente (${when}) — GET /api/v1/returns/${returnId}/documents`);
  const r = await api('GET', `/api/v1/returns/${returnId}/documents`);
  const docs = r.json?.data || [];
  log(`  ${docs.length} Dokument(e):`);
  for (const d of docs)
    log(`    • docId=${d.id}  keyword=${d.keyword ?? '-'}  title="${d.title ?? '-'}"  file=${d.currentVersion?.filename ?? '-'}`);
  return docs;
}

async function downloadDocuments(returnId, docs) {
  if (!docs.length) {
    log('\n  ⚠ Keine Dokumente vorhanden — Label evtl. asynchron. Skript später erneut mit\n' +
        `     node scripts/retoure-poc.mjs --so=<id> --docs=${returnId}  laufen lassen (siehe unten).`);
    return;
  }
  step(9, `Dokumente herunterladen — GET /api/v1/returns/${returnId}/documents/{documentId}`);
  await mkdir('poc-out', { recursive: true });
  for (const d of docs) {
    const r = await api('GET', `/api/v1/returns/${returnId}/documents/${d.id}`, { accept: 'application/pdf, image/*' });
    if (r.buffer) {
      const ext = r.contentType.includes('pdf') ? 'pdf' : (r.contentType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
      const fn = `poc-out/return-${returnId}-doc-${d.id}.${ext}`;
      await writeFile(fn, r.buffer);
      log(`  ✓ ${fn}  (${r.contentType}, ${r.buffer.length} bytes)  ${d.keyword ? '['+d.keyword+']' : ''}`);
    } else {
      log(`  • docId=${d.id}: keine Binärdaten (Content-Type ${r.contentType})`);
    }
  }
}

// "Nur Dokumente nachladen"-Modus: --docs=<returnId> ohne neuen Beleg.
async function docsOnly(returnId) {
  const docs = await dumpDocuments(returnId, 'Abruf');
  await downloadDocuments(returnId, docs);
}

(async () => {
  log(`Instanz: ${BASE}`);
  if (args.docs) return docsOnly(args.docs);

  const reasons = await discoverReasons();
  const shippingMethods = await discoverReturnShippingMethods();
  const { soId, positions } = await resolveSalesOrder();

  if (!args.create) {
    log('\n' + '─'.repeat(60));
    log('Discovery fertig (read-only). Zum echten Anlegen + Label-Test:');
    log(`  node scripts/retoure-poc.mjs --so=${soId} --create --shipping=<id> --reason=<id>`);
    log('─'.repeat(60));
    return;
  }
  await createReturnFlow({ soId, positions, reasons, shippingMethods });
})().catch((e) => {
  console.error('\n✗ POC abgebrochen:', e.message);
  process.exit(1);
});
