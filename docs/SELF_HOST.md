# Self-hosting versepack

Run the reference door on your own machine or LAN. The **pack directory is the
product**; the process is only HTTP access to it.

## Requirements

| Item | Notes |
|------|--------|
| **Node.js** | 18+ (native `fetch`, ESM). 20+ or 22 LTS recommended. |
| **Package manager** | `pnpm` preferred; `npm` / `yarn` work. |
| **Disk** | Writable pack dir (notes + attachments + optional BSB cache). |
| **Network** | Outbound HTTPS only for first-time BSB fetch (`bolls.life`). After cache warm-up, offline is fine. |

## Install

```sh
git clone https://github.com/dpshde/versepack.git
cd versepack
pnpm install          # or: npm install
```

`words-door.txt` ships with the repo (word list for multiword doors).

## Access model (cowyo-style)

**There is no traditional login.** A four-word path segment is the pack key:

```text
http://localhost:4180/quiet-river-lantern/
                     ^^^^^^^^^^^^^^^^^^^^
                     this is “logging in”
```

| Action | How |
|--------|-----|
| First run | Server generates `pack/door` and prints the full URL |
| Open the pack | Open/bookmark that URL |
| Remember only the words | Visit `/`, paste phrase, **Open door** → redirects to `/{door}/` |
| Lost phrase | `cat $PACK_DIR/door` on the host |
| Fix the phrase | `DOOR=my-own-four-words pnpm start` (old bookmarks break) |
| Disable for a local demo | `DOOR_OPEN=1 pnpm start` |

Wrong multiword path returns a generic “Nothing here” (does not confirm doors).
Anyone with the full door URL can read and write the pack — treat the phrase
like a password. See [ADR 0011](./adr/0011-multiword-door-access.md).

### Optional note encryption (separate from the door)

Inside the pack UI you can set a **pack passphrase** (cowyo page-password
style). Notes then save as client-side AES-GCM ciphertext; the passphrase never
hits the server. See [ADR 0012](./adr/0012-client-side-note-encryption.md) and
[USAGE.md](./USAGE.md#optional-encryption-pack-passphrase).

| Layer | Protects | Where it lives |
|-------|----------|----------------|
| Multiword door | Network access to the pack | `pack/door` / `DOOR=` |
| Pack passphrase | Note text (+ attachment metadata) | Your head / browser session only |

Back up both if you care about recovery. File **blobs** under
`attachments/<sha256>` are not passphrase-encrypted (content-addressed only).

## Run

```sh
pnpm dev              # node server.mjs
# or: pnpm start
```

Example log line:

```text
versepack door: http://localhost:4180/form-file-said-duty/
bookmark that URL — the multiword path is your key (cowyo-style).
no account. share the door words only with co-editors.
pack on disk:   /path/to/versepack/pack
```

(Optional encryption is set in the browser after you open the door — not in env.)

### Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `4180` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address (`127.0.0.1` for local-only) |
| `PACK_DIR` | `./pack` next to `server.mjs` | Absolute or relative pack path |
| `DOOR` / `PACK_DOOR` | auto → `$PACK_DIR/door` | Multiword access phrase (`a-b-c-d`) |
| `DOOR_OPEN` | off | `1` / `true` = no door prefix (open access) |
| `MAX_ATTACH_BYTES` | `52428800` | Max attachment upload size |

Examples:

```sh
HOST=127.0.0.1 PORT=8080 pnpm start
PACK_DIR=/Volumes/notes/my-versepack pnpm start
DOOR=my-study-garden-notes pnpm start
DOOR_OPEN=1 pnpm start   # demos only
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
pnpm check
DOOR=$(tr -d '\n' < pack/door)
BASE="http://localhost:4180/$DOOR"

curl -s -o /dev/null -w '%{http_code}\n' "$BASE/"          # 200
curl -s "$BASE/api/notes" | head
curl -s "$BASE/api/note/jhn.3.16?raw"
```

## Backup / move

Copy the **whole pack** (include `door` or you lose the multiword key):

```sh
tar czf versepack-backup.tgz -C /var/lib/versepack pack
# restore
tar xzf versepack-backup.tgz -C /restore
PACK_DIR=/restore/pack pnpm start
```

Unencrypted notes remain readable as plain JSON with the server off. Sealed
notes (`"encrypted": true`) are still valid pack files but need the passphrase
and a client that implements PROTOCOL §3.1 to recover text.

## Reading view / BSB

- First open of a chapter may call `https://bolls.life/...` and write
  `pack/text/bsb/<book>.<chapter>.json`.
- `text/` is disposable (gitignored). Delete anytime; re-fetch when online.
- Offline read: warm each chapter once, or pre-seed `text/bsb/`.

## Security defaults

| Built-in | Not built-in |
|----------|----------------|
| Multiword door URL as shared secret | Accounts, OAuth, per-user ACL |
| Optional client-side note passphrase (ADR 0012) | Server-side encryption at rest / blob encryption |
| Single-writer assumption | Multi-writer locking |
| — | TLS (use a reverse proxy) |

For anything beyond a private LAN/VPN, put TLS (and optionally extra auth) in
front — [PRODUCTION.md](./PRODUCTION.md). Prefer door **and** passphrase when
the host operator must not read note text.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Port in use | `PORT=4181 pnpm start` |
| Pack not writable | Permissions / disk on `PACK_DIR` |
| BSB fetch fails | Network; use `/note/…` editor offline |
| Notes missing after move | `PACK_DIR` must contain `notes/` + `protocol.json` |
| “Open door” / “Nothing here” | Use full multiword URL or `cat pack/door` |
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
