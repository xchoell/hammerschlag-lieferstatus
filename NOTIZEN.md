# Notizen (Arbeitsstand, 2026-07-07)

## Fehlende Punkte: Carrier + Hosting (konsolidiert 2026-07-07)

**Carrier — Muster:** pro Anbieter braucht es (1) Assembler im SUP-87-Muster
(Spec §11a, API-Team), (2) ReturnLabelProcessor im Monolithen (existiert für
sendcloud/dhlreturn/ups_oauth/cisc), (3) instanzseitig Versandart mit
Credentials + support_returns. Portal selbst: keine Änderung nötig.

| Carrier | Fehlt | „Einfach erweiterbar?" (Code-Review 2026-07-07) |
|---|---|---|
| DHL Retoure | ✅ fertig (SUP-87) | — (nur Release) |
| Sendcloud | Assembler | **JA, einfach**: MetaData braucht `product` — Auto-Dispatch-Pfad nutzt heute schon `einstellungen['versandfirma']` aus der Versandart-Config (sendcloud.php:318); Assembler = gleiche Machart wie DHL (Config lesen). invoiceNumber ableitbar, Versicherung/Zoll default null |
| UPS | Assembler | **einfach–mittel**: MetaData braucht `deliveryNoteId` → ableitbar (Retoure→Auftrag→letzter LS; Edge-Case „Retoure ohne LS" sauber 422). Zoll-/COD-Felder erst mal Default (internationale Retouren ausklammern) |
| GLS/DPD/Hermes (CISC) | CISC-Assembler + D2 | **Architektur einfach**: UI übergibt `dropOffLocationData` schon heute LEER (cisc.php:124), labelOptions aus Config ableitbar. Risiko liegt NICHT im Code, sondern extern: unterstützt das CISC-Backend die Carrier downstream für Returns? (D2 offen) |
| Swiss Post | Return-Processor-Port | **NEIN**: kein ReturnLabelProcessor, Label-Code UI-gekoppelt (postch.php) — erst Port, dann Assembler; eigenes Arbeitspaket |
| Shipcloud | kein Code | **NEIN**: Neubau (Processor + Assembler) — oder Produktentscheid Migration zu Sendcloud/CISC |

Gemeinsamer Zusatzaufwand für Sendcloud/UPS/CISC (einmalig lösbar): Anders
als DHL (EmptyValidAddress) brauchen diese Prozessoren die **Kundenadresse**
im Command — der Assembler muss sie aus Retoure/Auftrag ableiten (Daten
liegen am Beleg; eine gemeinsame Helper-Query reicht für alle drei).

Nächste Schritte: D2 stellen · SUP-87-Team nach §11a-Timeline fragen ·
Shipcloud-Entscheid (Fulya-Runde) · alles ins Jira-Paket bündeln
(+ createFromReturnOrder + Protokolleintrag).

**Hosting — offene Schritte:** Grundsatz-Entscheid A (VPS-Pilot, DEPLOY.md
fertig) vs. Zielbild B (Container auf Xentral-Infra) · für B: Dockerfile +
Manifest, Infra-Buy-in, Secrets, Ingress/CNAME · Monitoring: NR-Anbindung
(❓ APM vs. Logs) + healthz-Alerting · E2-Checkliste pro Kunde in DEPLOY.md.

## Nachtrag 2026-07-07 (2)

- **Statistiken über Analytics**: Retouren-Auswertung (Volumen, Gründe —
  vgl. Top-25 Nr. 24 Gründe-Reporting) soll über die Xentral-**Analytics-
  Plattform** laufen statt über ein eigenes Portal-Reporting — die Daten
  liegen ja strukturiert in `retoure`/`retoure_position`.
- **Anzuzeigende Retourengründe definierbar machen**: Im Portal sollen nur
  ausgewählte Gründe erscheinen. Hebel existiert schon im Datenmodell:
  `returnReason` hat ein `isHidden`-Flag — prüfen, ob v1 `returnReasons`
  das respektiert/liefert; sonst Auswahl-Feld (Multi-Select) an unserer
  Settings-Entity.
- **Mit Fulya besprechen**: Wie verhält sich ein „Nachbau" des
  Retourenportals hier (Produkt-/Design-Sicht, Abgrenzung zum alten Portal)?
- **Ziel-Versanddienstleister** (Soll-Liste): **DHL Retoure** (✅ via SUP-87)
  / **Shipcloud** (⚠️ kein Xentral-Retourenlabel-Code — Klärung nötig, ob
  Anbindung neu entsteht oder Kunden via Sendcloud/CISC migrieren) /
  **Sendcloud** (SUP-87-Follow-up, Spec §11a) / **Swiss Post** (Code nur
  UI-gekoppelt, Port auf ReturnLabelProcessor nötig) / **GLS** (via
  CISC-Gateway, D2-Klärung mit Shipping-Team).

Lose Punkte aus der Review-Session — noch nicht in TASKS.md/PLAN.md überführt.
Rückfragen vom 2026-07-07 sind eingearbeitet; offen ist nur noch ❓ New Relic.

## Settings-UI / Entity

- **Pflichtfelder durchgehen — BEIDES** (Entscheid 2026-07-07):
  1. Xentral-Settings-Entity: welche Felder sollen beim Anlegen Pflicht sein
     (Kandidaten: Versandart, urlSlug — heute nullable)?
  2. Portal-Kundenformular: Pflichtfeld-Verhalten prüfen (Grund ist seit dem
     Mengen-Umbau Pflicht für gewählte Artikel; Rest checken).
- **E-Mail-Settings — alle drei Teilpunkte** (Entscheid 2026-07-07 → ERLEDIGT 2026-07-09):
  1. ✅ E-Mail-Konto als benannte Auswahl: neue Read-only-Entity `emailAccount`
     (emailbackup, ohne Credentials), Settings-Feld ist jetzt eine Referenz
     mit E-Mail-Adresse als Anzeige (statt nackter ID).
  2. ✅ Konfigurierbare Mail-Vorlagen: Pflichtfeld `confirmationMailTemplate`
     (businessLetterTemplate Typ Retoure); Portal verschickt über die native
     Send-Pipeline (Variablen, Beleg-PDF, Protokoll). Standard-Vorlage DE/EN
     als Factory-States.
  3. ✅ Recherche: Absender kommt beim nativen Versand aus den
     Projekt-Dokumenteinstellungen (`projekt.absendeadresse` — muss ein
     konfiguriertes Konto sein); das Settings-Konto dient nur noch der
     eingebauten Fallback-Mail.
- **Auto-Spaltenbreite für das Regelwerk**: Die Retourenbedingungen-Tabelle
  (lineItems-Sektion) soll automatische Spaltenbreiten bekommen —
  UI-Politur im EntityBase-Modul (B3).

## Betrieb / Nachvollziehbarkeit

- **Logging via New Relic** ❓ (Annahme, noch bestätigen: Portal-Prozess soll
  ins Fleet-Monitoring — passt zum Stabilitäts-Signal aus Zendesk und zum
  §7-Zielbild „Container auf Xentral-Infra". Offen: volles APM oder nur Logs?)
- **Protokolleintrag fehlt**: Bei API-Anlage entsteht KEIN
  `retoure_protokoll`-Eintrag „Retoure erstellt". Gewünscht:
  **„Retoure durch Retourenportal angelegt"** — damit im Beleg sichtbar ist,
  woher die Retoure kam (Parität: das alte Portal hinterließ Einträge als
  „Xentral Service Account"). Umsetzungsort vermutlich v1-`returns`-Create
  bzw. eigener Protokoll-Schritt — gehört ggf. mit ins D1-/API-Team-Paket.

## Produkt-Entscheide

- **Stücklisten/BOM (C6)** (Entscheid 2026-07-07: **Feature bleibt aktiv,
  nichts ausbauen**): Die fachliche Stücklistenfrage ist zu klären, bevor C6
  in den Rollout geht — u. a.: Sollen BOM-Kinder überhaupt einzeln
  retournierbar sein (Lager-/Gutschrift-Sicht)? Was passiert beim
  Wareneingang einer Kind-Retoure ohne Eltern? Wie verhält sich die
  Gutschrift (Kind hat anteiligen Preis)?

## Migration Alt-Portal → Neu

Kontext: Die Alt-Portal-Konfiguration liegt im externen Dienst, NICHT in den
Instanz-DBs — per Instanz-Sweep kommt man nur an instanzseitige Daten
(Versandarten, Gründe, PATs), nicht an die Portal-Config selbst.

- **Option A**: Konfigurationsdaten des alten Portals bei **Daniel
  Schmittchen** anfragen (Export/DB-Zugriff des externen Dienstes).
- **Option B**: Claude-Agent über alle Instanzen laufen lassen und die
  relevanten Daten snapshotten (AWX-Sweep; erfasst die instanzseitige Sicht:
  wer nutzt das Portal = `returns-portal`-PAT vorhanden, Versandarten mit
  `support_returns`, Gründe-Kataloge, Retouren-Volumen).
- Vermutlich braucht es **beides**: A für die Portal-Settings,
  B für die Priorisierung/Checkliste pro Kunde (Block E2).

## API-Team

- **„Versandarten → Retouren unterstützt" per API — Info für Marcel**
  (Entscheid 2026-07-07: nur als Hinweis aufnehmen): Die Lese-Route existiert
  bereits — v1 `GET /api/v1/shippingMethods` liefert pro Methode
  `supportReturns` (+ `supportDeliveries`); das Portal nutzt genau das für
  die Retouren-Versandarten-Liste. Eine v3-Entsprechung fehlt (nur falls
  später relevant).
