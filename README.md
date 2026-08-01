# keyverse

A **cowyo-class** capture door over an on-disk scripture note pack.

**Priorities:** frictionlessness > portability > permanence.

## What you get

| Idea | How it shows up |
|------|------------------|
| **Address = passage** | `/note/jhn.3.16` — home search with **reference autocomplete** (books → chapters → verses) |
| **Open → type → saved** | Outliner (Enter, nest/unnest, collapse, move, undo, multi-select, drag). Autosave. No save button. No account form. |
| **Pack is the truth** | `pack/notes/<slug>.json` — readable with the server dead |
| **Outlines** | Flat `{id, indent, text, collapsed?}` blocks; tree projected from indent ([ADR 0013](docs/adr/0013-outline-collapse-and-structural-ops.md)) |
| **Markdown** | Base inline: `**bold**` `*italic*` `` `code` `` `~~strike~~` `[links](url)` + wiki |
| **Compose, don’t absorb** | Containment from OSIS geometry; each address keeps its own file. Home list nests chapter → verse as folders |
| **Cross-refs** | `[[John 3:16]]` or `[[John 3:16\|label]]` in any block ([PROTOCOL §4.1](PROTOCOL.md)) |
| **Attachments** | Any file type + URL refs ([PROTOCOL §5](PROTOCOL.md)); UI on the note page |
| **Reading view** | `/read/jhn.3` — BSB chapter text (cached), notes under verses; multi-select a passage (shift+click / drag / long-press) to note a range |
| **Access** | Multiword URL is the key — cowyo-style ([ADR 0011](docs/adr/0011-multiword-door-access.md)) |
| **Encryption** | Optional pack passphrase; notes save as AES-GCM ciphertext in the browser ([ADR 0012](docs/adr/0012-client-side-note-encryption.md)) |
| **PWA** | Installable app (manifest + service worker); offline shell / cached reads ([docs/USAGE.md](docs/USAGE.md#install-as-an-app-pwa)) |

## Sign in = your key (four words)

There is **no account**. Your **key is your pack**: four words open *your*
notes; a different key is a different pack. Create one at `/setup`, then
bookmark the link.

```text
keyverse multipack: http://localhost:4180/
create:  http://localhost:4180/setup
open:    …/quiet-river-lantern/
```

| | |
|--|--|
| **New notes** | `/setup` → create a key → pack created at `packs/{key}/` |
| **This computer** | Open `/` → **Open my notes** (last key in the browser) |
| **Any device** | Open your full link, or type your key on `/` |
| **Share** | Share the full URL (or the four words) only with co-editors |
| **Forgot** | `ls packs/` on the host (directory name = key) |
| **Open demo (no key)** | `DOOR_OPEN=1 pnpm start` — single shared pack; not for production |

All notes and APIs for a pack live under `/{key}/…`.

### Optional encryption (separate from the door)

Like cowyo’s page password: **Set passphrase** in the UI (or open with
`#pw=secret` — the hash is never sent to the server). Saves write
`{ "encrypted": true, "cipher": {…} }` only. Unlock with the same phrase;
**Lock** clears it from this browser session.

| | Door (URL key) | Pack passphrase |
|--|------------|-----------------|
| Protects against | Strangers without the URL | Anyone who can read the pack / door URL |
| Stored where | Pack dir name under `packs/` | Only in your head (+ optional browser session) |
| Server sees | Routes under `/{door}/` | Ciphertext only |

File attachment **bytes** remain content-addressed on disk; only note text and
attachment metadata are sealed.

## Quick start

```sh
pnpm install
pnpm dev
# open the URL printed in the terminal (includes the multiword path)
```

| Env | Default | Meaning |
|-----|---------|---------|
| `PORT` | `4180` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `PACK_DIR` | `./packs` | Multipack root (one subdir per key) |
| `DOOR` / `PACK_DOOR` | unset | Optional: create this pack on boot |
| `DOOR_OPEN` | off | `1` = single open pack, no key (demo only) |
| `MAX_ATTACH_BYTES` | `52428800` (50 MiB) | Max file upload size |
| `CORS_ORIGIN` | `*` (on) | API CORS; `off` disables; or comma-list of origins |
| `FATHOM_SITE` | `EMYGRIAR` | Fathom analytics site id; `off` disables |

```sh
HOST=127.0.0.1 PORT=8080 PACK_DIR=/data/keyverse/packs pnpm start
```

## Documentation

| Doc | Contents |
|-----|----------|
| [llms.txt](llms.txt) | Machine/LLM index (pack + door, must/must-not) |
| [docs/API.md](docs/API.md) | HTTP status/body matrix for second clients |
| [schemas/](schemas/) | JSON Schema for note, attachment, cipher, protocol |
| [PROTOCOL.md](PROTOCOL.md) | Pack format + HTTP door (normative interop) |
| [docs/SELF_HOST.md](docs/SELF_HOST.md) | Install, env, backup, offline BSB, troubleshooting |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | systemd, reverse proxy, **Railway + GitHub Actions**, hardening |
| [docs/USAGE.md](docs/USAGE.md) | Day-to-day UI: editor, reader, wiki links, attachments, encryption |
| [docs/adr/](docs/adr/) | Architecture Decision Records (Nygard format) |

## CI / deploy

| Workflow | Trigger | Action |
|----------|---------|--------|
| `CI` | PR + `main` | install, `pnpm check`, smoke `/health` + PWA assets |
| `Deploy Railway production` | push to `main` | `railway up` → production service |

Set GitHub secret `RAILWAY_TOKEN` on **dpshde/keyverse** (Railway project token) for deploys:

```sh
gh secret set RAILWAY_TOKEN -R dpshde/keyverse
```

Details:
[docs/PRODUCTION.md](docs/PRODUCTION.md#railway-production-reference-deploy).

## curl (under the door)

```sh
DOOR=your-four-word-key
BASE="http://localhost:4180/$DOOR"

# discover
curl -s "$BASE/api/protocol"
curl -s "$BASE/api/resolve?q=John+3:16"

# write (text interchange: 2 spaces = one indent)
echo "Nicodemus came at night." | curl -X PUT --data-binary @- "$BASE/api/note/jhn.3.16"

# write (JSON blocks — what the UI uses)
curl -X PUT "$BASE/api/note/jhn.3.16" \
  -H 'content-type: application/json' \
  -d '{"blocks":[{"id":"b1","indent":0,"text":"See [[John 3:17]]."}]}'

# sealed note (cipher produced in the browser; example shape only)
# curl -X PUT "$BASE/api/note/jhn.3.16" -H 'content-type: application/json' \
#   -d '{"encrypted":true,"cipher":{"v":1,"alg":"AES-GCM","kdf":"PBKDF2","iter":210000,"salt":"…","iv":"…","ct":"…"}}'

# read
curl "$BASE/api/note/jhn.3.16?raw"   # 409 if sealed
curl "$BASE/api/notes"

# attach a URL / any file
curl -X POST "$BASE/api/note/jhn.3.16/attachments" \
  -H 'content-type: application/json' \
  -d '{"kind":"url","url":"https://example.com","title":"Essay"}'
curl -X POST "$BASE/api/note/jhn.3.16/attachments" \
  -H 'content-type: application/pdf' -H 'x-filename: scan.pdf' \
  --data-binary @scan.pdf
```

Empty / all-blank note body clears the address when there are also no attachments
(cowyo-style empty page).

## Pack layout

```
pack/
  protocol.json
  door                 # multiword key (gitignored)
  notes/<slug>.json    # user notes (most gitignored; samples kept in repo)
  attachments/<sha256> # file blobs (gitignored)
  text/bsb/            # disposable BSB cache (gitignored)
```

## What’s in / out of this demo

**In:** multiword door, capture + outliner, pack-on-disk, OSIS addressing, reading
view, compose-don’t-absorb, wiki links, file/URL attachments, optional
client-side note encryption.

**Out (by design):** multi-writer sync/op-log, server-side encryption at rest /
blob encryption, traditional accounts, HA. See [ADR 0008](docs/adr/0008-prod-layers-deferred.md).

## License

`"private": true` in package.json. Clarify license before public redistribution.
