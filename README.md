# keyverse

A **cowyo-class** capture door over on-disk scripture note packs.

**Priorities:** frictionlessness > portability > permanence.

**Host:** Elixir/OTP (Bandit + Plug). Packs remain plain JSON directories.

**Clients:**
- **Mobile (product)** — Expo React Native in [`mobile/`](./mobile/) (screens, VBV reader, outliner, attachments + links)
- **Web (mirror)** — `priv/static` + door HTML for anywhere access

## What you get

| Idea | How it shows up |
|------|------------------|
| **Address = passage** | `/note/jhn.3.16` — home search with **reference autocomplete** |
| **Open → type → saved** | Outliner. Autosave on web. Explicit save on mobile. No account. |
| **Pack is the truth** | `packs/{key}/notes/<slug>.json` — readable with the server dead |
| **You own the data** | Export/import `.zip` (notes + attachments); no account lock-in |
| **Local folder (RO)** | `/local` — open a pack directory in Chromium (read-only) |
| **Multipack** | Four-word key = your pack; another key is another library |
| **Attachments** | Files + URL refs (web + mobile) |
| **Access** | Multiword URL is the key — cowyo-style |
| **Encryption** | Optional client-side passphrase (web AES-GCM; mobile detects sealed) |
| **PWA** | Web mirror: manifest + service worker |
| **Mobile app** | Full protocol client — [mobile/README.md](./mobile/README.md) |

## Quick start (Elixir / web mirror)

Requirements: **Elixir 1.15+** / OTP 26+ (Homebrew: `brew install elixir`).

```sh
mix deps.get
mix test
mix keyverse.conformance   # offline pack fixtures (protocol gate)
mix run --no-halt
# open http://localhost:4180/setup  → create your key
```

## Quick start (mobile product)

```sh
cd mobile
npm install
npm start
# enter host + multiword door (same pack as web)
```

| Env | Default | Meaning |
|-----|---------|---------|
| `PORT` | `4180` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `PACK_DIR` | `./packs` | Multipack root (one subdir per key) |
| `DOOR` / `PACK_DOOR` | unset | Optional: create this pack on boot |
| `DOOR_OPEN` | off | `1` = single open pack, no key (demo only) |
| `MAX_ATTACH_BYTES` | `52428800` | Max file upload size |
| `CORS_ORIGIN` | `*` (on) | API CORS; `off` disables |
| `FATHOM_SITE` | `EMYGRIAR` | Fathom analytics; `off` disables |

## Sign in = your key (four words)

There is **no account**. Your **key is your pack**.

| | |
|--|--|
| **New notes** | `/setup` → create a key → pack at `packs/{key}/` |
| **Open** | `/` → enter key, or bookmark `/{key}/` |
| **Share** | Share the full URL only with co-editors |
| **Forgot** | `ls packs/` on the host (directory name = key) |

All notes and APIs for a pack live under `/{key}/…`.

## API (pack-scoped)

```sh
DOOR=your-four-word-key
BASE="http://localhost:4180/$DOOR"

curl -s "$BASE/api/protocol"
curl -s "$BASE/api/resolve?q=John+3:16"
curl -s -X PUT "$BASE/api/note/jhn.3.16" \
  -H 'content-type: application/json' \
  -d '{"blocks":[{"id":"b1","indent":0,"text":"…"}]}'
curl -s "$BASE/api/note/jhn.3.16?raw"
```

See [docs/API.md](docs/API.md) and [PROTOCOL.md](PROTOCOL.md).

## Documentation

| Doc | Contents |
|-----|----------|
| [llms.txt](llms.txt) | Machine/LLM index |
| [docs/API.md](docs/API.md) | HTTP status/body matrix |
| [schemas/](schemas/) | JSON Schema |
| [PROTOCOL.md](PROTOCOL.md) | Pack format + HTTP door |
| [docs/SELF_HOST.md](docs/SELF_HOST.md) | Install, env, backup |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | Deploy guidance |
| [docs/SCALING.md](docs/SCALING.md) | Why BEAM for multipack host |
| [docs/USAGE.md](docs/USAGE.md) | Day-to-day web UI |
| [mobile/README.md](mobile/README.md) | React Native product client |
| [docs/adr/](docs/adr/) | Architecture Decision Records |

## Project layout

```text
lib/keyverse/          # Elixir multipack door (OTP)
priv/static/           # CSS/JS/PWA (web mirror)
mobile/                # Expo RN product client (full protocol)
packs/                 # multipack root (runtime data)
server.mjs             # legacy Node reference (not the primary door)
mix.exs
```

## CI / deploy

| | |
|--|--|
| **CI** | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — `mix test` + smoke boot on PR/`main` |
| **Production** | Railway **auto-deploy from `main`** (no GitHub Actions deploy job) |
| **Start** | `MIX_ENV=prod mix run --no-halt` (see `railway.json`) |

## Legacy Node door

`server.mjs` is historical only (`pnpm legacy:node`). Do not use it for production.

## License / status

Protocol `0.1-demo` / pack `0.2`. Elixir multipack host + Expo mobile client.
