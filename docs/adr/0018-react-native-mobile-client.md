# ADR 0018 — React Native mobile client (web mirror)

Status: **Accepted**  
Date: 2026-08-02  
Supersedes: draft Tauri v2 shell (removed)

## Context

Frictionless portable note-taking with **mobile as the product** and **web as an
anywhere mirror**. Core UI pillars: **screens**, **VBV reader**, **outliner
notes**, plus full protocol **attachments and links**.

A Tauri WebView shell was spiked; it did not change the fact that store-grade
mobile chrome still fights WKWebView, and it duplicated packaging without a
native interaction model. Product direction prefers a real RN client on the
door HTTP API.

## Decision

1. **Remove Tauri** (`src-tauri/`, mobile shell splash, tauri npm scripts).
2. **Keep web** (Elixir multipack + `priv/static`) as the protocol-capable mirror.
3. **Add `mobile/`** — Expo (React Native) app implementing the full door HTTP
   profile: notes, blocks/outliner, file + URL attachments, resolve/suggest,
   read bundle / BSB text, pack manifest/export URL, inline markdown links.

## Consequences

### Positive

- Native navigation, keyboard, and lists for the daily loop.
- Single pack SoT remains server/disk; RN is another conforming client.
- Web can stay simpler without blocking mobile iteration.

### Negative / follow-ups

- Two UI codebases (acceptable under mobile-primary).
- Client-side note encryption unlock not yet ported (Web Crypto path on web).
- Pack zip import UI not in v1 mobile (export link + API remain).
- Need store assets, EAS project id, deep links (`keyverse://`).

## References

- [PROTOCOL.md](../../PROTOCOL.md)
- [docs/API.md](../API.md)
- [mobile/README.md](../../mobile/README.md)
