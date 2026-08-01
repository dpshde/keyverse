# keyverse

A **cowyo-class** capture door over on-disk scripture note packs.

**Priorities:** frictionlessness > portability > permanence.

**Host:** Elixir/OTP (Bandit + Plug). Packs remain plain JSON directories.

## What you get

| Idea | How it shows up |
|------|------------------|
| **Address = passage** | `/note/jhn.3.16` — home search with **reference autocomplete** |
| **Open → type → saved** | Outliner (same browser UX as before). Autosave. No account. |
| **Pack is the truth** | `packs/{key}/notes/<slug>.json` — readable with the server dead |
| **Multipack** | Four-word key = your pack; another key is another library |
| **Attachments** | Files + URL refs |
| **Access** | Multiword URL is the key — cowyo-style |
| **Encryption** | Optional client-side passphrase (browser AES-GCM) |
| **PWA** | Manifest + service worker |

## Quick start (Elixir)

Requirements: **Elixir 1.15+** / OTP 26+ (Homebrew: `brew install elixir`).

```sh
mix deps.get
mix test
mix run --no-halt
# open http://localhost:4180/setup  → create your key
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

```sh
HOST=127.0.0.1 PORT=8080 PACK_DIR=/data/keyverse/packs mix run --no-halt
```

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
| [docs/USAGE.md](docs/USAGE.md) | Day-to-day UI |
| [docs/adr/](docs/adr/) | Architecture Decision Records |

## Project layout

```text
lib/keyverse/          # Elixir multipack door (OTP)
priv/static/           # CSS/JS/PWA (browser UX — preserved)
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

Protocol `0.1-demo`. Elixir multipack host.
