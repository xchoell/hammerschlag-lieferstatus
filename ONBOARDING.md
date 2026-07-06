# Onboarding — Projekt „Eigenes Retourenportal"

Stand: 2026-07-06. Zielgruppe: Kolleg:innen, die neu ins Projekt einsteigen.
Dieses Dokument bündelt Anforderungsprofil, Umsetzungsstand und Rechercheergebnisse.
Tiefe Details stehen in den verlinkten Repo-Docs (→ Doku-Landkarte ganz unten).

---

## 1. Worum geht es?

Wir bauen ein **eigenes externes Retourenportal**, das Xentrals bestehendes
externes Retourenportal ablöst. Es baut auf der vorhandenen Lieferstatus-App
auf (`github.com/xchoell/hammerschlag-lieferstatus`, Node/Express-Edge-Service):
Endkunde authentifiziert sich mit Bestellnummer + Zweitfaktor, sieht den
Lieferstatus und kann nach Zustellung eine Retoure anmelden — Artikel + Menge +
Grund wählen, Retoure entsteht als echter Beleg in Xentral, Retourenlabel zum
Download.

**Warum ablösen?** Das alte Portal ist eine externe App mit Voll-Zugriffs-PAT
(`abilities=["*"]`), eigener (unsynchroner) Konfigurationswelt außerhalb der
Instanz (Versandarten-Doppelpflege, Gründe-Drift → RETURN-168) und dem lautesten
Zendesk-Signal überhaupt: **Instabilität** (≥10 Ausfall-Meldungen in 4 Monaten).
Viele offene RETURN-Bugs sind Settings-Verlust/Instanz-Vermischung
(RETURN-251/249/237/215/78).

**Kernentscheidung (Option B):** Die Portal-Konfiguration lebt **in Xentral**
als Business Entity (eine Zeile pro Projekt) mit nativer Settings-UI; das
Portal liest sie zur Laufzeit per API und erzwingt alle Gates serverseitig.
Kein iFrame, keine Zweitpflege, kein Zweit-Login, Least-Privilege-PAT.

---

## 2. Anforderungsprofil (konsolidiert)

Quellen: Feature-Parität mit dem alten Portal (Handbuch + Live-Analyse),
Jira-Projekt `RETURN` (54 offene Issues), Zendesk-Auswertung (100 jüngste von
1.255 Treffern, Feb–Jul 2026). Vollständige Matrix: [PLAN.md](PLAN.md) §1–3.

### Endkunden-Flow
- Login mit Nummer (Auftrags-/Bestell-/Shop-/Lieferscheinnummer, 4 Strategien)
  + Zweitfaktor **PLZ, E-Mail oder Kundennummer** (pro Portal wählbar)
- Lieferstatus (4 Stufen, Carrier-Live-Abfrage DHL), Splits/Teilaufträge gruppiert
- Retoure: Artikel/Menge/Grund je Position, Zusammenfassung → bestätigen → Beleg
- Label + Retourenbeleg herunterladen; Bestätigungsmail
- Optionen: Preise anzeigen, Stücklisten-Kinder einzeln retournieren
- Mehrsprachig (DE/EN, erweiterbar), pro Projekt gebrandet

### Regeln & Gates (pro Projekt, alle serverseitig erzwungen)
- Portal je Projekt aktivierbar; nur Aufträge des Projekts auffindbar
- Rückgabefrist (Tage, Basis konfigurierbar — RETURN-194), Bestelldatum-Sperre (h)
- Nur gelieferte Bestellungen; Mehrfach-Retouren-Limit (positionsgenaue Restmengen)
- **Retourenbedingungen-Engine** (kombinierbare Wenn→Dann-Regeln, RETURN-212):
  Kriterien Gewicht/Artikel/Hersteller/Land/B2B|B2C → Effekte Artikel ausschließen /
  Retoure blocken / andere Versandart
- Auto-Gutschrift als Option (stark nachgefragt: ZD 298037, 293069)

### Versand & Label
- Retouren-Versandarten **live aus Xentral** (`supportReturns=true`) statt Doppelpflege
- Label automatisch erzeugen + per Mail (= P0, s. Recherche) 
- Mehrere Rücksendeadressen (DHL returnReceiverId; RETURN-83/170)
- Carrier-Ziel: DHL Retoure, Sendcloud, UPS, CISC (GLS & Co. via CISC-Gateway)

### Branding & Texte
- Pro Projekt: Shopname, Akzent-/Sekundärfarbe, Service-E-Mail, Rechts-Links
  (Shop/Impressum/AGB/Datenschutz), Standardsprache; Logo vorerst im Portal
- Bestätigungsmail-Vorlagen (DE/EN, Variablen), Infotexte (später)

### Delighter-Backlog (aus Zendesk/Jira, P5)
Versandkosten/Rabatte ausblenden, Selbstzahler-Retoure (RETURN-204),
Auftragsnr. als Labelreferenz, Reject-Workflow, Gründe-Reporting, Webhook,
Marktplatz-Meldungen (Tradebyte/Zalando).

---

## 3. Architektur & Schlüsselentscheidungen

| Entscheidung | Begründung |
|---|---|
| Settings als **Business Entity `returnsPortalSetting`** in Xentral, eine Zeile pro Projekt; Bedingungen als Kind-Collection (`lineItems`) | Settings-Verlust-Bugklasse des Alt-Portals strukturell beseitigt; native UI; ein Login |
| Portal liest per **Entity-API** (`GET /api/entity/returnsPortalSetting`, Scope `entity:returnsPortalSetting:read`) mit 60-s-Cache + Stale-Fallback | Änderungen wirken ohne Neustart; API-Ausfall bricht nichts |
| **V3 als Default, V1 nur wo zwingend**: Gründe + Retouren-Versandarten + Retoure-Create+Label nur in V1 | V3 hat keine Label-Kette (kein `shippingMethod` im Create, kein Dokument-GET — systemisch für alle V3-Belege) |
| Alle Gates/Mengen-Clamps **serverseitig**; `/retoure` nur mit signiertem HMAC-Token aus dem Status-Lookup (30 min, trägt salesOrderId + Zustell-Status + Projekt) | Kein Enumerieren, kein Client-Downgrade, kein Oracle (immer generisches 404) |
| Kundenseiten **ohne Client-JS** (strenge CSP), mobil-first | Angriffsfläche + Einfachheit |
| Pro-Projekt-Frontend **`/p/<slug>`** (urlSlug an der Entity) | Ein Deployment bedient viele Projekte, komplett gebrandet |
| Least-Privilege-PAT statt `["*"]` | Ablösung = external_app tauschen, Token eng scopen |

---

## 4. Umsetzungsstand (was ist fertig)

Alles Folgende ist **umgesetzt, E2E-verifiziert und committet**. Details je
Feature: [RETOURE.md](RETOURE.md).

**Block A — Portal-Härtung (komplett):** Delivered-Gate (abschaltbar),
Branding-Parität (Sekundärfarbe, Rechts-Links, Preise-Option),
Bestätigungs-Zwischenschritt, i18n DE/EN (Katalog, `?lang=`/Cookie/
Accept-Language, Projekt-Default).

**Block B — Settings in Xentral (komplett, Branch `retourenportal-settings`):**
Migration + Entity `ReturnsPortalSetting` (23 Felder, Validatoren, i18n de/en/nl,
32/32 Tests grün) · native Settings-UI unter Einstellungen →
Inventory & Fulfillment → Retourenportal · API-Zugriff mit PAT inkl. verifizierter
Auth-/Scope-Matrix · Portal-Settings-Sync (Cache/Fallback) · PR-Vorbereitung
(7 Commits, PR-Text in [XENTRAL-PR.md](XENTRAL-PR.md), **noch nicht gepusht — wartet auf GO**).

**Pro-Projekt-Frontend `/p/<slug>`** (ungeplant dazu): Slug-Feld mit
Auto-Ableitung aus dem Projektnamen, Branding-Overlay, Projekt-Gate,
Slug-Scan-Schutz.

**Block C — Parität (fertig bis auf C5):**
- **C1** Frist-/Zeitfenster-Gates (Frist, Bestelldatum-Sperre, Mehrfach-Limit;
  Hinweis statt Formular, POST 403)
- **C2** Retourenbedingungen-Engine (kombinierbare Regeln als Entity-Kind-Collection,
  Auswertung serverseitig; Gewichts-/Artikel-/B2B-Regeln E2E bewiesen)
- **C4** Bestätigungsmail (`sendEmail`-API, Konto aus Settings, DE/EN, Anhänge,
  fire-and-forget)
- **C6** Stücklisten-Split (BOM-Kinder einzeln; Eltern via `parent`-Referenz —
  v1-`hasChildren` steht fälschlich auf den Kindern!)
- **C7** Login-Varianten zip/email/customerNumber (Server bestimmt Variante,
  equals-only, fail-closed)
- **C3** = bewusst NICHT gebaut: Auto-Gutschrift ist eine dokumentierte
  API-Lücke mit fertigem Endpoint-Design (s. Recherche)

**Außerdem seit MVP0:** Mehrfach-/Über-Retoure-Schutz (positionsgenaue
Restmengen), Label-Download bestehender Retouren, Admin-Seite mit
Sektions-Navigation, POC-Skript `scripts/retoure-poc.mjs`.

**Repo-Stand:** Portal `retoure-mvp` gepusht bis `2ddc2ae` · Xentral-Worktree
`retourenportal-settings` committet bis `5a98232d` (7 Commits auf main
`6feaa400856`, ungepusht) · Checks: 32/32 Entity-Tests, PHPStan 0, mago clean, nx grün.

---

## 5. Rechercheergebnisse (das Wichtigste zuerst)

### P0-Blocker: Label-Erzeugung ist NICHT per API auslösbar
Per POC gegen echte Belege bewiesen (Instanz `66d6a9db98f2b`, 2026-06-29):
Anlegen (`POST /api/v1/returns`, 201, **ID nur im Location-Header**), Freigeben
(204) und Label-**Abruf** (`…/documents/{id}` = echtes PDF) funktionieren.
Das Label **entsteht** aber erst bei der „Verarbeitung im Versandzentrum"
(dort ruft z. B. `dhlreturn` den Carrier) — diesen Schritt löst keine öffentliche
API aus (weder V1 noch V3). Beweis über `retoure_protokoll`-Vergleich.
→ Lösungswege: Versandzentrum-Automatik für API-Retouren (Task D3, offen)
oder neue API-Route (Task D1, Design fertig).

### Fertige Endpoint-Designs fürs API-Team (→ D1, Jira-Improvement)
1. **`POST /api/v3/returnOrders/{id}/actions/generateShippingLabel`** —
   Machbarkeit im Monolithen verifiziert: Kern ist
   `CreateLabelCommandHandler::handleReturn()` (UI-frei). Entscheid: generische
   Route (Dispatch über das Versandart-Modul der Retoure, MetaData-Factory pro
   Carrier; DHL zuerst, nicht unterstützte → 409). `LabelProcessResolver`
   kennt heute nur sendcloud/dhlreturn/ups_oauth/cisc; Shipcloud hat KEINEN
   Xentral-Retourenlabel-Code, Post.CH ist UI-gekoppelt → Carrier-Parität
   gehört mit ins Ticket.
2. **`POST /api/v3/creditNotes/actions/createFromReturnOrder`** (C3-Ergebnis):
   Es gibt keinen API-Weg Retoure→Gutschrift; der interne Handler
   `Retoure::createCreditNote()` (www/pages/retoure.php:1349) existiert fertig —
   die Route ist ein dünner Wrapper.

### Weitere verifizierte API-Fakten
- V3-Lücken systemisch: kein `shippingMethod` im returnOrders-Create, `actions/send`
  verschickt nur Mail, `/files` hat keinen GET-Download (gilt für ALLE V3-Belege);
  `returnReasons`/`shippingMethods` existieren nur in V1.
- v1-Pagination braucht `page[number]`+`page[size]` (≤50), nicht `page=1`.
- Retouren-Filter heißt `salesOrderId`; Mengen-Match über `salesOrderPosition.id`.
- E-Mail-Versand per API: `PATCH /api/v3/emailAccounts/{id}/actions/sendEmail`
  (Anhänge base64 ≤10 MB; kein List-Endpoint für Konto-IDs → Setting).
- Entity-API-Auth-Matrix (Flags `business-framework-api`, `bf-entity-authorization`,
  Admin-Bypass, stilles Projekt-Row-Filtering): RETOURE.md §„Auth-Mechanik".
- **Gefundene v1-Bugs** (für Bugreport bündeln): `salesOrders/{id}` wirft 500 bei
  leerer Zahlungs-/Versandart; `hasChildren` markiert Kinder statt Eltern.

### Analyse des alten Portals (Ablöse-Wissen)
Externe App per PAT (`personal_access_tokens` id 2, `returns-portal`,
`abilities=["*"]`) — kein instanz-gerendertes Modul. Die gesamte Portal-Config
(Landingpage, Fristen, Bedingungen, eigene Versandart-Liste) liegt NICHT in der
Instanz-DB, sondern im externen Dienst → Quelle des Lock-ins, **keine
Settings-Migration möglich** (pro Kunde Neukonfiguration). Ergebnis-Belege
landen in `retoure`/`retoure_position`. Gründe: `rma_vorlagen_grund` (+
Kategorien mit Automatik-Aktion). DHL Retoure auf der Testinstanz =
Versandart id 21, `modul=dhlreturn`.

### Carrier-Strategie / CISC
**CISC = Carrier Integration Service**, Xentrals generisches Carrier-Gateway
(standardisiertes REST-Protokoll inkl. `createReturnLabel`). GLS/DPD/Hermes
sollen darüber laufen, nicht als Einzelintegrationen (das alte Portal nutzte
Shipcloud-Aggregation). Offene Frage ans Shipping-Team: unterstützt das
CISC-Backend GLS & Co. downstream für Returns? (= Task D2)

---

## 6. Offene Punkte (Reihenfolge)

1. **GO für Push + PR** des Xentral-Branches (PR-Text fertig); vor Prod:
   LaunchDarkly-Flag `returns-portal-settings`
2. **D1** Jira-API-Improvement (beide Routen oben); fehlt nur die Projekt-Wahl
3. **D2** CISC/GLS-Frage ans Shipping-Team · **D3** Interim-Label via
   Versandzentrum-Automatik prüfen
4. **C5** mehrere Rücksendeadressen (blockiert durch D1/Label-Route)
5. **Block E** Rollout: Pilot-E2E inkl. Label (blockiert durch P0),
   Migrations-Checkliste pro Kunde, Alt-Portal + `["*"]`-PAT abschalten
6. Kleinkram: PLAN.md-§4-Feldkatalog hat Doku-Drift (alte Enum-Werte, kein
   urlSlug/lineItems); v1-Bugs als Bugreport einreichen

---

## 7. Dev-Setup & Demo-Strecke

- **Repos:** Portal `~/work/repos/hammerschlag-lieferstatus` (Branch `retoure-mvp`) ·
  Xentral-Worktree `~/work/repos/retourenportal-settings-xentral`
  (Branch `retourenportal-settings`, https://retourenportal-settings-xentral.test,
  UI-Login admin / `Xentral123!`)
- **Portal starten:** `npm run dev:xentral-worktree` (Port 3000) — NICHT
  `npm start`: der Settings-Fetch scheitert sonst still am Herd-Zertifikat.
  Single-Instance-Setup: `data/settings.json` (überschreibt .env!) zeigt auf
  die Worktree-Instanz.
- **Demo:** `http://127.0.0.1:3000/p/standard-1`, Auftrag `200005` /
  PLZ `24804` (Kundennummer `10005`, E-Mail `rosel-philipp@example.com` für die
  Login-Varianten). Projekt 1 hat 3 Demo-Bedingungen (Gewicht≥30→Spedition,
  `BK-*`→ausschließen, B2B→blocken); BOM-Kinder unter Position 2.
- **Settings-UI:** `/app/settings/inventory-and-fulfillment/returns-portal-setting`
  (Flags lokal via `feature_flags.php`; Frontend-Build `make local-build-frontend`)
- **Mails:** `php artisan queue:work --queue=crm-email`; Dev-Konto emailbackup
  id 1 → Herd-Mail-Catcher :2525
- Weitere Fallen (PHP_INI_SCAN_DIR, Test-DB, Playwright): RETOURE.md + Memory

## 8. Doku-Landkarte

| Dokument | Inhalt |
|---|---|
| [PLAN.md](PLAN.md) | Zielbild, Paritätsmatrix, Jira-/Zendesk-Recherche, Phasen, Risiken, Carrier-Strategie |
| [TASKS.md](TASKS.md) | 25 self-contained Arbeitspakete (Blöcke A–E) mit DoD |
| [RETOURE.md](RETOURE.md) | Technischer Stand: POC-Beweise, Auth-Matrix, Settings-Sync, `/p/<slug>`, C1–C7 |
| [XENTRAL-PR.md](XENTRAL-PR.md) | Fertiger PR-Text für den Xentral-Core-Beitrag inkl. Reviewer |
| ONBOARDING.md | dieses Dokument |
