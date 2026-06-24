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

```bash
cp .env.example .env   # ausfüllen, USE_MOCK=false
docker compose up -d --build
```

Davor gehört ein Reverse-Proxy mit TLS (Caddy/Nginx/Traefik) auf z. B.
`status.hammerschlag.de`. `TRUST_PROXY=1` ist im Compose-File schon gesetzt (für korrektes
Rate-Limiting hinter dem Proxy).

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
| Zugestellt | explizites Liefer-/Abschlusssignal **und** Tracking |

Die Stufe „Zugestellt" ist **bewusst konservativ**: Die API liefert keine garantierte
Zustell-Bestätigung – die taggenaue Live-Verfolgung passiert beim Carrier (Tracking-Button).
Wir behaupten daher keine Zustellung ohne klares Signal.

## Sicherheit & Datenschutz

Die Seite ist öffentlich und ohne Login – daher fest eingebaut:

- **`equals`-only**: API-Filter nur mit exakter Übereinstimmung (kein `contains`/`startsWith`),
  damit niemand über die Seite Daten „erfischen" kann.
- **PLZ als Pflicht-Zweitfaktor**, serverseitig gegen die Lieferadresse geprüft (in Code,
  deckt abweichende Lieferadressen ab). Fail-closed, wenn keine PLZ auffindbar ist.
- **Generische Fehlermeldung**: „nicht gefunden" ist identisch, egal ob Nummer unbekannt oder
  PLZ falsch (kein Oracle für Enumeration).
- **Rate-Limit** pro IP (`RATE_LIMIT_*`).
- **Datenminimierung**: angezeigt werden nur Status, Liefertag, Carrier + Tracking-Link,
  Paketanzahl. **Kein** Name, keine Adresse, keine Artikelpositionen.
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
  server.js     Express-App: Routen, Rate-Limit, Security-Header, generische Fehler
  config.js     .env-Laden + Validierung
  xentral.js    API-Client (Auth, Endpoints) + tolerante Feld-Getter
  lookup.js     Multi-Identifier-Auflösung, PLZ-Prüfung, Statuslogik
  views.js      HTML/CSS (Eingabe, Ergebnis, Nicht-gefunden) – mobile-first
  mock.js       Demo-Daten für USE_MOCK
scripts/
  probe.js      Echte API-Responses dumpen, um Feld-Mapping zu verifizieren
```
