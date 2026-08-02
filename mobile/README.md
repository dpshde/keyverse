# keyverse mobile (React Native / Expo)

**Primary product client.** Full door HTTP protocol parity with the web mirror:
screens, VBV reader, outliner notes, **attachments + links**.

Web remains the thin anywhere-access mirror (`priv/static` + Elixir door).
Tauri was removed — native UI is this app, not a WebView shell.

## Protocol surface

| Area | Implementation |
|------|----------------|
| Discovery | `GET /api/protocol`, `/api/door` |
| Resolve / suggest | `GET /api/resolve`, `/api/suggest` |
| Notes CRUD | `GET/PUT /api/note/<slug>`, `GET /api/notes` |
| Attachments | `POST/DELETE …/attachments`, `GET /api/attachments/<sha256>` |
| URL links | `POST` `{ kind: "url", url, title? }` |
| Reader | `GET /api/read/<slug>`, `GET /api/text/bsb/<book>/<ch>` |
| Pack | `GET /api/pack`, export zip URL |
| Inline markdown | `**bold**`, `*em*`, `` `code` ``, `~~strike~~`, `[label](https://…)` |
| Blocks | flat indent outline; collapse in editor; reader shows full outline |
| Encrypted notes | Detected; unlock UI deferred (web cipher for now) |

Client: `src/api/client.ts` · types: `src/api/types.ts`

## Screens

| Route | Role |
|-------|------|
| `/` | Door entry (host + multiword key) |
| `/home` | Note list + passage go |
| `/read/[slug]` | VBV reader + expand notes |
| `/note/[slug]` | Outliner editor + attachments/links |
| `/pack` | Protocol/features + export |

## Run

```sh
cd mobile
npm install
npm start          # Expo dev tools
npm run ios        # macOS + Xcode
npm run android    # emulator / device
```

Point **Host** at your multipack door (default production Railway) and enter the
multiword **door** key (same as web).

## Layout

```
mobile/
  app/                 expo-router screens
  src/api/             protocol HTTP client
  src/components/      Outliner, AttachmentList
  src/context/         session (door) persistence
  src/lib/             inline markdown
```

## Web mirror

Unchanged Elixir + `priv/static` app. Same packs, same API. Mobile is allowed to
lead UX; web stays capture-capable and portable.

See `docs/adr/0018-react-native-mobile-client.md`.
