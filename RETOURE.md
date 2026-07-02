# Retourenportal — POC & MVP0

Erweitert die Lieferstatus-Seite um die **Retoure-Anmeldung** und ersetzt damit
schrittweise das externe Xentral-Retourenportal. Dieses Dokument beschreibt den
**POC** (klärt das eine offene Risiko) und das **MVP0** (erster echter Flow).

## Architekturentscheidungen (aus der API-Recherche)

| Schritt | API | Warum |
|---|---|---|
| Auftrag/Status/Artikel | **V3** | bereits genutzt; lineItems/salesOrders v3 |
| Rücksendegründe | **V1** `returnReasons` | in V3 nicht vorhanden |
| Retouren-Versandarten | **V1** `shippingMethods` (Filter `supportReturns=true`) | in V3 nicht vorhanden |
| Retoure anlegen + Label | **V1** `returns` (+ `shippingMethod`) → `actions/release` → `documents` | **einziger** Pfad mit Versandart-Hebel **und** PDF-Download. V3 hat keine Label-Kette (kein `shippingMethod`, kein Dokument-GET). |

Zwei Dinge, die das alte Portal anders (schlechter) machte und wir hier auflösen:

- **Keine Versandart-Doppelpflege.** Das Portal liest die Retouren-Versandarten
  **live** aus Xentral (`shippingMethods` mit `supportReturns=true`). Jede in
  Xentral angelegte Retouren-Versandart steht automatisch zur Verfügung.
- **Least-Privilege-Token.** Das alte `returns-portal`-Token hatte `["*"]`.
  Hier reicht: `salesOrder:read, deliveryNote:read, returnReason:read,
  return:create, return:update`.

## POC-Ergebnis (verifiziert 2026-06-29 gegen `66d6a9db98f2b`)

Gegen echte Belege getestet — eindeutiges Ergebnis:

| Schritt | API | Ergebnis |
|---|---|---|
| Retoure anlegen | `POST /api/v1/returns` | ✅ HTTP 201, **Body leer → ID im `Location`-Header** |
| Freigeben | `POST /api/v1/returns/{id}/actions/release` | ✅ HTTP 204 |
| Versandart setzen | im Create-Body | ✅ `retoure.versandart = dhlreturn` |
| Label **abrufen** | `GET .../documents/{docId}` | ✅ echtes PDF (mit Retoure 20 bewiesen) |
| Label **erzeugen** | — | ❌ **kein API-Trigger** |

**Der Knackpunkt:** Das Retourenlabel entsteht erst bei der **„Verarbeitung im
Versandzentrum"** (dort ruft das `dhlreturn`-Modul den Carrier auf) — ein Schritt
**nach** der Freigabe, den die öffentliche API **nicht** auslöst (weder V1 noch
V3). Beweis: Retouren mit Label (20/30) haben im Protokoll „Verarbeitung im
Versandzentrum"; die per API angelegten (35/36) nicht → 0 Dokumente. Anlegen,
Freigeben und **Abrufen** gehen per API; nur die **Erzeugung** fehlt.

→ Für ein vollständiges MVP braucht es eins von beiden:
1. **Versandzentrum-Automatik** so konfigurieren/triggern, dass freigegebene
   (auch API-)Retouren automatisch verarbeitet werden → Label erscheint dann unter
   `documents` und kommt per E-Mail (offen: existiert die Automatik / greift sie
   bei API-Retouren?).
2. **API-Team** baut einen Generate-Label-Endpoint (= designte V3-Route #2,
   `POST /api/v3/returnOrders/{id}/actions/generateShippingLabel`).

Die Label-Erzeugung ist NICHT spec-/API-seitig lösbar — Risiko bestätigt.

### POC ausführen

`.env` mit `XENTRAL_BASE_URL` + `XENTRAL_API_TOKEN` (Schreib-Scopes!) füllen, dann:

```bash
# 1) Discovery (read-only): Gründe, Retouren-Versandarten, Auftragspositionen
node scripts/retoure-poc.mjs --order=<Auftragsnummer>

# 2) Echten Beleg anlegen + Label/Beleg nach ./poc-out/ laden (⚠ schreibt!)
node scripts/retoure-poc.mjs --so=<salesOrderId> --create --shipping=<id> --reason=<id>

# Dokumente einer bestehenden Retoure nachladen (falls Label asynchron kam)
node scripts/retoure-poc.mjs --docs=<returnId>
```

**Testinstanz `66d6a9db98f2b` (verifiziert):** DHL Retoure = `shippingMethod`
**id 21** (uuid `0194f568-…`, modul `dhlreturn`); Rücksendegründe id **1–14**
(z. B. 4 = „14 Tage Rückgaberecht").

Beobachtung (s. o.): `--create` legt die Retoure an + gibt sie frei, aber
`documents` bleibt leer, bis die Retoure im **Versandzentrum** verarbeitet wurde.
Zum Gegentest: Retoure in der Xentral-UI (Lager > Retouren) öffnen, über das
Aktion-Menü das Versandzentrum/Label anstoßen, dann `--docs=<id>` → das PDF
landet in `./poc-out/` (mit Retoure 20 verifiziert).

## MVP0 — was gebaut ist

Flow (mobil, ohne Client-JS, CSP-konform):

1. Statusseite (zugestellt) → Button **„Retoure anmelden"**.
2. `/retoure` zeigt die Artikel des Auftrags, je Artikel **Menge + Grund**, dazu
   die **Retouren-Versandart**.
3. Absenden → Retoure wird in Xentral **angelegt + freigegeben**.
4. Bestätigungsseite mit **Label-/Beleg-Download** (oder Hinweis, wenn das Label
   noch asynchron erzeugt wird).

**Sicherheit:** `/retoure` bekommt keine PLZ mehr. Nach erfolgreichem Status-
Lookup wird die `salesOrderId` per **HMAC-Token** (Schlüssel = PAT, 30 min
gültig) signiert und im Button mitgegeben. Alle Retoure-Routen akzeptieren nur
ein gültiges Token → kein Enumerieren/Auslösen allein mit einer Auftragsnummer.
Mengen werden serverseitig gegen die bestellte Menge geclampt; Writes sind
rate-limited.

### Dateien

- `scripts/retoure-poc.mjs` — POC (eigenständig, schreibt nur mit `--create`).
- `src/xentral.js` — Schreib-Helfer + Binär-Download + Return-Endpunkte.
- `src/returns.js` — Token-Signatur, `loadReturnable`, `submitReturn`, Dokumente.
- `src/server.js` — Routen `/retoure` (GET/POST) + `/retoure/label`.
- `src/views.js` — `renderRetoure`, `renderRetoureDone`, `renderRetoureError`.

## Umgesetzt nach MVP0

- **Mehrfach-/Über-Retoure-Schutz**: pro Auftragsposition wird die bereits
  retournierte Menge summiert (`GET /api/v1/returns?filter[0][key]=salesOrderId`
  → je Retoure `positions[].salesOrderPosition.id` + `quantity`, nur nicht
  stornierte). Restmenge = Bestellmenge − retourniert. Voll retournierte Artikel
  werden ausgegraut, das Mengenfeld auf den Rest begrenzt, der Server clamped hart.
- **Feste Retouren-Versandart (Punkt 1, Stufe A)**: Admin wählt unter `/admin`
  → Retouren eine Versandart; der Endkunde wählt nicht mehr. Versandart kommt
  beim Anlegen serverseitig aus der Config (nicht aus dem Client).
- **Admin-Seite mit Sektions-Navigation**: `/admin` mit linker Nav
  (Allgemein / Auftragsstatus / Retouren), section-scoped Speichern.
- **Bereits angemeldete Retouren + Label-Download**: `/retoure` zeigt oben die
  bestehenden (salesOrder-verknüpften) Retouren des Auftrags und bietet das
  Versandlabel direkt zum Download an (`/retoure/label?t=…&doc=…`); ist noch
  kein Label da, Hinweis „wird erstellt". Formular nur, wenn noch etwas
  retournierbar ist.

## Bewusst noch offen (Backlog)

- **Versandart-Regeln (Punkt 1)**: Regel-System im Admin (Kriterium Gewicht/Größe
  → Retouren-Versandart, oder fix); Endkunde wählt nicht mehr. Datengrundlage
  vorhanden (`product.measurements`: weight/netWeight + width/height/length).
- **Label-Trigger** über das Versandzentrum (s. o.).
- **Nur zugestellte** Aufträge zur Retoure zulassen (Gate auf `stage === 3`).
- **Teilaufträge/Splits**: aktuell Retoure auf den ersten Auftrag der Gruppe.
- **Stücklisten** (BOM-Kinder) einzeln retournierbar machen.
- Mengen-Match auch über `product.id` (manuelle Retouren ohne Positionsbezug).
- **Rückgabefrist** (Bestelldatum + X Tage) durchsetzen.
- **Projekt-Scoping** der Gründe (`returnReasons` project[]-Filter), Mehrsprachigkeit.
- Strategischer V3-Umzug für Create+Label, sobald das API-Team `shippingMethod`
  + Label-/Dokument-Abruf in `returnOrders` nachzieht.
