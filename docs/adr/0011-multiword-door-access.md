# 0011. Multiword door URL is the access key (cowyo-style)

## Status

Accepted

## Context

keyverse has no accounts (ADR 0005). Self-host and shared packs still need a
simple way to keep a pack from being world-writable on an open network. Cowyo’s
answer was: a random multiword path *is* the secret — no login form, no email.

## Decision

1. Each pack has a **door phrase**: four lowercase words joined by hyphens
   (e.g. `quiet-river-lantern`), stored in `pack/door` (mode 0600) or set via
   `DOOR` / `PACK_DOOR`.
2. All app and API routes live under `/{door}/…`. Knowing the full URL is
   access. There is no password prompt beyond typing/pasting the phrase once
   at `/enter` if you only remember the words.
3. Root `/` without a door explains the model and offers an open field.
4. Wrong door → generic 404 (do not confirm whether a pack exists).
5. `DOOR_OPEN=1` disables the prefix for trusted local demos only.

Passage addresses (OSIS) remain the note identity; the door only guards the
pack surface, like a house key — not confidentiality of note content once
someone has the URL or disk access. For that, see optional client-side
encryption (ADR 0012).

## Consequences

- **Easier:** “login” = bookmark or share one multiword URL; zero account UX;
  fits frictionlessness > portability.
- **Harder:** lose the URL → lose easy access (backup `pack/door`); all links
  and API clients must include the door prefix (`window.BASE`); door holders
  still see plaintext notes unless a pack passphrase is also in use.
- **Implication:** reverse-proxy auth is still optional extra; the door is the
  default personal/small-group *access* model, not a substitute for
  encryption when the host or co-holders must not read content.
