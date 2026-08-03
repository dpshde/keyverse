# Self-hosting keyverse

Run the reference door on your own machine or LAN. The **pack directory is the
product**; the process is only HTTP access to it.

## Requirements

| Item | Notes |
|------|--------|
| **Elixir / OTP** | Elixir 1.15+ / OTP 26+ (`brew install elixir` on macOS). |
| **Disk** | Writable multipack root (`PACK_DIR`, default `./packs`). |
| **Network** | Not required for BSB (shipped in-app). Outbound only if you add other features. |
| **Node (optional)** | Only for `pnpm legacy:node` or re-running `scripts/extract_client_js.mjs`. |

## Install

```sh
git clone https://github.com/dpshde/keyverse.git
cd keyverse
mix deps.get
mix test
```

`words-door.txt` / `priv/words-door.txt` ship with the repo (multiword doors).

## Access model (your key)

**There is no username/password account.** Your four-word **key is your pack**.
It lives in the URL path and as a directory under the multipack root:

```text
http://localhost:4180/quiet-river-lantern/
                     ^^^^^^^^^^^^^^^^^^^^
                     this key → packs/quiet-river-lantern/
```

| Action | How |
|--------|-----|
| New pack | `/setup` → choose/create a key → empty pack at `$PACK_DIR/{key}/` |
| This computer | Open `/` → **Open my notes** (last key from browser storage) |
| Another pack | Different key = different notes (create another at `/setup`) |
| Phone / remote | Visit `/`, type your key, **Open notes** |
| Lost key | `ls $PACK_DIR` on the host (directory name = key) |
| Open demo (no key) | `DOOR_OPEN=1 mix run --no-halt` — one shared pack; not for production |

Remote visitors without a valid key only see sign-in. Unknown keys look like a
dead page (does not confirm packs). Treat the key like a password. See
[ADR 0011](./adr/0011-multiword-door-access.md).

### Optional note encryption (separate from the door)

Inside the pack UI you can set a **pack passphrase** (cowyo page-password
style). Notes then save as client-side AES-GCM ciphertext; the passphrase never
hits the server. See [ADR 0012](./adr/0012-client-side-note-encryption.md) and
[USAGE.md](./USAGE.md#optional-encryption-pack-passphrase).

| Layer | Protects | Where it lives |
|-------|----------|----------------|
| Multiword door | Network access to that pack | Pack dir name under `PACK_DIR` |
| Pack passphrase | Note text (+ attachment metadata) | Your head / browser session only |

Back up both if you care about recovery. File **blobs** under
`attachments/<sha256>` are not passphrase-encrypted (content-addressed only).

## Run

```sh
mix run --no-halt
# or: pnpm start   # same (calls mix)
```

Example log line:

```text
keyverse door: http://localhost:4180/form-file-said-duty/
bookmark that URL — the multiword path is your key (cowyo-style).
no account. share the door words only with co-editors.
pack on disk:   /path/to/keyverse/pack
```

(Optional encryption is set in the browser after you open the door — not in env.)

### Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `4180` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address (`127.0.0.1` for local-only) |
| `PACK_DIR` | `./packs` next to `server.mjs` | Multipack root (one subdir per key) |
| `DOOR` / `PACK_DOOR` | unset | Optional: create this pack on boot |
| `DOOR_OPEN` | off | `1` / `true` = no door prefix (one open pack) |
| `MAX_ATTACH_BYTES` | `52428800` | Max attachment upload size |
| `CORS_ORIGIN` | `*` (enabled) | CORS for `/api/*`; `off` / `false` disables; comma-list of origins |
| `FATHOM_SITE` | `EMYGRIAR` | [Fathom](https://usefathom.com) site id on every HTML page; set `off` for private hosts |

Examples:

```sh
HOST=127.0.0.1 PORT=8080 mix run --no-halt
PACK_DIR=/Volumes/notes/my-keyverse mix run --no-halt
DOOR=my-study-garden-notes mix run --no-halt
DOOR_OPEN=1 mix run --no-halt   # demos only
```

## What gets created

```
$PACK_DIR/
  protocol.json
  door                 # multiword phrase (gitignored; mode 0600)
  notes/               # note JSON
  attachments/         # content-addressed file blobs
  text/bsb/            # disposable BSB cache
```

Repo samples (tracked): `notes/1jn.1.json`, `jhn.3.16.json`, `jhn.3.16-18.json`.
Other note files and all of `attachments/`, `text/`, and `door` are gitignored.

## Verify

```sh
mix test
# or: mix compile --warnings-as-errors
DOOR=$(tr -d '\n' < pack/door)
BASE="http://localhost:4180/$DOOR"

curl -s -o /dev/null -w '%{http_code}\n' "$BASE/"          # 200
curl -s "$BASE/api/protocol" | head
curl -s "$BASE/api/resolve?q=John+3:16"
curl -s "$BASE/api/notes" | head
curl -s "$BASE/api/note/jhn.3.16?raw"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/manifest.webmanifest"   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4180/sw.js      # 200 (root)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4180/icons/icon-192.png
```

### Progressive web app

Installable on phone/desktop when served over **HTTPS** (or `localhost`). Assets:

| Path | Role |
|------|------|
| `/sw.js` | Service worker (scope `/`) |
| `/manifest.webmanifest` | Root/default start URL |
| `/{door}/manifest.webmanifest` | Start URL = pack home |
| `/icons/*` | App icons (192/512, maskable, apple-touch) |
| `/offline` | Offline fallback page |

Reverse proxies must forward these paths (do not strip `/sw.js` or `/icons`).

Interop docs: [API.md](./API.md), [../llms.txt](../llms.txt), [../schemas/](../schemas/).


## Backup / move

**You own the pack.** Prefer user export when possible ([OWNERSHIP.md](./OWNERSHIP.md)).

### Export (recommended)

```sh
# from a running door, or:
mix keyverse.export /var/lib/keyverse/packs/your-four-word-key ~/keyverse-backup.zip
mix keyverse.import ~/keyverse-backup.zip /restore/packs/your-four-word-key --replace
```

Browser: open your pack → **Export pack (.zip)**.

### Folder copy

Copy the **whole pack** (include `door` or you lose the multiword key):

```sh
tar czf keyverse-backup.tgz -C /var/lib/keyverse/packs your-four-word-key
# restore
mkdir -p /restore/packs
tar xzf keyverse-backup.tgz -C /restore/packs
PACK_DIR=/restore/packs mix run --no-halt
```

Validate any pack offline:

```sh
mix keyverse.conformance /path/to/pack
```

Unencrypted notes remain readable as plain JSON with the server off. Sealed
notes (`"encrypted": true`) are still valid pack files but need the passphrase
and a client that implements PROTOCOL §3.1 to recover text.

## Reading view / BSB

- BSB ships **in the app** as `priv/bsb/chapters.json.gz` (public domain;
  https://bereanbible.com/bsb.txt). Loaded into ETS at boot — **no outbound fetch**.
- Rebuild with `scripts/build-bsb-pack.py` if the official text updates.
- Host disk under `packs/_cache/text/bsb/` is optional legacy only; never user data.

## Security defaults

| Built-in | Not built-in |
|----------|----------------|
| Multiword door URL as shared secret | Accounts, OAuth, per-user ACL |
| Passage deep links under the door ([ADR 0019](./adr/0019-passage-deep-link-sharing.md)) | Capability tokens that share one note without the door |
| Optional client-side note passphrase (ADR 0012) | Server-side encryption at rest / blob encryption |
| Single-writer assumption | Multi-writer locking |
| — | TLS (use a reverse proxy) |

For anything beyond a private LAN/VPN, put TLS (and optionally extra auth) in
front — [PRODUCTION.md](./PRODUCTION.md). Prefer door **and** passphrase when
the host operator must not read note text.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Port in use | `PORT=4181 mix run --no-halt` |
| Pack not writable | Permissions / disk on `PACK_DIR` |
| BSB fetch fails | Network; use `/note/…` editor offline |
| Notes missing after move | `PACK_DIR` must contain `notes/` + `protocol.json` |
| “Open door” / “Nothing here” | Use full multiword URL or `ls $PACK_DIR` |
| Lost door phrase | Read `$PACK_DIR/door` or set new `DOOR=` |
| “Encrypted note” / cannot unlock | Wrong pack passphrase; not the multiword door |
| Forgot pack passphrase | No recovery — content stays sealed (ADR 0012) |
| API 404 with curl | Prefix paths with `/$DOOR/` |
| `409 encrypted` on `?raw` | Note is sealed; use JSON GET + decrypt client-side |
| Old UI | Hard refresh; one process on the port |

## Related

- Day-to-day UI: [USAGE.md](./USAGE.md)
- Production: [PRODUCTION.md](./PRODUCTION.md)
- Protocol: [PROTOCOL.md](../PROTOCOL.md)
- ADRs: [adr/](./adr/)
