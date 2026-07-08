# Retourenportal — Zielbild & Umsetzungsplan

Stand **2026-07-07**. Quellen: Xentral-Handbuch (help.xentral.com 9726301921692 u. a.),
Jira-Projekt `RETURN` (54 offene Issues), Zendesk-Auswertung (100 jüngste von 1.255
Treffern zu „Retourenportal", Feb–Jul 2026), Code-Analyse Xentral-Monolith
(Worktree `retourenportal-settings-xentral`, Branch `SUP-0-retourenportal-settings`).
Technischer Detailstand je Feature: `RETOURE.md`. Einstieg für Neue: `ONBOARDING.md`.

---

## 0. Stand der Umsetzung (Kurzfassung, 2026-07-06)

**Fertig und E2E-verifiziert:** Blöcke A (Portal-Härtung) + B (Settings-Entity
`returnsPortalSetting` in Xentral inkl. nativer Settings-UI und Portal-Sync)
komplett · Pro-Projekt-Frontend `/p/<slug>` · C1 Frist-/Zeitfenster-Gates ·
C2 Retourenbedingungen-Engine · C4 Bestätigungsmail · C6 Stücklisten-Split ·
C7 Login-Varianten (PLZ/E-Mail/Kundennummer). Xentral-Branch ist gepusht
(`SUP-0-retourenportal-settings`), PR-Text liegt in `XENTRAL-PR.md`.

**P0-Label-Blocker GELÖST:** Das API-Team hat mit **SUP-87**
(`sup-87-return-shipping-label-api`) unsere designte Route
`POST /api/v3/returnOrders/{id}/actions/generateShippingLabel` gebaut —
am 2026-07-06 lokal end-to-end bewiesen (echtes DHL-Sandbox-Label-PDF bis in
die Portal-UI, Response `{fileId, trackingNumber, trackingLink}` passt 1:1 auf
unseren bestehenden Download-Pfad). Noch nicht in main released.

**Seit 2026-07-06 dazugekommen:** Portal-Autoaufruf der Label-Route ✅
(Label sofort auf Bestätigungsseite + Mail-Anhang; dabei C2-Versandart-
Override-Fix) · Retoure-Formular-UX ✅ (Menge default 0, Auswahl über Menge,
Inline-Fehler) · ⚠️ offener Bug-Verdacht: Speichern in der Xentral-Settings-UI
löscht die Retourenbedingungen (lineItems) — 2× beobachtet, Repro steht aus (§5 Nr. 3).

**Übrig für volle Parität:** siehe §1a — im Kern: Auto-Gutschrift (API-Lücke →
D1), mehrere Rücksendeadressen (C5), Carrier-Ausbau über DHL hinaus
(SUP-87-Follow-ups), konfigurierbare Mail-/Infotexte, Logo pro Projekt,
weitere Sprachen. **Hosting-Optionen: §7. Top-25-Kundenwünsche: §8.**

---

## 1. Feature-Parität mit dem alten Retourenportal (Mindestumfang)

Legende: ✅ = im neuen Portal vorhanden (E2E-verifiziert) · 🔶 = teilweise · ❌ = fehlt noch

### Kundensicht (Endkunden-Flow)
| Feature (altes Portal) | Status neu | Anmerkung |
|---|---|---|
| Login B2C: E-Mail + Shop-Bestellnummer | ✅ | C7: Login-Variante `email` pro Portal wählbar; Nummer deckt Auftrags-/Bestell-/Shop-/Lieferscheinnummer ab |
| Login B2B: Kundennr + Auftragsnr | ✅ | C7: Login-Variante `customerNumber` |
| Artikel wählen, Menge, Grund je Position | ✅ | Gründe live aus Xentral (altes Portal: eigener, UNsynchroner Katalog → RETURN-168) |
| Zusammenfassung + bestätigen | ✅ | A4: Bestätigungs-Zwischenschritt mit „Ändern"-Rücksprung |
| Label + Retourenbeleg herunterladen | ✅ | Abruf + Erzeugung bewiesen (Erzeugung via SUP-87, s. §4 P0 — Release ausstehend) |
| Weitere Retoure direkt starten | ✅ | Statusseite → erneuter Flow; Restmengen-Logik |
| Preise anzeigen (Option) | ✅ | A3: `shouldShowPrices`, brutto |
| Stücklisten-Bestandteile einzeln retournieren (Option) | ✅ | C6: `shouldSplitBillOfMaterials`; Eltern via `parent`-Referenz (v1-`hasChildren` steht fälschlich auf Kindern) |

### Regeln & Gates (pro Projekt)
| Feature | Status neu | Anmerkung |
|---|---|---|
| Portal je Projekt aktivierbar | ✅ | `isActive` der Settings-Zeile; Pro-Projekt-Frontend `/p/<slug>` |
| Rückgabefrist (Tage) | 🔶 | C1: Frist umgesetzt; Basis aktuell NUR Versanddatum — Basis Bestell-/Lieferdatum (RETURN-194, ZD 294254) fehlt |
| Bestelldatum-Limit (24 h) | ✅ | C1: `orderDateLimitHours` |
| Nur gelieferte Bestellungen | ✅ | A2: `shouldRequireDelivery`, serverseitig im Token |
| Mehrfach-Rückgabe-Limit | ✅ | positionsgenaue Restmengen (übertrifft altes Portal) + `shouldLimitToSingleReturn` |
| Nur Aufträge dieses Projekts | ✅ | `shouldRestrictToProjectOrders`, greift bei Lookup UND Token |
| Retourenbedingungen (Regel-Engine: Wenn→Dann) | ✅ | C2: kombinierbare Regeln (RETURN-212) als Kind-Collection der Entity; Kriterien Gewicht/Artikel/Hersteller/Land/B2B; Effekte exclude/block/Versandart |
| Gutschrift mit Retourenerstellung (Option) | ❌ | API-Lücke: Route `createFromReturnOrder` fehlt (→ D1); Setting existiert bereits ohne Wirkung. Stark nachgefragt (ZD 298037, 293069) |

### Versand & Label
| Feature | Status neu | Anmerkung |
|---|---|---|
| Carrier: Shipcloud, Sendcloud, Swiss Post, DHL Retoure | 🔶 | Neues Konzept: Xentral-Versandarten statt Zweitanbindung. SUP-87 unterstützt aktuell NUR `dhlreturn`; sendcloud/ups_oauth/cisc sind als Follow-up-Assembler vorgesehen (SUP-87-Spec §11a), andere Module → sauberes 409. Shipcloud hat KEINEN Xentral-Retourenlabel-Code, Post.CH nur UI-gekoppelt |
| Standard-Versanddienstleister global + pro Projekt | ✅ | `shippingMethod` pro Projekt-Settings; Bedingungen können sie regelbasiert überschreiben |
| Mehrere Rücksendeadressen | ❌ | C5 (DHL `receiverId` pro Settings/Bedingung; heute eine je Versandart-Config); ZD 294021/293094, RETURN-83/170 |
| Label automatisch erzeugen + per Mail | ✅ | Portal ruft SUP-87-Route nach Anlage fail-soft auf (2026-07-06 E2E: Label sofort auf Done-Seite + Mail-Anhang via C4); einzige Restabhängigkeit: SUP-87-Release in main |

### Texte, Mails & Branding
| Feature | Status neu | Anmerkung |
|---|---|---|
| Bestätigungsmail (DE/EN, Variablen) | 🔶 | C4: Versand über Xentral-Konto inkl. Anhänge läuft; Vorlage ist fest (i18n) — KONFIGURIERBARE Textvorlagen pro Projekt fehlen (RETURN-251/197) |
| Infotexte (Allgemein/Artikel/Bestellung) | ❌ | Freitexte pro Projekt fehlen (ZD 295821, RETURN-80) |
| „Service kontaktieren"-Text + Service-E-Mail | 🔶 | `serviceEmail` pro Projekt ✅ (C2-Block-Hinweise nutzen sie); konfigurierbarer Freitext fehlt |
| Logo, Akzent-/Sekundärfarbe, Shopname | 🔶 | Farben/Shopname pro Projekt in Xentral ✅; Logo bisher global im Portal (B0-Entscheid, Upload pro Projekt fehlt) |
| Links: Shop/Impressum/AGB/Datenschutz | ✅ | pro Projekt in Xentral |
| Personalisierung pro Projekt | ✅ | `/p/<slug>` mit Branding-Overlay + Projekt-`defaultLocale` |

### Ergebnis in Xentral
| Feature | Status neu | Anmerkung |
|---|---|---|
| Retoure-Beleg angelegt, Wareneingang-ready | ✅ | V1 create+release, verifiziert |
| Tracking am Beleg | ✅ | SUP-87 legt Shipment mit Trackingnummer an (E2E: `999998970412`) |

## 1a. Was EXAKT noch fehlt für volle Feature-Parität

Reihenfolge = Empfehlung. Nichts davon blockiert den Pilot-Rollout mit DHL.

1. **SUP-87-Release abwarten** (extern): Route ist gebaut + von uns E2E-verifiziert,
   aber noch nicht in main. Ohne Release kein Label auf Kundeninstanzen.
2. ~~Portal-Autoaufruf `generateShippingLabel`~~ ✅ **UMGESETZT 2026-07-06**
   (fail-soft; Label sofort auf Bestätigungsseite + Mail-Anhang; dabei gefixt:
   C2-Versandart-Override wird jetzt auch am Beleg gespeichert, s. RETOURE.md).
3. **Auto-Gutschrift** (einziges Paritäts-Feature mit echter API-Lücke):
   D1-Improvement `POST /api/v3/creditNotes/actions/createFromReturnOrder`
   einstellen (Wrapper um fertigen Handler `Retoure::createCreditNote`,
   www/pages/retoure.php:1349; SUP-87 als Vorbild). Bis dahin: Gutschrift manuell.
4. **Mehrere Rücksendeadressen (C5)**: `receiverId` pro Settings-Zeile bzw. pro
   Retourenbedingung wählbar machen (heute eine je Versandart-Config).
5. **Carrier-Parität**: Follow-up-Assembler in SUP-87-Architektur für
   sendcloud/ups_oauth/cisc (vorgesehen, Spec §11a); GLS/DPD/Hermes via CISC
   (→ D2-Klärung); Shipcloud-/Post.CH-Kunden brauchen Ersatzweg.
6. **Konfigurierbare Texte**: Bestätigungsmail-Vorlage, Infotexte,
   „Service kontaktieren"-Freitext pro Projekt (heute feste i18n-Texte).
7. **Frist-Basis** Bestell-/Lieferdatum zusätzlich zu Versanddatum
   (`deadlineBasis`-Enum erweitern; RETURN-194). Achtung Parität: das ALTE
   Portal rechnete ab Auftragsanlage — auch diese Basis fehlt uns bisher.
7a. **Bedingungs-Effekt „Kein Paketlabel"** (Handbuch-Abgleich 2026-07-07):
   Retoure zulassen, aber bewusst ohne Label (Kunde frankiert selbst) — als
   vierten Effekt `skipLabel` in der C2-Engine nachrüsten (trivial: Label-
   Autoaufruf überspringen + Hinweistext). Dazu „Service kontaktieren" als
   expliziten Effekt mit eigenem Textbaustein prüfen (heute nur angenähert
   über blockReturn + customerNote + serviceEmail).
8. **Logo pro Projekt** in Xentral (heute globaler Portal-Upload).
9. **Weitere Sprachen** über DE/EN hinaus (Zendesk-Thema 3; i18n-Katalog
   erweiterbar, Gründe kommen sprachgefiltert aus Xentral).

---

## 2. Offene Feature-Requests im Jira-Projekt RETURN (nicht umgesetzt)

Abfrage: `project = "RETURN" AND statusCategory != Done` (Achtung: RETURN in
JQL **quoten**, sonst MCP-Fehler). 54 offen, davon relevante Feature-Requests:

| Key | Wunsch | Für neues Portal |
|---|---|---|
| RETURN-204 | Retourenkosten dem Endkunden belasten (Selbstzahler) | P5 (+ ZD 294933) |
| RETURN-212 | Mehrere Retourenbedingungen kombinierbar | ✅ umgesetzt (C2-Engine, UND-Kriterien + Prioritäten) |
| RETURN-194 | Rückgabefrist ab **Lieferdatum** statt Bestelldatum | offen: deadlineBasis-Erweiterung (§1a Nr. 7) |
| RETURN-168 | Gründe Xentral↔Portal nicht synchron | ✅ by design gelöst (wir lesen Xentral) |
| RETURN-137/136 | Menge editierbar / mit Bestellmenge vorbelegt | ✅ umgesetzt |
| RETURN-131 | Zusätzlicher Auftrags-Filter beim Login | P5 |
| RETURN-216 | Absender-Mailadresse konfigurierbar | ✅ umgesetzt (emailAccountId pro Projekt, C4) |
| RETURN-208 | Gutschrift-Status steuerbar | offen (Auto-Gutschrift, §1a Nr. 3) |
| RETURN-170 | Nicht-DE-DHL-Retouren brauchen eigene Rücksendeadresse | offen (C5, §1a Nr. 4) |
| RETURN-152 | Label-Fehler blockiert neue Retoure | ✅ Fehler-Design: Retoure ohne Label bleibt gültig (fail-soft) |
| RETURN-138 | USA als Rücksendeland (inkl. States) | P4 |
| RETURN-80 | Freitext auf Portal-Startseite | offen (§1a Nr. 6; + ZD 295821) |
| RETURN-19 | Stornoanträge über Portal | Später/Out-of-Scope v1 |
| RETURN-177/105/106/44/43 | API-Endpoints (returnCreate, salesOrderList, Tracking, shippingMethod im Beleg) | durch V1/V3 + SUP-87 überholt bzw. ✅ |

Signal am Rande: Viele offene RETURN-Bugs sind **Settings-Verlust/Instanz-Vermischung**
(RETURN-251, 249, 237, 215, 78) — Kernargument für Settings in Xentral (Option B),
inzwischen umgesetzt.

## 3. Zendesk-Wunschthemen (100 jüngste Tickets; 1.255 gesamt — Ranking indikativ)

1. **Mehr Carrier für Retourenlabel** (~6 Tickets, 5–6 verschiedene Kunden): DHL Standard, DPD, GLS, Hermes, DHL Express, Sendcloud (291191, 291998, 293451, 300129, 296109) → §1a Nr. 5
2. **Versandkosten/Rabatte im Portal & Beleg ausblenden**, intern korrekt verrechnen (291802, 294664, 292494)
3. **Mehr Sprachen / Standardsprache** im Kunden-Frontend (301345, 296124, 292191) → Standardsprache pro Projekt ✅, weitere Sprachen §1a Nr. 9
4. **B2B/Firmen & bestimmte SKUs ausschließen** (297242, 294018, 294975) → ✅ C2-Bedingungen (B2B-Filter, Artikel-/Präfix-Regeln)
5. **Mail-/Text-Gestaltung** (HTML, Logo-Position, Startseitentext, „#"-Prefill für Shopify) (293363, 295821, 292775) → §1a Nr. 6
6. **Auto-Gutschrift + Auto-Erstattung** end-to-end (298037, 293069) → §1a Nr. 3
7. **Mehrere/editierbare Rücksendeadressen** (294021, 293094) → §1a Nr. 4
8. Marktplatz-Retouren-Meldung (Tradebyte/Zalando) (296189, 297647)
9. Druck-Flexibilität (Retourenlabel parallel drucken, Drucker je Station) (292461, 297860)
10. Einzelwünsche: Selbstzahler-Label (294933), Auftragsnr als Labelreferenz (294921), Frist ab Versanddatum (294254 — ✅ haben wir), Reject-Workflow (291803), Retoure ohne Bestellnummer (294427), MHD/Charge-Übernahme (298242), Gründe-Reporting (292757), Doppelretouren-Sperre (300931 — ✅ haben wir), Release-Webhook (302076), B-Ware (295703), Widerrufs-Button (299404), Label in neuem Tab (296663 — ✅ haben wir)

Lautestes Gesamtsignal (kein Feature): **Stabilität** — ≥10 Ausfall-/Hänger-Meldungen
in 4 Monaten. Eigenes Portal + Settings in Xentral adressieren das strukturell.

## 4. Umsetzungsweg (Option B) — Phasenstatus

**Architektur (umgesetzt):** Settings leben in Xentral (Business Entity
`returnsPortalSetting`, eine Zeile pro Projekt, Retourenbedingungen als
Kind-Collection `lineItems`), UI als natives Xentral-Settings-Modul
(Einstellungen → Inventory & Fulfillment), Portal liest zur Laufzeit per
Entity-API (Cache + Stale-Fallback) und erzwingt alle Gates serverseitig.
Kein iFrame, keine Zweitpflege, kein Zweit-Login.

- **P0 — Label-Route: ✅ GELÖST durch SUP-87** (2026-07-06 E2E-bewiesen, s. §0).
  Offen: Release in main + Portal-Autoaufruf (§1a Nr. 1–2). Der frühere
  Interim-Weg „Versandzentrum-Automatik" (D3) ist damit obsolet.
- **P1 — Settings-Entity: ✅ FERTIG** (B1/B2). Ist-Feldkatalog der Entity
  `returnsPortalSetting` (Tabelle `returns_portal_settings`, eine Zeile pro
  Projekt): `project` (unique) · `urlSlug` (Pro-Projekt-Frontend `/p/<slug>`,
  auto-abgeleitet) · `isActive` · `shippingMethod` · `loginVariant`
  (enum `zip|email|customerNumber`) · `defaultLocale` · `returnDeadlineDays` ·
  `deadlineBasis` (enum aktuell nur `shipping`) · `shouldRequireDelivery` ·
  `orderDateLimitHours` · `shouldLimitToSingleReturn` ·
  `shouldRestrictToProjectOrders` · `shouldShowPrices` ·
  `shouldSplitBillOfMaterials` · `shouldAutoCreateCreditNote` (noch ohne
  Wirkung, s. §1a Nr. 3) · `serviceEmail` · `emailAccountId` · Branding
  `accentColor`/`secondaryColor`/`shopName` · Links `shopLink`/`imprintLink`/
  `termsLink`/`privacyLink` · Kind-Collection **Retourenbedingungen**
  (`lineItems`: prio, effect exclude/block/useShippingMethod, Kriterien
  Gewicht/Artikelnr/Hersteller/Land/B2B, customerNote, shippingMethod).
  Feature-Flag (SOP kebab-case): `returns-portal-settings` (LaunchDarkly vor
  Prod anlegen).
- **P2 — Settings-UI in Xentral: ✅ FERTIG** (B3, EntityBase-Modul inkl.
  Bedingungen-Sektion).
- **P3 — Portal-Anbindung: ✅ FERTIG** (B4/B5: Entity-API mit PAT + Scope
  `entity:returnsPortalSetting:read`, 60-s-Cache, Stale-/Lokal-Fallback;
  Portal-Admin auf Bootstrap geschrumpft; Gates serverseitig).
- **P4 — Paritäts-Features: 🔶 GRÖSSTENTEILS FERTIG** — ✅ C1 Gates, C2
  Bedingungen-Engine, C4 Bestätigungsmail, C6 Stücklisten, C7 Login-Varianten.
  Offen: C5 Rücksendeadressen, Auto-Gutschrift, konfigurierbare Texte,
  weitere Sprachen (Details §1a).
- **P5 — Delighter: ❌ offen** (Versandkosten/Rabatt ausblenden, Selbstzahler,
  Labelreferenz, Reject-Workflow, Gründe-Reporting, Webhook).
- **Cutover: ❌ offen** (Block E): Pilot-E2E inkl. Label auf Testinstanz →
  Migrations-Checkliste pro Kunde (Alt-Config liegt im externen Dienst, kein
  Export → Neukonfiguration) → Parallelbetrieb → Alt-Portal + `["*"]`-PAT
  abschalten.

## 5. Hürden & Risiken (aktualisiert)

1. ~~Label-Erzeugung (P0)~~ **gelöst durch SUP-87** — Restrisiko: Release-Termin
   + PR-Review beim API-Team (Feedback von uns: fehlende Carrier-Credentials
   antworten als 500 statt 4xx).
2. **Core-Beitrag:** Branch `SUP-0-retourenportal-settings` ist gepusht; PR +
   Owning-Team-Review (product-adoption/application-framework/frontend) stehen
   aus; LaunchDarkly-Flag vor Prod.
3. **Carrier-Lücken vs. Alt-Portal:** SUP-87 kann heute nur DHL Retoure;
   sendcloud/ups_oauth/cisc sind vorgesehene Follow-ups. Shipcloud hat keinerlei
   Xentral-Label-Code; Post.CH nur UI-gekoppelt. Kunden mit GLS/DPD via
   Shipcloud brauchen Ersatz (CISC oder Sendcloud).
4. **CISC-Abhängigkeit:** GLS & Co. via CISC-Gateway = Zulieferung
   CISC-/Shipping-Team (D2-Frage offen).
5. **Settings-Migration:** Alt-Portal-Konfiguration liegt im externen Dienst —
   pro Kunde Neukonfiguration (kein Export bekannt).
6. **Betrieb:** eigenes Hosting → §7; Monitoring/Alerts einplanen
   (Zendesk-Signal Stabilität).
7. **⚠️ Bug-Verdacht Settings-UI:** Speichern der Settings-Zeile in der
   Xentral-UI löscht offenbar die komplette Bedingungen-Collection
   (2026-07-06 ganze Zeile + Bedingungen weg, 2026-07-07 12:10 Bedingungen
   weg bei Root-Update). API-PATCH ohne `lineItems` löscht nachweislich
   NICHTS → Verdacht EntityBase-Frontend (destruktiver lineItems-Payload
   beim Root-Save). Repro im Browser + Fix VOR dem Xentral-PR-Review —
   das wäre exakt die Settings-Verlust-Bugklasse, die Option B beseitigen soll.
8. Kleinigkeiten: JQL `project = "RETURN"` quoten; nach Branch-Wechsel/Merge
   im Worktree `php artisan meta:cache` (sonst „Missing section label" im
   Backend); ~~Login-Paritäts-Entscheid~~ erledigt (C7: pro Portal wählbar).

## 6. Carrier-Strategie / GLS-Frage

**CISC = „Carrier Integration Service"** — Xentrals generisches Carrier-Gateway
(Versandart konfiguriert `serviceUrl` + `carrierId` + Auth; standardisiertes
REST-Protokoll inkl. `createReturnLabel`). **GLS-Retouren = über CISC enablen**
(Versandart `carrierId: gls`, `shipmentType: return`), NICHT als native
Neuimplementierung — der Code zeigt klar: neue Carrier bekommen keine
Einzelintegrationen mehr. Voraussetzung: CISC-Backend unterstützt GLS downstream
(Klärung mit Shipping-Team, Task D2). Das alte Portal löste GLS/DPD über
Shipcloud-Aggregation — im neuen Modell übernehmen CISC/Sendcloud diese Rolle.

**SUP-87-Anschluss:** Die Route ist carrier-agnostisch geschnitten
(`ReturnLabelCommandAssemblerResolver` dispatcht aufs Versandart-Modul der
Retoure); implementiert ist bisher der DHL-Assembler, sendcloud/ups_oauth/cisc
sind laut Spec §11a als weitere Assembler vorgesehen, nicht unterstützte Module
antworten 409. Sobald der CISC-Assembler existiert, deckt die Route damit auch
GLS/DPD/Hermes ab — ohne Änderung am Portal.

## 7. Hosting des Portal-Frontends

Rahmenbedingungen (gelten für jede Option): Node ≥ 20, zustandsarm — einzige
Persistenz ist `data/` (settings.json-Overrides + Logo, wenige KB); ausgehend
HTTPS zur Xentral-Instanz + DHL-Tracking-API; eingehend nur 443; Secrets
(PAT, DHL-Key, Admin-Kennwort) ausschließlich server-seitig als `.env`.
Ein Portal-Prozess bedient **eine Xentral-Instanz** (ein PAT), aber beliebig
viele Projekte über `/p/<slug>` — Multi-PROJEKT ja, Multi-INSTANZ nein.

| Option | Beschreibung | Bewertung |
|---|---|---|
| **A — VPS pro Kunde (dokumentierter Ist-Weg)** | `DEPLOY.md`: Git-Checkout, Node als systemd-Dienst, Caddy als Reverse-Proxy mit Auto-Let's-Encrypt; Kunden-Domain (z. B. retoure.kunde.de) per DNS-A-Record | ✅ Heute fertig beschrieben + erprobt; volle Isolation pro Kunde. ⚠️ Betriebsaufwand skaliert mit Kundenzahl (Updates/Monitoring × N) |
| **B — Container auf Xentral-Infrastruktur** | Portal dockerisieren, ein Deployment pro Kundeninstanz im Fleet-Cluster (k8s); Kunden-Domains via CNAME auf Ingress; Secrets im Cluster-Secret-Store; zentrales Rollout/Monitoring (New Relic wie Fleet) | 🎯 Zielbild für den Rollout in Breite: EIN Update-Pfad, zentrales Monitoring (Stabilitäts-Signal!). Benötigt Infra-Team-Buy-in; Dockerfile ist trivial (stateless Node) |
| **C — PaaS (Render/Fly.io/Railway …)** | Ein Service pro Kunde, Custom Domain, Auto-TLS | Schnellster Start ohne eigene Infra; ⚠️ Datenfluss (Auftrags-/Adressdaten) über Dritt-Cloud → AVV/DSGVO prüfen; laufende Kosten pro Service |
| **D — Multi-Tenant-Umbau** | Ein Deployment für VIELE Xentral-Instanzen (Instanz-Auflösung per Domain, PAT-Store statt einzelner .env) | Minimalster Betrieb, ABER echter Umbau (instanz-scoped Config/Caches/Rate-Limits, Secret-Verwaltung, noisy neighbour); erst ab größerer Kundenzahl sinnvoll |

**Empfehlung:** Pilot + erste Kunden auf **A** (funktioniert heute, DEPLOY.md
fertig). Parallel **B** als Zielbild vorbereiten (Dockerfile + Helm/Manifest,
Gespräch mit Infra) — dorthin migrieren, bevor die Kundenzahl den
VPS-Handbetrieb übersteigt. **D** nur bei strategischem Bedarf; **C** als
Zwischenlösung, falls B sich verzögert und ein Kunde nicht warten kann.

## 8. Top 25 Kunden-Feature-Requests (konsolidiert)

Quellen: Jira `RETURN` (54 offene Issues) + Zendesk-Auswertung (100 jüngste
von 1.255 „Retourenportal"-Treffern, Feb–Jul 2026). Rang = Signalstärke
(Anzahl Tickets/Kunden), indikativ. Status: ✅ im neuen Portal · 🔶 teilweise · ❌ offen.

| # | Feature-Request | Quelle(n) | Status neues Portal |
|---|---|---|---|
| 1 | Retourenlabel mit GLS | ZD 291191 u. a. | ❌ via CISC-Assembler (SUP-87-Follow-up + D2) |
| 2 | Retourenlabel mit DPD | ZD 291998 u. a. | ❌ via CISC-Assembler |
| 3 | Retourenlabel mit Hermes | ZD 293451 | ❌ via CISC-Assembler |
| 4 | Retourenlabel mit Sendcloud | ZD 296109 | ❌ SUP-87-Follow-up (Spec §11a) |
| 5 | Retourenlabel mit DHL Standard/Express | ZD 300129 | 🔶 DHL Retoure ✅; Express offen |
| 6 | Auto-Gutschrift bei Retoure | RETURN-208, ZD 298037/293069 | ❌ API-Lücke → D1 `createFromReturnOrder` |
| 7 | Auto-Erstattung end-to-end | ZD 298037 | ❌ folgt nach Nr. 6 |
| 8 | Mehrere/editierbare Rücksendeadressen | RETURN-83/170, ZD 294021/293094 | ❌ C5 |
| 9 | Versandkosten/Rabatte im Portal ausblenden | ZD 291802/294664/292494 | ❌ P5 |
| 10 | Mehr Sprachen im Kunden-Frontend | ZD 301345/296124/292191 | 🔶 DE/EN ✅, weitere offen |
| 11 | B2B/Firmenkunden ausschließen | ZD 297242/294975 | ✅ C2-Bedingung (Kundenart) |
| 12 | Bestimmte Artikel/SKUs ausschließen | ZD 294018 | ✅ C2-Bedingung (Artikelnr/Präfix) |
| 13 | Kombinierbare Retourenbedingungen | RETURN-212 | ✅ C2-Engine |
| 14 | Mail-/Textvorlagen gestalten (HTML, Logo) | RETURN-251/197, ZD 293363/292775 | ❌ feste i18n-Vorlage, konfigurierbar offen |
| 15 | Freitext/Infotexte auf Portal-Startseite | RETURN-80, ZD 295821 | ❌ offen |
| 16 | Rückgabefrist ab Liefer-/Versanddatum | RETURN-194, ZD 294254 | 🔶 Versanddatum ✅, Lieferdatum offen |
| 17 | Absender-Mailadresse konfigurierbar | RETURN-216 | ✅ emailAccountId pro Projekt (C4) |
| 18 | Gründe synchron Xentral ↔ Portal | RETURN-168 | ✅ by design (live aus Xentral) |
| 19 | Menge editierbar / sinnvoll vorbelegt | RETURN-136/137 | ✅ (seit 2026-07-07: default 0, aktiv wählbar) |
| 20 | Selbstzahler-Retoure (Kunde zahlt Label) | RETURN-204, ZD 294933 | ❌ P5 |
| 21 | Auftragsnummer als Label-Referenz | ZD 294921 | ❌ P5 (SUP-87-Config `labelReference` als Hebel) |
| 22 | Reject-/Genehmigungs-Workflow | ZD 291803 | ❌ P5 |
| 23 | Doppelretouren-Sperre | ZD 300931 | ✅ Restmengen + Mehrfach-Limit |
| 24 | Gründe-Reporting/Auswertung | ZD 292757 | ❌ P5 (Daten liegen strukturiert in Xentral) |
| 25 | Webhook bei Retoure-Freigabe | ZD 302076 | ❌ P5 |

Knapp außerhalb der Top 25: USA als Rücksendeland inkl. States (RETURN-138),
Retoure ohne Bestellnummer (ZD 294427 — bewusst NICHT geplant, Auth-Konzept),
Marktplatz-Retouren Tradebyte/Zalando (ZD 296189/297647), Druck-Flexibilität
(ZD 292461/297860 — WMS-Thema, nicht Portal), Login-Auftragsfilter
(RETURN-131), Stornoanträge übers Portal (RETURN-19, out-of-scope v1),
Label in neuem Tab öffnen (ZD 296663 — ✅ haben wir), MHD/Charge-Übernahme
beim Wareneingang (ZD 298242 — Core, nicht Portal).
