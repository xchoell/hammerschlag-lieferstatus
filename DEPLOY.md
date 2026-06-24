# Deployment: Node + systemd + Caddy (HTTPS)

Ziel-Setup: Code per **Git** auf den VPS, App als **systemd**-Dienst (Node),
öffentlich erreichbar über **Domain + HTTPS** via **Caddy** (Reverse-Proxy mit
automatischem Let's-Encrypt-Zertifikat).

> **Secrets:** PAT, DHL-Key & Admin-Kennwort liegen NICHT im Git-Repo
> (`.env` und `data/` sind gitignored). Sie werden ausschließlich auf dem
> Server gesetzt – siehe Schritt 4. Der im Hackathon geteilte PAT sollte
> vorher in Xentral **rotiert** werden.

---

## 0. Voraussetzungen

- VPS mit Ubuntu/Debian, root- bzw. sudo-Zugang.
- Eine Domain (z. B. `lieferstatus.hammerschlag.de`), deren **DNS-A-Record auf
  die VPS-IP** zeigt.
- Ports **80** und **443** offen (für Let's Encrypt + HTTPS).

---

## 1. Code zu einem Git-Remote pushen (vom lokalen Rechner)

Lege ein **leeres, privates** Repo bei GitHub/GitLab an, dann:

```bash
cd hammerschlag-lieferstatus
git branch -M main
git remote add origin git@github.com:<dein-account>/hammerschlag-lieferstatus.git
git push -u origin main
```

Es werden nur Quellcode + Deploy-Dateien gepusht – **keine Secrets**.

---

## 2. Node 20+ auf dem VPS installieren

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
node --version   # >= 20
```

## 3. App holen + Dienst-User anlegen

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin lieferstatus
sudo git clone https://github.com/<dein-account>/hammerschlag-lieferstatus.git \
  /opt/hammerschlag-lieferstatus
cd /opt/hammerschlag-lieferstatus
sudo npm ci --omit=dev      # oder: npm install --omit=dev (falls kein lockfile)
sudo mkdir -p data
sudo chown -R lieferstatus:lieferstatus /opt/hammerschlag-lieferstatus
```

## 4. `.env` auf dem Server anlegen (HIER kommen die Secrets rein)

```bash
sudo -u lieferstatus tee /opt/hammerschlag-lieferstatus/.env >/dev/null <<'EOF'
XENTRAL_BASE_URL=https://66d6a9db98f2b.xentral.biz
XENTRAL_API_TOKEN=<XENTRAL-PAT-HIER>
DHL_API_KEY=<DHL-API-KEY-HIER>
DHL_SERVICE=parcel-de

USE_MOCK=false
PORT=3000
HOST=127.0.0.1
TRUST_PROXY=1

ADMIN_PASSWORD=<STARKES-KENNWORT-HIER>

BRAND_NAME=Hammerschlag Handwerksbedarf
BRAND_SUPPORT_EMAIL=service@hammerschlag.de
BRAND_COLOR=#1a1a1a
EOF
sudo chmod 600 /opt/hammerschlag-lieferstatus/.env
```

> `TRUST_PROXY=1` sorgt dafür, dass die echte Client-IP (fürs Rate-Limit)
> erkannt wird und das Admin-Login-Cookie als **`Secure`** gesetzt wird.
> Alternativ kannst du DHL-Key & Branding später über `/admin` eintragen –
> dann reicht hier der PAT + ADMIN_PASSWORD.

## 5. systemd-Dienst einrichten

```bash
sudo cp /opt/hammerschlag-lieferstatus/deploy/lieferstatus.service \
  /etc/systemd/system/lieferstatus.service
sudo systemctl daemon-reload
sudo systemctl enable --now lieferstatus
sudo systemctl status lieferstatus        # sollte "active (running)" zeigen
curl -s http://127.0.0.1:3000/healthz      # {"ok":true,...}
```

Logs ansehen: `journalctl -u lieferstatus -f`

## 6. Caddy installieren + HTTPS

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile` mit dem Inhalt aus [`deploy/Caddyfile`](deploy/Caddyfile)
füllen und **die Domain anpassen**, dann:

```bash
sudo systemctl reload caddy
```

Caddy holt automatisch ein Zertifikat. Aufruf: `https://<deine-domain>/`
Settings-Page: `https://<deine-domain>/admin`

---

## 7. Updates einspielen

```bash
cd /opt/hammerschlag-lieferstatus
sudo -u lieferstatus git pull
sudo -u lieferstatus npm ci --omit=dev
sudo systemctl restart lieferstatus
```

## Checkliste „live & sicher"

- [ ] `https://<domain>/` zeigt die Suchseite, Zertifikat gültig.
- [ ] Lookup mit echter Bestellnummer + PLZ funktioniert.
- [ ] `/admin` verlangt das (geänderte!) Kennwort.
- [ ] PAT in Xentral nach dem Hackathon rotiert.
- [ ] App lauscht nur auf `127.0.0.1` (`sudo ss -ltnp | grep 3000`).
