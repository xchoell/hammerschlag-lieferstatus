# Retourenportal — Zielbild & Umsetzungsplan

Stand 2026-07-02. Quellen: Xentral-Handbuch (help.xentral.com 9726301921692 u. a.),
Jira-Projekt `RETURN` (54 offene Issues), Zendesk-Auswertung (100 jüngste von 1.255
Treffern zu „Retourenportal", Feb–Jul 2026), Code-Analyse Xentral-Monolith
(Worktree `retourenportal-settings-xentral`).

---

## 1. Feature-Parität mit dem alten Retourenportal (Mindestumfang)

Legende: ✅ = im neuen Portal (MVP0) vorhanden · 🔶 = teilweise · ❌ = fehlt noch

### Kundensicht (Endkunden-Flow)
| Feature (altes Portal) | Status neu | Anmerkung |
|---|---|---|
| Login B2C: E-Mail + Shop-Bestellnummer | 🔶 | Wir: Nummer (4 Varianten) + PLZ. Paritäts-Entscheid nötig: E-Mail-Variante ergänzen? |
| Login B2B: Kundennr + Auftragsnr | 🔶 | dito |
| Artikel wählen, Menge, Grund je Position | ✅ | Gründe direkt aus Xentral (altes Portal: eigener, UNsynchroner Katalog → RETURN-168) |
| Zusammenfassung + bestätigen | 🔶 | Wir legen direkt an; Bestätigungs-Zwischenschritt fehlt |
| Label + Retourenbeleg herunterladen | ✅ | Abruf bewiesen; **Erzeugung = P0-Blocker** (s. Hürden) |
| Weitere Retoure direkt starten | ✅ | Statusseite → erneuter Flow |
| Preise anzeigen (Option) | ❌ | klein |
| Stücklisten-Bestandteile einzeln retournieren (Option) | ❌ | Backlog (BOM) |

### Regeln & Gates (pro Projekt)
| Feature | Status neu | Anmerkung |
|---|---|---|
| Portal je Projekt aktivierbar | ❌ | → Settings-Entity P1 |
| Rückgabefrist (Tage) | ❌ | P1; Basis konfigurierbar machen (Bestell-/Versand-/Lieferdatum — RETURN-194, ZD 294254) |
| Bestelldatum-Limit (24 h) | ❌ | P1, klein |
| Nur gelieferte Bestellungen | 🔶 | Status-Logik existiert (stage 3), Gate noch nicht erzwungen |
| Mehrfach-Rückgabe-Limit | ✅ | Restmengen-Logik übertrifft altes Portal (positionsgenau) |
| Nur Aufträge dieses Projekts | ❌ | P1 |
| Retourenbedingungen (Regel-Engine: Wenn→Dann; Ergebnisse: kein Label / Carrier X / Adresse Y / nicht rücksendbar / Service kontaktieren) | ❌ | = unsere „Stufe B", Xentral-seitig definieren; kombinierbare Regeln gewünscht (RETURN-212) |
| Gutschrift mit Retourenerstellung (Option) | ❌ | P4; stark nachgefragt (ZD 298037, 293069) |

### Versand & Label
| Feature | Status neu | Anmerkung |
|---|---|---|
| Carrier: Shipcloud, Sendcloud, Swiss Post, DHL Retoure (separat im Portal angebunden) | 🔶 | Neues Konzept: **Xentral-Versandarten statt Zweitanbindung**. Heute API-tauglich in Xentral: DHL Retoure, Sendcloud, UPS, CISC. Lücken: Shipcloud (kein Xentral-Code!), Post.CH (nur UI-gekoppelt) |
| Standard-Versanddienstleister global + pro Projekt | 🔶 | Stufe A = eine feste Versandart; pro Projekt → P1 |
| Mehrere Rücksendeadressen | ❌ | P4 (DHL: Retourenempfänger; ZD 294021/293094, RETURN-83/170) |
| Label automatisch erzeugen + per Mail | ❌ | **P0**: Route `generateShippingLabel` liegt beim API-Team; Mailversand-API (`sendEmail` mit Anhang) ist verifiziert vorhanden |

### Texte, Mails & Branding
| Feature | Status neu | Anmerkung |
|---|---|---|
| Bestätigungsmail-Text (DE/EN, Variablen) | ❌ | P4; Persistenz-Bugs im alten Portal (RETURN-251/197) |
| Infotexte (Allgemein/Artikel/Bestellung) | ❌ | P4/P5 |
| „Service kontaktieren"-Text + Service-E-Mail | ❌ | P4 |
| Logo, Akzent-/Sekundärfarbe, Shopname | 🔶 | Logo/Farbe/Name da; Sekundärfarbe fehlt |
| Links: Shop/Impressum/AGB/Datenschutz | ❌ | klein, P1 |
| Personalisierung pro Projekt | ❌ | P1-Settings pro Projekt |

### Ergebnis in Xentral
| Feature | Status neu | Anmerkung |
|---|---|---|
| Retoure-Beleg angelegt, Wareneingang-ready | ✅ | V1-API create+release, verifiziert |
| Tracking am Beleg | 🔶 | hängt an Label-Erzeugung (P0) |

---

## 2. Offene Feature-Requests im Jira-Projekt RETURN (nicht umgesetzt)

Abfrage: `project = "RETURN" AND statusCategory != Done` (Achtung: RETURN in
JQL **quoten**, sonst MCP-Fehler). 54 offen, davon relevante Feature-Requests:

| Key | Wunsch | Für neues Portal |
|---|---|---|
| RETURN-204 | Retourenkosten dem Endkunden belasten (Selbstzahler) | P5 (+ ZD 294933) |
| RETURN-212 | Mehrere Retourenbedingungen kombinierbar | Stufe-B-Design berücksichtigen |
| RETURN-194 | Rückgabefrist ab **Lieferdatum** statt Bestelldatum | P1 (Frist-Basis konfigurierbar) |
| RETURN-168 | Gründe Xentral↔Portal nicht synchron | ✅ by design gelöst (wir lesen Xentral) |
| RETURN-137/136 | Menge editierbar / mit Bestellmenge vorbelegt | ✅ bereits umgesetzt |
| RETURN-131 | Zusätzlicher Auftrags-Filter beim Login | P5 |
| RETURN-216 | Absender-Mailadresse konfigurierbar | P4 (E-Mail-Konto-ID via sendEmail) |
| RETURN-208 | Gutschrift-Status steuerbar | P4 (Auto-Gutschrift-Design) |
| RETURN-170 | Nicht-DE-DHL-Retouren brauchen eigene Rücksendeadresse | P4 (Adress-Verwaltung) |
| RETURN-152 | Label-Fehler blockiert neue Retoure | Fehler-Design: Retoure ohne Label zulassen (haben wir) |
| RETURN-138 | USA als Rücksendeland (inkl. States) | P4 |
| RETURN-80 | Freitext auf Portal-Startseite | P5 (+ ZD 295821) |
| RETURN-19 | Stornoanträge über Portal | Später/Out-of-Scope v1 |
| RETURN-177/105/106/44/43 | API-Endpoints (returnCreate, salesOrderList, Tracking, shippingMethod im Beleg) | teils durch V1/V3-API überholt; 43 ✅ (wir setzen shippingMethod) |

Signal am Rande: Viele offene RETURN-Bugs sind **Settings-Verlust/Instanz-Vermischung**
(RETURN-251, 249, 237, 215, 78) — Kernargument für Settings in Xentral (Option B).

## 3. Zendesk-Wunschthemen (100 jüngste Tickets; 1.255 gesamt — Ranking indikativ)

1. **Mehr Carrier für Retourenlabel** (~6 Tickets, 5–6 verschiedene Kunden): DHL Standard, DPD, GLS, Hermes, DHL Express, Sendcloud (291191, 291998, 293451, 300129, 296109)
2. **Versandkosten/Rabatte im Portal & Beleg ausblenden**, intern korrekt verrechnen (291802, 294664, 292494)
3. **Mehr Sprachen / Standardsprache** im Kunden-Frontend (301345, 296124, 292191)
4. **B2B/Firmen & bestimmte SKUs ausschließen** (297242, 294018, 294975)
5. **Mail-/Text-Gestaltung** (HTML, Logo-Position, Startseitentext, „#"-Prefill für Shopify) (293363, 295821, 292775)
6. **Auto-Gutschrift + Auto-Erstattung** end-to-end (298037, 293069)
7. **Mehrere/editierbare Rücksendeadressen** (294021, 293094)
8. Marktplatz-Retouren-Meldung (Tradebyte/Zalando) (296189, 297647)
9. Druck-Flexibilität (Retourenlabel parallel drucken, Drucker je Station) (292461, 297860)
10. Einzelwünsche: Selbstzahler-Label (294933), Auftragsnr als Labelreferenz (294921), Frist ab Versanddatum (294254), Reject-Workflow (291803), Retoure ohne Bestellnummer (294427), MHD/Charge-Übernahme (298242), Gründe-Reporting (292757), Doppelretouren-Sperre (300931 — ✅ haben wir), Release-Webhook (302076), B-Ware (295703), Widerrufs-Button (299404), Label in neuem Tab (296663 — ✅ haben wir)

Lautestes Gesamtsignal (kein Feature): **Stabilität** — ≥10 Ausfall-/Hänger-Meldungen
in 4 Monaten. Eigenes Portal + Settings in Xentral adressieren das strukturell.

## 4. Umsetzungsweg (Option B, konkretisiert)

**Architektur:** Settings leben in Xentral (Business Entity, eine Zeile pro Projekt),
UI als natives Xentral-Modul (Axiom/Mirai), Portal liest zur Laufzeit per API und
erzwingt die Gates serverseitig. Kein iFrame, keine Zweitpflege, kein Zweit-Login.

**Phasen:**
- **P0 — Label-Route (extern, parallel):** `generateShippingLabel` beim API-Team
  (Feature-Request liegt vor, generisch über LabelProcessResolver). Interim:
  Versandzentrum-Verarbeitung; Portal zeigt „Label kommt per E-Mail".
- **P1 — Settings-Entity in Xentral** (Worktree, `generate-business-entity`):
  `ReturnsPortalSettings` pro Projekt: aktiv, Versandart, Frist (+Basis:
  Bestell-/Versand-/Lieferdatum), delivered-Gate, Bestelldatum-Limit,
  Mehrfach-Limit, Projekt-Scope, Preise zeigen, BOM-Split, Auto-Gutschrift,
  Service-E-Mail, Branding (Logo/Farben/Name/Links), Sprachen.
- **P2 — Settings-UI in Xentral** (`generate-business-entity-frontend`):
  natives Modul „Retourenportal" (Liste/Detail, Permissions).
- **P3 — Portal-Anbindung:** Portal liest Settings per API (Cache + Fallback),
  Portal-Admin schrumpft auf Bootstrap (Xentral-URL, PAT, DHL-Tracking-Key);
  Gates serverseitig (Frist, delivered, Projekt).
- **P4 — Paritäts-Features:** Retourenbedingungen-Engine (= Stufe B; Xentral-seitig
  definiert, kombinierbar), mehrere Rücksendeadressen, Auto-Gutschrift,
  Bestätigungsmail/Textvorlagen (sendEmail + E-Mail-Konto), Mehrsprachigkeit,
  Stücklisten, Login-Variante E-Mail+Shopnummer.
- **P5 — Delighter (Zendesk/Jira):** Versandkosten/Rabatt ausblenden,
  B2B-/SKU-Ausschluss (über Bedingungen), Selbstzahler-Retoure,
  Auftragsnr als Labelreferenz, Reject-Workflow, Gründe-Reporting, Webhook.
- **Cutover:** Pilot (Testinstanz) → Parallelbetrieb je Kunde → altes Portal ablösen.

## 5. Hürden & Risiken

1. **Label-Erzeugung (P0)** — einziger harter technischer Blocker; Abhängigkeit API-Team.
2. **Core-Beitrag:** Settings-Entity + Modul landen im Monolithen → CODEOWNERS/
   Owning-Team-Buy-in nötig (vermutlich FFU); Prozess einplanen.
3. **Carrier-Lücken vs. Alt-Portal:** Shipcloud hat keinerlei Xentral-Label-Code;
   Post.CH nur UI-gekoppelt. Kunden, die GLS/DPD via Shipcloud nutzten, brauchen
   Ersatz (CISC oder Sendcloud). Swiss-Post-Parität = Port auf ReturnLabelProcessor.
4. **CISC-Abhängigkeit:** GLS & Co. via CISC-Gateway = Zulieferung CISC-/Shipping-Team.
5. **Settings-Migration:** Alt-Portal-Konfiguration liegt im externen Dienst — pro
   Kunde Neukonfiguration (kein Export bekannt).
6. **Mehrsprachigkeit:** Portal-Frontend hat noch kein i18n.
7. **Betrieb:** eigenes Hosting (VPS) → Monitoring/Alerts einplanen (Zendesk-Signal Stabilität).
8. Kleinigkeiten: JQL `project = "RETURN"` quoten; Login-Paritäts-Entscheid (PLZ vs. E-Mail).

## 6. Carrier-Strategie / GLS-Frage

**CISC = „Carrier Integration Service"** — Xentrals generisches Carrier-Gateway
(Versandart konfiguriert `serviceUrl` + `carrierId` + Auth; standardisiertes
REST-Protokoll inkl. `createReturnLabel`). **GLS-Retouren = über CISC enablen**
(Versandart `carrierId: gls`, `shipmentType: return`), NICHT als native
Neuimplementierung — der Code zeigt klar: neue Carrier bekommen keine
Einzelintegrationen mehr. Voraussetzung: CISC-Backend unterstützt GLS downstream
(Klärung mit Shipping-Team). Unsere generische Label-Route deckt CISC-Versandarten
automatisch ab; das alte Portal löste GLS/DPD über Shipcloud-Aggregation — im
neuen Modell übernehmen CISC/Sendcloud diese Rolle.
