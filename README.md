# Lieferstatus – öffentliche Sendungsstatus-Seite

Eine **Status-Seite ohne Login**: Der Kunde gibt eine **Nummer + Liefer-PLZ** ein und sieht
Lieferstatus, voraussichtlichen Liefertag und einen Tracking-Link. Gebaut für den Hammerschlag-
Hackathon-Case (B2B-Großhandel, Handwerker ohne Shop-Konto auf der Baustelle).

Die Seite ist ein **eigenständiger Edge-Service**, der die [Xentral REST-API](https://developer.xentral.com/reference)
read-only liest. Es wird **kein** Datenmodell verändert und **nichts** zusätzlich gespeichert – alle Daten
(Bestellnummer, PLZ, Tracking-Link, Liefertag) existieren bereits in Xentral.

```
Browser (public, kein Login)
        │  Nummer + PLZ
        ▼
  Edge-Service  ── Bearer-Token (PAT) ──►  Xentral REST-API
  (dieses Repo)                            /api/v3/salesOrders
  Rate-Limit, equals-only,                 /api/v3/deliveryNotes
  generische Fehler, keine PII             /api/v1/deliveryNotes/{id}/shipments
        │
        └── DHL-API-Key ──►  DHL Tracking API (Zustellstatus "Zugestellt")
```

## Schnellstart (lokal, ohne Token)

```bash
npm install
cp .env.example .env        # USE_MOCK=true ist Default
npm run dev
# -> http://localhost:3000
```

Im Mock-Modus gibt es drei Test-Bestellungen (siehe `src/mock.js`), z. B.:

| Nummer | PLZ | zeigt |
|---|---|---|
| `AU-20294` (auch `PO-7741`, `SHOP-100231`, `LS-19880`) | `80331` | Versendet, 2 Pakete, DHL-Tracking |
| `AU-20310` | `50667` | Wird kommissioniert |
| `AU-20255` | `20095` | Zugestellt |

## Echte Instanz anbinden

1. **Personal Access Token** in Xentral erstellen: *Administration → Account settings →
   Developer settings → Personal Access Tokens*. Empfohlene Scopes: `salesOrder:read`,
   `deliveryNote:read`. Der Token gehört **ausschließlich** in die `.env` auf dem Server,
   nie ins Frontend.
2. `.env` setzen:
   ```ini
   XENTRAL_BASE_URL=https://66d6a9db98f2b.xentral.biz
   XENTRAL_API_TOKEN=1234|dein-token
   USE_MOCK=false
   ```
3. **Feldnamen verifizieren** (wichtig, einmalig):
   ```bash
   npm run probe                 # erste Sales Order
   npm run probe AU-20294        # gezielte Bestellung
   ```
   Das Skript dumpt die echten JSON-Responses. Prüfe, ob `tracking.number`, `tracking.link`,
   `tracking.carrier`, `zipCode`, `deliveryDate` zu den Gettern in [`src/xentral.js`](src/xentral.js)
   (`export const f`) passen – und passe die Kandidatenlisten bei Abweichung an.
   > Status: gegen die Testinstanz `66d6a9db98f2b` verifiziert (Stand 2026-06-24). Das echte
   > Shipment-Shape ist `{ tracking: { number, link, carrier }, sentAt, additionalPackages }`,
   > die Liefer-PLZ liegt unter `effectiveAddresses.shipTo.zipCode` bzw. `documentAddress.zipCode`.
   > Der Probe-Schritt bleibt nötig, wenn eine **andere** Instanz angebunden wird.
4. Starten: `npm start`.

## Hosting auf dem VPS

**Empfohlen: Node + systemd + Caddy (Domain + HTTPS).** Komplette
Schritt-für-Schritt-Anleitung in **[DEPLOY.md](DEPLOY.md)** (Git-Push, Dienst-User,
`.env` mit Secrets, systemd-Unit, automatisches Let's-Encrypt-Zertifikat).

Deploy-Vorlagen: [`deploy/lieferstatus.service`](deploy/lieferstatus.service),
[`deploy/Caddyfile`](deploy/Caddyfile).

Alternativ per Docker:

```bash
cp .env.example .env   # ausfüllen, USE_MOCK=false, HOST=0.0.0.0
docker compose up -d --build
```

In beiden Fällen gehört ein Reverse-Proxy mit TLS davor und `TRUST_PROXY=1`
(korrektes Rate-Limiting + `Secure`-Cookie hinter dem Proxy).

## Settings-Page (`/admin`)

Passwortgeschützte Oberfläche zum Ändern der Einstellungen **zur Laufzeit** –
kein Server-Neustart, kein `.env`-Editieren nötig.

- Aufruf: `https://<host>/admin`, Kennwort aus `ADMIN_PASSWORD`
  (Default `Xentral123!` – **fürs Deployment unbedingt ändern**).
- Editierbar: Xentral Basis-URL, **PAT**, **DHL API Key**, DHL Service-Code,
  Fallback-Schalter, Mock-Modus, Firmenname, Support-Mail, Akzentfarbe.
- Persistenz: `data/settings.json` (gitignored, enthält Secrets) – überlagert die
  `.env`-Defaults und überlebt Neustarts.
- Sicherheit: Login per signiertem HttpOnly-Cookie (`SameSite=Strict`, TTL
  `ADMIN_SESSION_TTL_MS`), Brute-Force-Limit am Login, **Secrets werden nie ins
  Formular zurückgeschrieben** (leeres Feld = unverändert), Kennwortvergleich
  timing-sicher.

## Identifier-Mapping (Nummer → API-Filter)

| Kunde tippt | v3-Filter-Key | Endpoint |
|---|---|---|
| Auftragsnummer | `documentNumber` | `salesOrders` |
| Bestellnummer (eigene Ref.) | `customerOrderNumber` | `salesOrders` |
| Internet-/Shop-Nummer | `externalOrderNumber` | `salesOrders` |
| Lieferscheinnummer | `documentNumber` | `deliveryNotes` |

Die Strategien werden der Reihe nach probiert (`src/lookup.js`, `STRATEGIES`), erster
PLZ-verifizierter Treffer gewinnt.

## Statuslogik (4 Kundenstufen)

| Stufe | Bedingung |
|---|---|
| Auftrag erhalten | Auftrag existiert |
| Auftrag wird gepackt | Lieferschein existiert, noch kein Tracking |
| Versendet | Sendung mit Tracking vorhanden |
| Zugestellt | **vom Carrier bestätigt** (siehe unten) |

„Zugestellt" wird **nicht** aus dem ERP-Status geraten, sondern **direkt beim
Versanddienstleister abgefragt**. Ohne Carrier-Bestätigung bleibt der Status
„Versendet" – wir behaupten keine Zustellung ohne Beleg.

### Carrier-Tracking (Zustellstatus)

| Carrier | Status |
|---|---|
| DHL | live angebunden (Shipment Tracking – Unified API) |
| DPD, GLS, UPS, Hermes … | als Stub vorgesehen, liefert „unbekannt" → Status bleibt „Versendet" |

- **DHL:** `GET https://api-eu.dhl.com/track/shipments`, Header `DHL-API-Key`,
  Zustellung aus `shipments[0].status.statusCode = delivered` (+ `timestamp` als
  „Zugestellt am"). Die Liefer-PLZ wird als `recipientPostalCode` mitgegeben
  (bessere Detailtiefe bei DE-Paketen). Key holen unter
  [developer.dhl.com](https://developer.dhl.com) und in `DHL_API_KEY` setzen.
  Free-Tier: 250 Calls/Tag, 1 Call/5s → Antworten werden gecacht (`DHL_CACHE_TTL_MS`).
- **Andere Carrier** (`detectCarrier` in [`src/carriers.js`](src/carriers.js)) liefern
  bis zur Anbindung `delivered: null` → die Sendung bleibt sichtbar als „Versendet"
  mit Tracking-Button, nur die Zustellung wird nicht behauptet.
- **Demo ohne Key:** `DELIVERED_FALLBACK_ON_ORDER_STATUS=true` leitet „Zugestellt"
  ersatzweise aus dem ERP-Status (`completed`) ab. Im echten Betrieb aus lassen.
- **Verifizieren:** `node scripts/dhl-test.mjs <trackingNumber> [plz]` zeigt die
  DHL-Rohantwort und die App-Interpretation.

## Sicherheit & Datenschutz

Die Seite ist öffentlich und ohne Login – daher fest eingebaut:

- **`equals`-only**: API-Filter nur mit exakter Übereinstimmung (kein `contains`/`startsWith`),
  damit niemand über die Seite Daten „erfischen" kann.
- **PLZ als Pflicht-Zweitfaktor**, serverseitig gegen die Lieferadresse geprüft (in Code,
  deckt abweichende Lieferadressen ab). Fail-closed, wenn keine PLZ auffindbar ist.
- **Generische Fehlermeldung**: „nicht gefunden" ist identisch, egal ob Nummer unbekannt oder
  PLZ falsch (kein Oracle für Enumeration).
- **Rate-Limit** pro IP (`RATE_LIMIT_*`).
- **Anzeigeumfang**: Status, Liefertag, Carrier + Tracking-Link, Paketanzahl sowie
  – auf Wunsch – **Empfängername und Lieferadresse** (aus dem Lieferschein). Keine
  Artikelpositionen, keine Preise. Hinweis: Name/Adresse sind personenbezogen; die
  PLZ-Pflicht als zweiter Faktor schützt den Zugriff. Optionale Abschwächung: Adresse
  maskieren (z. B. nur Ort/PLZ) – via Flag erweiterbar in `views.js`/`lookup.js`.
- **Token serverseitig**, strikte CSP, `noindex`.
- DSGVO-Basis: Art. 6 (1) b (Vertragserfüllung), kein zusätzliches Speichern.

## Nächste Schritte (Backlog)

- Token-Link (`/t/<opaker-token>`) als Primärpfad in Mail/PDF/SMS, Nummer+PLZ als Fallback.
- QR-Code/Kurz-URL auf Auftragsbestätigungs- und Lieferschein-PDF.
- Caching der API-Antworten (kurze TTL) gegen Last und Rate-Limits.
- Optional SMS-Benachrichtigung statt nur E-Mail.
- White-Label/Mandantenfähigkeit (mehrere Instanzen/Brands).

## Projektstruktur

```
src/
  server.js     Express-App: Routen, Rate-Limit, Security-Header, statische Assets
  config.js     .env-Laden + Validierung
  xentral.js    Xentral-API-Client (Auth, Endpoints) + tolerante Feld-Getter
  carriers.js   Carrier-Abstraktion: Zustellstatus (DHL live, DPD/… Stubs)
  lookup.js     Multi-Identifier-Auflösung, PLZ-Prüfung, Statuslogik
  views.js      HTML/CSS (Eingabe, Ergebnis, Nicht-gefunden) – mobile-first
  mock.js       Demo-Daten für USE_MOCK
public/
  logo.svg      Header-Logo (austauschbar, BRAND_LOGO_URL)
scripts/
  probe.js      Xentral-API-Responses dumpen (Feld-Mapping verifizieren)
  samples.mjs   Echte Demo-Lookups (Nummer+PLZ) aus der Instanz ziehen
  dhl-test.mjs  DHL-Tracking gegen eine Sendungsnummer testen
```
