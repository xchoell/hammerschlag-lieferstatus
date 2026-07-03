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

## Settings aus Xentral (Option B) — Entity-API, B4-verifiziert

Die Portal-Settings leben als Business Entity `ReturnsPortalSetting` in Xentral
(eine Zeile pro Projekt) und werden vom Portal **per PAT über die Entity-API**
gelesen — live verifiziert am 2026-07-03 auf dem Xentral-Worktree
(`retourenportal-settings-xentral.test`, Branch `retourenportal-settings`).
**Ein v3-Fallback-Endpoint ist NICHT nötig.**

```
GET /api/entity/returnsPortalSetting
    ?filter[0][key]=project&filter[0][op]=equals&filter[0][value]=<projektId>
    &filter[1][key]=isActive&filter[1][op]=equals&filter[1][value]=1
Authorization: Bearer <PAT>
Accept: application/json
```

Antwort: `{"data":[{ project:{id}, isActive, loginVariant, defaultLocale,
returnDeadlineDays, deadlineBasis, shouldRequireDelivery, orderDateLimitHours,
shouldLimitToSingleReturn, shouldRestrictToProjectOrders, shouldShowPrices,
shouldSplitBillOfMaterials, shouldAutoCreateCreditNote, shippingMethod,
serviceEmail, emailAccountId, accentColor, secondaryColor, shopName, shopLink,
imprintLink, termsLink, privacyLink, id, uuid, … }], "meta": {…}}` —
Einzelabruf via `GET /api/entity/returnsPortalSetting/{uuid}`.

### Auth-Mechanik (Code + Live-Matrix)

Middleware-Kette (`config/business-framework.php` im Xentral-Repo):
`api` → `auth:sanctum` (= normale Xentral-PATs) → `businessFrameworkApiAccess`
(Feature-Flag-Gate) → `PermissionOperationAuthorizer` (Scopes).

| Fall | HTTP |
|---|---|
| ohne Token | 401 |
| PAT, Flag `bf-entity-authorization` **aus** | **200** (jeder authentifizierte PAT darf alles) |
| Flag an, PAT-User ist **Admin** | 200 — **Admin-Bypass, Token-Scopes werden ignoriert** |
| Flag an, Nicht-Admin ohne User-Scope | 403 |
| Flag an, User-Scope da, Token ohne Scope-Rows | 200 (leere Token-Scope-Liste = alles, was der User darf) |
| Flag an, Token-Scope nur `…:mutate` | 403 auf GET |
| Flag an, Token-Scope `entity:returnsPortalSetting:read` | 200 |
| User per `user_project_access` auf fremdes Projekt beschränkt | 200, aber **leere Liste** (leises Row-Filtering) |
| Feature-Flag `business-framework-api` **aus** | **404** — auch mit gültigem PAT |

### Scopes & Betriebs-Voraussetzungen (pro Kundeninstanz)

- Scope-Keys (Quelle `EntityScopeRegistry`, Prefix `entity:`):
  `entity:returnsPortalSetting:read` / `:mutate` / `:delete`. Registrierung in
  der `scopes`-Tabelle via `php artisan scopes:sync` (Gruppe „Configuration").
  Das Portal braucht nur **`entity:returnsPortalSetting:read`**.
- Feature-Flag **`business-framework-api`** muss an sein (LaunchDarkly), sonst
  404 für die gesamte Entity-API.
- Least-Privilege-PAT: **Nicht-Admin-Service-User** anlegen, User-Scope per
  `user_permissions` granten, Token-Scope-Row in
  `personal_access_token_permissions`. (Ein Admin-PAT funktioniert immer,
  umgeht aber jede Scope-Beschränkung — nicht empfohlen.)
- Ist `bf-entity-authorization` (noch) aus, reicht irgendein gültiger PAT.
- Achtung Projektrechte: hat der PAT-User `user_project_access`-Zeilen, sieht
  er nur Settings seiner Projekte — falsch gescopter User äußert sich als
  „Settings nicht gefunden", nicht als Fehler.

### Settings-Sync im Portal (B5, umgesetzt + E2E-verifiziert 2026-07-03)

`src/xentral-settings.js` löst die effektiven Retouren-Settings **pro Projekt
des Auftrags** auf (Projekt kommt als drittes Segment in den Order-Token):

- **Quelle Xentral**: Entity-Zeile des Projekts → `active` (isActive),
  `shippingMethodId` (shippingMethod.id), `onlyDelivered`
  (shouldRequireDelivery), `showPrices` (shouldShowPrices); alle übrigen Felder
  liegen in `raw` für die kommenden Gates (C1 ff.).
- **Cache** pro Projekt (`RETURNS_SETTINGS_CACHE_TTL_MS`, Default 60 s) →
  Änderungen in Xentral wirken ohne Neustart (verifiziert: isActive=0 in
  Xentral → Portal zeigt nach TTL „deaktiviert", zurück auf 1 → Flow wieder da).
- **Fallback-Kette bei Fehlern**: letzter bekannter Stand (stale, mit
  TTL-Backoff gegen Hammering), sonst lokale `.env`-Werte. Ein API-Ausfall
  bricht den Lieferstatus nicht (verifiziert: Entity-API 404 → `/status` 200,
  `/retoure` liefert letzten Stand, Warnung im Log).
- **Keine Zeile fürs Projekt** oder kein Projekt am Auftrag → lokale Werte
  (Bootstrap-Verhalten). `isActive=false` → Retoure-Flow bewusst AUS
  (eigene Fehlerseite, kein Token auf der Statusseite).
- Portal-`/admin` → Retouren zeigt nur noch den Hinweis „wird in Xentral
  gepflegt" + Direktlink auf die Settings-Seite; lokale Fallback-Werte leben
  in der `.env` (RETURN_SHIPPING_METHOD_ID, RETURNS_ONLY_DELIVERED,
  RETURNS_SHOW_PRICES).
- **Split-Dev-Setup** (Aufträge = Cloud-Testinstanz, Entity = Worktree):
  `RETURNS_SETTINGS_BASE_URL` + `RETURNS_SETTINGS_TOKEN` überschreiben die
  Quelle nur für die Settings; leer = gleiche Instanz + PAT wie alles andere
  (Prod-Normalfall).

### Pro-Projekt-Frontend `/p/<slug>/…` (umgesetzt + E2E-verifiziert 2026-07-03)

Jedes Projekt bekommt sein eigenes Portal-Frontend unter einem Pfad-Präfix —
Startseite, Lieferstatus UND Retoure laufen komplett gebrandet unter
`…/p/<slug>/`; das unpräfixte Portal bleibt als Default (lokales Branding).

- **Slug** = neues Feld `urlSlug` an der Xentral-Entity (Einstellungen →
  Retourenportal), beim Anlegen automatisch aus dem Projektnamen vorbelegt
  (`DeriveProjectCalculator`; Namenskollision → `-<projektId>`-Suffix, live
  bewiesen: zwei Projekte „Standard" → `standard` + `standard-1`). Eindeutigkeit
  + Format (`[a-z0-9-]`) erzwingt der Backend-Validator.
- **Auflösung**: `getSettingsBySlug` (xentral-settings.js) holt die Zeile per
  `filter[urlSlug]`, Cache + Stale-on-error wie beim Projekt-Lookup; auch
  „nicht gefunden" wird gecacht (Slug-Scans). Unbekannter/inaktiver Slug → 404.
- **Kontext**: `portal-context.js` (AsyncLocalStorage) trägt Slug + Settings
  durch den Request. `currentBrand()` überlagert config.brand feldweise mit
  shopName/serviceEmail/accentColor/secondaryColor/Links der Zeile;
  `portalPath()` präfixiert alle internen Links/Formulare; die
  Projekt-`defaultLocale` hängt in der i18n-Fallback-Kette.
- **Projekt-Gate**: „Nur Aufträge dieses Projekts" (shouldRestrictToProjectOrders,
  Default an) macht Aufträge fremder Projekte unter dem Portal unauffindbar
  (404 bei Lookup UND bei fremden Retoure-Tokens).
- Logo bleibt vorerst global (B0: Logo-Upload lebt im Portal), Login-Variante
  `customerNumber` ist bisher nur Setting (Portal-Login = C7).

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
