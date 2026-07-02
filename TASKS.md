# TASKS — Retourenportal-Umsetzung (Arbeitspakete)

Arbeitsweise: Tasks einzeln beauftragen („Setz Task B2 um"). Jeder Task ist so
beschrieben, dass er ohne weiteren Kontext startbar ist. Hintergrund: `PLAN.md`
(Zielbild/Recherche) und `RETOURE.md` (technischer Stand). Repos:
**Portal** = `~/work/repos/hammerschlag-lieferstatus` ·
**Xentral-Worktree** = `~/work/repos/retourenportal-settings-xentral`
(Branch `retourenportal-settings`, https://retourenportal-settings-xentral.test,
Login dev@xentral.com / Xentral123!).

Empfohlene Reihenfolge: **A1 → B0 → B1 → B2 → B3 → B4 → B5 → B6**, parallel D1–D3;
A2–A5 jederzeit einschiebbar; Block C nach B5; Block E zum Schluss.

---

## Block A — Portal-Härtung (Repo: Portal; sofort startbar, keine Abhängigkeiten)

### A1 · Stand sichern (Branch + Commits + Push)
- **Ziel:** Der gesamte uncommittete MVP0-Stand (Retoure-Flow, Stufe A, Admin-Nav, POC, Docs) ist versioniert.
- **Schritte:** Branch `retoure-mvp` von `main`; logisch getrennte Commits (1: xentral.js API-Client-Erweiterung, 2: returns.js+Routen+Views Retoure-Flow, 3: Stufe A feste Versandart, 4: Admin-Sektions-Nav, 5: scripts/retoure-poc.mjs, 6: RETOURE.md/PLAN.md/TASKS.md). Vorher prüfen: `.env`, `poc-out/`, `data/` sind gitignored. Push origin.
- **DoD:** `git log` sauber; Push erfolgreich; `git status` leer (bis auf ignorierte Dateien).

### A2 · Delivered-Gate erzwingen
- **Ziel:** „Retoure anmelden" nur für zugestellte Aufträge (Parität „Nur gelieferte Bestellungen"), als abschaltbare Option.
- **Schritte:** Config-Flag `returns.onlyDelivered` (Default an) in config.js + Admin-Sektion „Retouren"; in `lookup.js` liefert das Result bereits `stage` → Button in views.js nur bei `stage === 3` rendern; serverseitig absichern: Zustell-Status in den HMAC-Token aufnehmen (`order:<id>:delivered:<0|1>`) und in `/retoure` GET+POST prüfen.
- **DoD:** Nicht zugestellter Auftrag: kein Button + `/retoure` liefert Hinweisseite; zugestellter Auftrag unverändert; Offline-Smoke-Test für beide Zweige.

### A3 · Branding-Parität (klein)
- **Ziel:** Sekundärfarbe, Rechts-Links (Shop/Impressum/AGB/Datenschutz im Footer), Option „Preise anzeigen".
- **Schritte:** Felder in config.js/settings.js (Sektion Allgemein bzw. Retouren) + .env.example; Footer in views.js `layout()`; Preise: `loadReturnable` liefert Positionspreise (v1 salesOrder positions haben price) → Anzeige hinter Flag.
- **DoD:** Alle drei per Admin konfigurierbar und im Frontend sichtbar; Render-Smoke-Tests.

### A4 · Bestätigungs-Zwischenschritt
- **Ziel:** Wie altes Portal: Zusammenfassung („Du sendest zurück: 2× X wegen Y, Versand mit Z") vor dem Anlegen.
- **Schritte:** POST `/retoure` rendert bei fehlendem `confirm=1` eine Zusammenfassungsseite (Formular mit hidden fields aller Auswahlen + `confirm=1`); erst der zweite POST legt an. CSP-konform ohne JS.
- **DoD:** Anlage nur nach Bestätigung; Zurück-Link führt zur Auswahl mit erhaltenen Werten.

### A5 · i18n-Grundgerüst (DE/EN)
- **Ziel:** Alle kundensichtbaren Texte aus einem Sprachkatalog; Sprache per `?lang=` + Accept-Language, Default konfigurierbar (Zendesk-Thema 3).
- **Schritte:** `src/i18n.js` mit DE/EN-Katalog; views.js auf `t(key)` umstellen; Admin-Setting `defaultLocale`; Gründe: `language`-Feld der returnReasons nutzen (EN-Gründe wenn vorhanden).
- **DoD:** Kompletter Flow auf EN durchspielbar; fehlende Keys fallen auf DE zurück.

---

## Block B — Settings in Xentral (Repo: Xentral-Worktree; Kernstrecke Option B)

### B0 · Settings-Katalog + Entscheidungen finalisieren
- **Ziel:** Verbindliche Feldliste der Entity + offene Produkt-Entscheide geklärt (mit Christoph).
- **Schritte:** Aus PLAN.md-Paritätsmatrix Feldliste ableiten (Vorschlag: projektId, active, shippingMethodId, returnDeadlineDays, deadlineBasis[order|shipping|delivery], onlyDelivered, orderDateLimitHours, multiReturnLimit, onlyProjectOrders, showPrices, bomSplit, autoCreditNote, serviceEmail, emailAccountId, brandLogo?, accentColor, secondaryColor, shopName, Links, defaultLocale). Entscheide einholen: Login-Variante (PLZ vs. E-Mail+Shopnr), Branding in Xentral oder im Portal belassen, Feature-Flag-Name (SOP: kebab-case). Ergebnis in PLAN.md §4 einpflegen.
- **DoD:** Feldliste + Entscheide dokumentiert und von Christoph bestätigt.

### B1 · Migration + Tabelle `returnsportal_settings`
- **Ziel:** DB-Tabelle (eine Zeile pro Projekt) existiert per Laravel-Migration.
- **Schritte:** Im Worktree `php artisan make:migration` (Spalten aus B0; FK projekt, unique projektId; sinnvolle Defaults); Migration lokal ausführen; `database/schema/mysql-schema.sql`-Konventionen beachten. Wichtig: nicht-interaktive Shell braucht `export PHP_INI_SCAN_DIR="$HOME/Library/Application Support/Herd/config/php/83/"`.
- **DoD:** Migration läuft auf Worktree-DB durch (up+down), Tabelle vorhanden.

### B2 · Business Entity `ReturnsPortalSettings` scaffolden
- **Ziel:** Backend-Entity (Model, Schema, Mutation/Node) nach Business-Framework-Muster inkl. Validierung.
- **Schritte:** Skill `xentral:generate-business-entity` auf die Tabelle aus B1 anwenden; Validierungen deklarativ (Frist ≥ 0, Farben HEX, E-Mail-Format), sonst `create-validator`; Factory + `HasDefaults`.
- **DoD:** Entity registriert, Metadata-API kennt sie, Pest-Tests des Generators grün.

### B3 · Xentral-Frontend-Modul (Settings-UI)
- **Ziel:** Native Settings-Seite „Retourenportal" in Xentral (kein iFrame).
- **Schritte:** Skill `xentral:generate-business-entity-frontend` (vorher `mirai-development` laden); Navigation sinnvoll unter Lager/Stock; Spalten kuratieren; typecheck/lint/test bis grün; im Browser auf retourenportal-settings-xentral.test verifizieren.
- **DoD:** Settings pro Projekt in der Xentral-UI anleg-/editierbar; Browser-Smoke grün.

### B4 · API-Zugriff für das Portal
- **Ziel:** Portal kann die Settings lesen (auth + Scope geklärt).
- **Schritte:** Prüfen, wie die Entity nach außen exponiert ist (Business-Framework `/api/entity/...` self-describing — nicht in den OpenAPI-Specs!); Lese-Zugriff mit PAT auf dem Worktree per curl verifizieren; benötigte Scopes/Permissions dokumentieren (RETOURE.md); Fallback-Design falls Entity-API nicht PAT-tauglich: kleiner v3-Read-Endpoint (Skill api-v3-endpoint).
- **DoD:** curl mit PAT liefert die Settings eines Projekts als JSON; Doku aktualisiert.

### B5 · Portal-Settings-Sync
- **Ziel:** Portal liest die Xentral-Settings zur Laufzeit; Portal-Admin schrumpft auf Bootstrap.
- **Schritte:** Portal: `src/xentral-settings.js` (fetch + Cache ~60 s + Fallback auf lokale Werte bei Fehler); `returns.*`-Zugriffe auf die Remote-Settings umstellen (Projekt des Auftrags → passende Settings-Zeile); Admin-Sektion „Retouren" ersetzen durch Hinweis „wird in Xentral gepflegt" + Link; .env.example anpassen.
- **DoD:** Versandart-Änderung in Xentral wirkt (nach Cache-TTL) im Portal ohne Neustart; Ausfall der Settings-API bricht den Lieferstatus nicht.

### B6 · Tests, Lint, PR-Vorbereitung (Xentral-Core-Beitrag)
- **Ziel:** Worktree-Stand ist PR-reif fürs Owning-Team.
- **Schritte:** Pest-Tests nach Repo-Konventionen (auch ohne-Token/ohne-Scope-Fälle, falls v3-Endpoint); `composer lint:fix:updated` + `composer phpstan`; Feature-Flag nach SOP; `.github/CODEOWNERS` fürs Modul prüfen → Owning-Team identifizieren; PR-Beschreibung mit PLAN.md-Kontext entwerfen (nicht pushen ohne GO).
- **DoD:** Alle Checks grün; PR-Text liegt bereit; Owning-Team benannt.

---

## Block C — Paritäts-Features (nach B5)

### C1 · Frist- & Projekt-Gates im Portal
- Frist (Tage + Basis Bestell-/Versand-/Lieferdatum, RETURN-194) und `onlyProjectOrders` aus den Settings serverseitig durchsetzen; klare Kundenhinweise. **DoD:** abgelaufene Frist → Hinweis statt Formular.

### C2 · Retourenbedingungen-Engine (Stufe B)
- Design zuerst: Entity `ReturnsPortalCondition` (kombinierbare Regeln, RETURN-212; Kriterien: Gewicht/Maße via product.measurements, Artikel, Hersteller, Land, Kundengruppe/B2B → Zendesk-Thema 4; Ergebnisse wie altes Portal). Auswertung serverseitig im Portal; Xentral-UI via Entity-Frontend. **DoD:** mind. Gewichts-, Artikel- und B2B-Regel end-to-end.

### C3 · Auto-Gutschrift (Option)
- Recherche-Teil: API-Weg Gutschrift-aus-Retoure prüfen (v3 `creditNotes/actions/createFrom...`? sonst Lücke dokumentieren → ggf. zweiter API-Team-Request). Umsetzung hinter Setting `autoCreditNote`. **DoD:** Portal-Retoure erzeugt (bei aktivem Setting) automatisch Gutschrift ODER sauber dokumentierte API-Lücke.

### C4 · Bestätigungsmail
- `PATCH /api/v3/emailAccounts/{id}/actions/sendEmail` (Scope `mailAcct:sendEmail`, `emailAccountId` aus Settings); Textvorlage mit Variablen (Auftragsnummer etc., DE/EN); Label als Anhang, sobald vorhanden. **DoD:** Testkunde erhält Bestätigungsmail mit korrekten Variablen.

### C5 · Mehrere Rücksendeadressen
- Abhängig von Label-Route (D1): DHL-`returnReceiverId` pro Settings/Bedingung wählbar. **DoD:** Zwei Adressen konfiguriert, Regel wählt korrekt.

### C6 · Stücklisten-Split
- BOM-Kinder einzeln retournierbar (Option `bomSplit`); Positionen via `hasChildren/parent` auflösen. **DoD:** Stücklisten-Auftrag zeigt Kinder einzeln.

### C7 · Login-Variante E-Mail + Shop-Bestellnummer
- Nur falls in B0 entschieden. Zweitfaktor E-Mail statt PLZ (equals-only, fail-closed wie gehabt). **DoD:** beide Varianten parallel, per Settings wählbar.

---

## Block D — Extern/Abhängigkeiten (sofort anstoßbar, blockieren nichts)

### D1 · Jira-Ticket „generateShippingLabel" einstellen
- Fertiges API-Improvement-Template aus dieser Session in Jira anlegen (Projekt-Wahl mit Christoph: IMPAPI/AI2 vs. FFU; Code-Owner FFU bestätigen), POC-Beweise verlinken, Ticket-Link in PLAN.md §4/P0 eintragen. **DoD:** Ticket existiert, Link dokumentiert.

### D2 · CISC/GLS-Klärung
- Frage ans Shipping-/CISC-Team (Slack): Unterstützt das CISC-Backend GLS (und DPD/Hermes) downstream für Returns? Antwort in PLAN.md §6 dokumentieren. **DoD:** belastbare Aussage + nächste Schritte notiert.

### D3 · Interim-Label-Weg
- Auf 66d6a9db98f2b prüfen, ob sich die Versandzentrum-Verarbeitung für freigegebene (API-)Retouren automatisieren lässt (Prozessstarter/Autoversand-Konfig); dokumentieren. **DoD:** Interim-Weg beschrieben oder als nicht-konfigurierbar belegt.

---

## Block E — Rollout (zum Schluss)

### E1 · Pilot-E2E auf Testinstanz
- Kompletter Kundenflow inkl. Label (sobald D3/P0 liefert) auf 66d6a9db98f2b; Checkliste aus Paritätsmatrix abhaken. **DoD:** E2E-Protokoll grün.

### E2 · Migrations-Checkliste pro Kunde
- Schrittliste: PAT (least-privilege) anlegen, Settings in Xentral füllen, Portal deployen (DEPLOY.md), DNS/Shop-Link umstellen. **DoD:** Checkliste in DEPLOY.md ergänzt.

### E3 · Alt-Portal-Abschaltung
- Parallelbetrieb beenden: alte External-App deinstallieren, `returns-portal`-PAT (`["*"]`!) widerrufen. **DoD:** Alt-Zugriffe tot, Token revoked.
