# keyverse mobile (React Native / Expo)

**Local-first product client.** Scripture + notes work offline. Cloud is an optional multiword mirror.

## Defaults

| Concern | Default |
|---------|---------|
| Notes / attachments | **On-device pack** (`documentDirectory/keyverse/pack/`) |
| Scripture | **Bundled BSB + KJV** (`assets/text/*/chapters.json.gz`) |
| Cloud | **Off** until Settings toggle |
| Cloud on | Claims multiword door, **doubles local → host** (+ pull) |

## Bundled text

- **BSB** — same pack as server `priv/bsb` (public domain)
- **KJV** — `priv/kjv` + `mobile/assets/text/kjv` (public domain)

Rebuild KJV: `python3 scripts/build-kjv-pack.py /path/to/kjv.txt priv/kjv`

## Cloud toggle

1. Settings → Enable cloud sync  
2. Host claims a **four-word door**  
3. All local notes + file bytes push; remote notes pull  
4. Further saves: write local first, then `mirrorNoteIfCloud`  
5. Share door URL / QR when cloud is on  

Local is never deleted when cloud turns off.

## Screens

| Route | Role |
|-------|------|
| `/home` | Local notes tree, offline resolve/suggest, passphrase |
| `/read/[slug]` | VBV reader from bundled BSB/KJV + local outlines |
| `/note/[slug]` | Outliner + local attachments + encrypt |
| `/settings` | Translation · cloud toggle · sync |
| `/share` | Door URL when cloud enabled |

## Run

```sh
cd mobile && npm install && npm start
```

## Layout

```
mobile/
  assets/text/bsb|kjv/   bundled chapters.json.gz
  assets/words-door.txt  multiword door lexicon
  src/lib/textBundle.ts  gunzip + chapter get
  src/lib/localPack.ts   local SoT
  src/lib/cloudSync.ts   door claim + double
  src/lib/resolveLocal.ts
```
