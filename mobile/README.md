# keyverse mobile (React Native / Expo)

**Product client** with full door HTTP + pack protocol parity to the web mirror.

Web (`priv/static` + Elixir) remains the anywhere-access mirror. Mobile leads UX.

## Feature parity matrix

| Feature | Web | Mobile |
|---------|-----|--------|
| Multiword door open | ✓ | ✓ |
| Create pack (`POST /setup`) | ✓ | ✓ |
| Protocol discovery | ✓ | ✓ |
| Resolve / suggest passages | ✓ | ✓ |
| Notes list | ✓ | ✓ book→chapter tree |
| VBV reader + chapter text | ✓ | ✓ |
| Verse / range / chapter notes | ✓ | ✓ |
| Range select (long-press) | ✓ | ✓ |
| Expand-all notes in reader | ✓ | ✓ |
| Outliner nest/unnest/fold | ✓ | ✓ |
| Autosave | ✓ | ✓ debounced |
| File attachments | ✓ | ✓ |
| URL link attachments | ✓ | ✓ |
| Inline markdown + links | ✓ | ✓ |
| Client encryption (AES-GCM) | ✓ | ✓ |
| Pack passphrase session | ✓ | ✓ |
| Pack export zip | ✓ | ✓ share sheet |
| Pack import merge/replace | ✓ | ✓ |
| Door rotate | ✓ | ✓ |
| Share QR + copy URL | ✓ | ✓ |
| Local FS mount RO | ✓ Chromium | n/a (host API) |
| PWA / service worker | ✓ | n/a (native app) |

## Screens

| Route | Role |
|-------|------|
| `/` | Open door **or** create pack |
| `/home` | Tree notes, suggest, passphrase, nav |
| `/read/[slug]` | VBV reader, ranges, chapter note, expand |
| `/note/[slug]` | Outliner + attachments + encrypt/autosave |
| `/pack` | Manifest, export/import, rotate, endpoints |
| `/share` | Door URL, copy, system share, QR |

## Run

```sh
cd mobile
npm install
npm start
npm run ios      # macOS
npm run android
```

Default host: production Railway. Enter the same multiword door as web.

## Layout

```
mobile/
  app/                 expo-router screens
  src/api/             full HTTP client
  src/lib/crypto.ts    PBKDF2 + AES-GCM (§3.1)
  src/lib/noteTree.ts  home tree
  src/lib/inlineMarkdown.tsx
  src/components/      Outliner, AttachmentList
  src/context/         door + passphrase session
```

See [docs/adr/0018-react-native-mobile-client.md](../docs/adr/0018-react-native-mobile-client.md).
