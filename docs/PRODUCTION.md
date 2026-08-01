# Production deployment

Guidance for running the **reference door** as a long-lived process. This is
still the v0.1 **demo** server: single writer, multiword door access (not full
multi-tenant SaaS). Optional client-side note encryption exists (ADR 0012);
server-side encryption at rest / blob encryption does not.

## When this is appropriate

| OK for | Not OK for |
|--------|------------|
| Personal always-on host | Compliance / regulated multi-tenant |
| Household over Tailscale / VPN | Active-active multi-instance writers on one pack |
| Private reverse proxy + multiword door | Relying on obscurity alone on the open internet without TLS |

## Access model

Same as self-host ([ADR 0011](./adr/0011-multiword-door-access.md)):

- Routes are under `https://notes.example.com/{door}/…`
- The multiword path is the pack key (cowyo-style)
- Set a stable `DOOR=` in the unit file (or persist `$PACK_DIR/door`)
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
[ browser / curl ]
        │
        ▼
[ reverse proxy ]     TLS + optional auth
        │
        ▼
[ node server.mjs ]   one process, one pack, one door
        │
        ▼
[ PACK_DIR on durable disk ]
```

## Environment

```sh
export HOST=127.0.0.1
export PORT=4180
export PACK_DIR=/var/lib/keyverse/pack
export DOOR=your-fixed-multiword-phrase
# DOOR_OPEN must remain unset
# optional: MAX_ATTACH_BYTES=52428800
```

| Variable | Production recommendation |
|----------|---------------------------|
| `HOST` | `127.0.0.1` when proxy is local |
| `PORT` | Internal only |
| `PACK_DIR` | Absolute path on persistent storage |
| `DOOR` | Fixed phrase in env **or** file `$PACK_DIR/door` |
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
Environment=PACK_DIR=/var/lib/keyverse/pack
Environment=DOOR=your-fixed-multiword-phrase
ExecStart=/usr/bin/node /opt/keyverse/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/keyverse/pack

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now keyverse
sudo journalctl -u keyverse -f
```

Users open: `https://notes.example.com/your-fixed-multiword-phrase/`

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

## Related

- Self-host: [SELF_HOST.md](./SELF_HOST.md)
- Usage: [USAGE.md](./USAGE.md)
- Protocol: [PROTOCOL.md](../PROTOCOL.md)
- ADRs: [adr/](./adr/)
