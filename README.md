# versepack

A **cowyo-class** capture door over an on-disk scripture note pack.

**Priorities:** frictionlessness > portability > permanence.

## What you get

| Idea | How it shows up |
|------|------------------|
| **Address = passage** | `/note/jhn.3.16`, `/note/jhn.3.16-18`, `/note/1jn.1` — or type a human ref on home / `/go?q=` |
| **Open → type → saved** | Outliner (Enter, Nest/Unnest, Tab). Autosave. No save button. No account form. |
| **Pack is the truth** | `pack/notes/<slug>.json` — readable with the server dead |
| **Outlines** | Flat `{id, indent, text}` blocks; tree projected from indent |
| **Compose, don’t absorb** | Containment from OSIS geometry; each address keeps its own file |
| **Cross-refs** | `[[John 3:16]]` or `[[John 3:16\|label]]` in any block ([PROTOCOL §4.1](PROTOCOL.md)) |
| **Attachments** | Any file type + URL refs ([PROTOCOL §5](PROTOCOL.md)); UI on the note page |
| **Reading view** | `/read/jhn.3` — BSB chapter text (cached), notes under verses |
| **Access** | Multiword URL is the key — cowyo-style ([ADR 0011](docs/adr/0011-multiword-door-access.md)) |
| **Encryption** | Optional pack passphrase; notes save as AES-GCM ciphertext in the browser ([ADR 0012](docs/adr/0012-client-side-note-encryption.md)) |

## Access = multiword URL (your “login”)

There is **no account**. On first start the server creates a four-word
door phrase and prints:

```text
versepack door: http://localhost:4180/quiet-river-lantern/
bookmark that URL — the multiword path is your key (cowyo-style).
```

| | |
|--|--|
| **Open the pack** | Bookmark / open `http://host:port/{door}/` |
| **Share with co-editors** | Share that full URL (or the four words) |
| **Forgot the words** | `cat pack/door` on the host |
| **Choose your own** | `DOOR=my-study-garden-notes pnpm start` |
| **Open demo (no key)** | `DOOR_OPEN=1 pnpm start` — not for production |

Bare `http://localhost:4180/` only offers an “open door” field. Wrong words →
generic “Nothing here.” All pages and APIs sit under `/{door}/…`.

### Optional encryption (separate from the door)

Like cowyo’s page password: **Set passphrase** in the UI (or open with
`#pw=secret` — the hash is never sent to the server). Saves write
`{ "encrypted": true, "cipher": {…} }` only. Unlock with the same phrase;
**Lock** clears it from this browser session.

| | Door (URL) | Pack passphrase |
|--|------------|-----------------|
| Protects against | Strangers without the URL | Anyone who can read the pack / door URL |
| Stored where | `pack/door` / env | Only in your head (+ optional browser session) |
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
| `PACK_DIR` | `./pack` | Pack directory (absolute or relative) |
| `DOOR` / `PACK_DOOR` | auto → `pack/door` | Multiword access phrase |
| `DOOR_OPEN` | off | `1` = disable door (open demo only) |
| `MAX_ATTACH_BYTES` | `52428800` (50 MiB) | Max file upload size |

```sh
HOST=127.0.0.1 PORT=8080 PACK_DIR=/data/versepack DOOR=my-study-garden-notes pnpm start
```

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/SELF_HOST.md](docs/SELF_HOST.md) | Install, env, backup, offline BSB, troubleshooting |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | systemd, reverse proxy, Docker sketch, hardening |
| [docs/USAGE.md](docs/USAGE.md) | Day-to-day UI: editor, reader, wiki links, attachments, encryption |
| [PROTOCOL.md](PROTOCOL.md) | Pack format + HTTP door (interop contract; §3.1 encryption) |
| [docs/adr/](docs/adr/) | Architecture Decision Records (Nygard format; 0012 = encryption) |

## curl (under the door)

```sh
DOOR=$(tr -d '\n' < pack/door)
BASE="http://localhost:4180/$DOOR"

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
