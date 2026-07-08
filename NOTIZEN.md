# Notizen (Arbeitsstand, 2026-07-07)

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
- **E-Mail-Settings — alle drei Teilpunkte** (Entscheid 2026-07-07):
  1. `emailAccountId` in der Settings-UI vom nackten Zahlenfeld zum
     **Dropdown mit den Xentral-E-Mail-Konten** machen.
  2. **Konfigurierbare Mail-Vorlagen** für die Bestätigungsmail
     (= Paritäts-Punkt PLAN §1a Nr. 6).
  3. **Grundsatzfrage recherchieren**: ob/wie der E-Mail-Versand pro Projekt
     konfiguriert sein muss (Konto pro Projekt? Absender? Fallback?).
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
