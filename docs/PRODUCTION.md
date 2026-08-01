# Production deployment

Guidance for running the **reference door** as a long-lived process. This is
still the v0.1 **demo** server: multipack by multiword key, single writer per
pack. Optional client-side note encryption exists (ADR 0012); server-side
encryption at rest / blob encryption does not.

## When this is appropriate

| OK for | Not OK for |
|--------|------------|
| Public multipack host (key = pack) | Compliance / regulated multi-tenant ACLs |
| Personal / household always-on host | Active-active multi-instance writers on one pack |
| Private reverse proxy + multiword doors | Relying on obscurity alone on the open internet without TLS |

## Access model

Same as self-host ([ADR 0011](./adr/0011-multiword-door-access.md)):

- Routes are under `https://notes.example.com/{door}/…`
- The multiword path **is** the pack (one directory per key under `PACK_DIR`)
- `/setup` creates a new pack; unknown keys 404
- Never set `DOOR_OPEN=1` in production
- Optional: extra Basic Auth / SSO at the reverse proxy

### Note encryption vs host access

| Threat | Mitigation |
|--------|------------|
| Random internet visitor | Multiword door + TLS (do not use `DOOR_OPEN`) |
| Shared host / curious operator | Client-side pack passphrase ([ADR 0012](./adr/0012-client-side-note-encryption.md)) |
| Disk theft of `PACK_DIR` | OS/volume encryption (not provided by keyverse) + passphrase for sealed notes |
| Co-editor with door URL | Share passphrase only if they should read sealed notes |

The server never receives the pack passphrase. Sealed notes on disk are
ciphertext JSON; attachment **blobs** remain content-addressed bytes.

## Process model

```
[ browser / curl / installed PWA ]
        │
        ▼
[ reverse proxy ]     TLS + optional auth
        │
        ▼
[ mix run --no-halt ]   Elixir/Bandit multipack door
        │
        ▼
[ PACK_DIR/{key}/ on durable disk ]
```

Primary host on the `elixir-rewrite` line of work is **Elixir**. See
[SCALING.md](./SCALING.md) for runtime tradeoffs. `server.mjs` is legacy only.

### PWA / service worker notes

- Install and offline shell require **HTTPS** (or localhost).
- Do not block `GET /sw.js`, `GET /icons/*`, or `GET /manifest.webmanifest`.
- Prefer not to add a long `Cache-Control` on HTML at the proxy; the app and SW
  manage caching for the shell and API GETs.
- Service worker scope is `/` (whole origin for this door host).

## Environment

```sh
export HOST=127.0.0.1
export PORT=4180
export PACK_DIR=/var/lib/keyverse/packs
# DOOR_OPEN must remain unset
# optional: DOOR=seed-key-on-boot  MAX_ATTACH_BYTES=52428800
```

| Variable | Production recommendation |
|----------|---------------------------|
| `HOST` | `127.0.0.1` when proxy is local |
| `PORT` | Internal only |
| `PACK_DIR` | Absolute multipack root on persistent storage |
| `DOOR` | Optional: ensure one pack exists on boot |
| `DOOR_OPEN` | Unset / `0` |
| `MAX_ATTACH_BYTES` | Cap uploads if untrusted co-editors |

## systemd unit (example)

```ini
# /etc/systemd/system/keyverse.service
[Unit]
Description=keyverse door
After=network.target

[Service]
Type=simple
User=keyverse
Group=keyverse
WorkingDirectory=/opt/keyverse
Environment=HOST=127.0.0.1
Environment=PORT=4180
Environment=PACK_DIR=/var/lib/keyverse/packs
WorkingDirectory=/opt/keyverse
ExecStart=/usr/bin/mix run --no-halt
Environment=MIX_ENV=prod
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/keyverse/packs

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now keyverse
sudo journalctl -u keyverse -f
```

Users open: `https://notes.example.com/` (enter key) or `https://notes.example.com/{their-key}/`

## Reverse proxy

### Caddy

```caddy
notes.example.com {
  reverse_proxy 127.0.0.1:4180
  # optional extra gate:
  # basicauth { user $2a$14$... }
}
```

### nginx

```nginx
server {
  listen 443 ssl http2;
  server_name notes.example.com;
  # ssl_certificate ...;

  location / {
    proxy_pass http://127.0.0.1:4180;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 55m;  # align with MAX_ATTACH_BYTES
  }
}
```

## Docker (sketch)

No official image yet. Pattern:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY server.mjs words-door.txt ./
ENV HOST=0.0.0.0 PORT=4180 PACK_DIR=/data
EXPOSE 4180
CMD ["node", "server.mjs"]
```

```sh
docker run --rm -p 4180:4180 \
  -v /var/lib/keyverse:/data \
  -e PACK_DIR=/data \
  -e DOOR=your-fixed-multiword-phrase \
  keyverse
```

Mount the pack volume; do not bake notes into the image.

## Backups

| Path | Priority | Notes |
|------|----------|--------|
| `PACK_DIR/notes/` | Required | Source of truth (may include sealed ciphertext) |
| `PACK_DIR/attachments/` | Required if used | File blobs (not passphrase-encrypted) |
| `PACK_DIR/door` | Required if not using `DOOR=` env | Access phrase |
| `PACK_DIR/protocol.json` | With notes | Tiny |
| `PACK_DIR/text/` | Optional | Regenerable BSB cache |
| Pack passphrase | Off-site, if used | **Not** stored in the pack — back it up yourself |

```sh
rsync -a --delete /var/lib/keyverse/pack/ backup:/keyverse/pack/
```

## Health checks

No dedicated `/health`. Probe:

```sh
DOOR=your-fixed-multiword-phrase
curl -sf -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:4180/$DOOR/"
# expect 200
```

## Updates

```sh
cd /opt/keyverse
git pull
pnpm install --frozen-lockfile
sudo systemctl restart keyverse
```

Keep `PACK_DIR` outside the git checkout so deploys never wipe notes.

## Hardening checklist

- [ ] `DOOR_OPEN` unset; multiword door enabled
- [ ] Door phrase treated as a secret (not in public screenshots/repos)
- [ ] Bind loopback / private interface; TLS at proxy
- [ ] Optional proxy auth if exposure is wider than VPN
- [ ] If notes must be private from the host: pack passphrase enabled (ADR 0012)
- [ ] Pack passphrase backed up offline (no server recovery)
- [ ] Durable `PACK_DIR`; backup + restore drill includes `door`, `notes/`, `attachments/`
- [ ] Process user can write pack; others cannot
- [ ] Upload size limited (`client_max_body_size` / `MAX_ATTACH_BYTES`)
- [ ] Outbound allowlist: `bolls.life` only if BSB first-fetch is needed
- [ ] One writer process per pack
- [ ] Users always get `https://host/{door}/…` links — never bare `/`

## What this binary still does not provide

- Op-log multi-device merge, HA (see ADR 0008)
- Server-side encryption at rest or full attachment-blob encryption (ADR 0008);
  optional **client-side** note passphrase is in scope (ADR 0012)
- Per-user identities inside the pack
- Rate limiting / CSP (add at proxy if required)

## Railway production (reference deploy)

The public demo runs on Railway:

| | |
|--|--|
| Project | `keyverse` |
| Environment | `production` |
| Service | `keyverse` |
| Default URL | `https://keyverse-production.up.railway.app` |
| Pack volume | mounted at `/data` (`PACK_DIR=/data`) |

### Required service variables

| Variable | Value |
|----------|--------|
| `PACK_DIR` | `/data` |
| `HOST` | `0.0.0.0` |
| `DOOR` | fixed multiword phrase (secret) |
| `FATHOM_SITE` | site id or `off` |
| `RAILPACK_NODE_VERSION` | `22` |

Do **not** set `DOOR_OPEN` in production.

`railway.json` sets `startCommand: node server.mjs` and healthcheck `GET /health`.

### GitHub Actions CI/CD

| Workflow | When | What |
|----------|------|------|
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | PR + push to `main` | `pnpm check` + smoke `/health` + PWA assets |
| [`.github/workflows/deploy-railway.yml`](../.github/workflows/deploy-railway.yml) | push to `main` (and manual) | deploy to Railway **production** |

**Secret (required for deploy):** create a Railway **project token**
(Project → Settings → Tokens), then:

```sh
gh secret set RAILWAY_TOKEN -R dpshde/keyverse
# paste token (Railway → keyverse project → Settings → Tokens)
# If deploy uses GitHub Environment "production", also:
#   gh secret set RAILWAY_TOKEN -R dpshde/keyverse --env production
```

Optional: GitHub Environment `production` (workflow already references it) for
approval gates.

Manual deploy from a linked laptop:

```sh
railway up --ci --service keyverse --environment production -m "manual ship"
```

### Health

```sh
curl -sf https://keyverse-production.up.railway.app/health
# {"ok":true,"protocol":"keyverse","version":"0.1-demo","door":true}
```

## Related

- Self-host: [SELF_HOST.md](./SELF_HOST.md)
- Usage: [USAGE.md](./USAGE.md)
- Protocol: [PROTOCOL.md](../PROTOCOL.md)
- ADRs: [adr/](./adr/)
