# 0011. Multiword door URL is the access key (cowyo-style)

## Status

Accepted

## Context

keyverse has no accounts (ADR 0005). Self-host and shared packs still need a
simple way to keep a pack from being world-writable on an open network. Cowyo’s
answer was: a random multiword path *is* the secret — no login form, no email.

## Decision

1. Each pack is identified by a **door phrase**: four lowercase words joined by
   hyphens (e.g. `quiet-river-lantern`). On a multipack host the phrase is the
   pack directory name under `PACK_DIR` (`packs/{phrase}/`).
2. All app and API routes for that pack live under `/{door}/…`. Knowing the full
   URL is access to **that** pack only. Creating a new key (`/setup`) creates a
   new empty pack; it does not rotate access on an existing pack.
3. Root `/` without a door offers enter-key and create-key.
4. Unknown / wrong door → generic 404 (do not confirm whether a pack exists).
5. `DOOR_OPEN=1` disables the prefix for trusted local demos only (one shared pack).

Passage addresses (OSIS) remain the note identity inside a pack; the door is
pack identity + access, not confidentiality of note content once someone has
the URL or disk access. For that, see optional client-side encryption (ADR 0012).

## Consequences

- **Easier:** “login” = bookmark or share one multiword URL; many users/packs on
  one host without accounts; fits frictionlessness > portability.
- **Harder:** lose the URL → lose easy access (backup the pack dir name); all
  links and API clients must include the door prefix (`window.BASE`); door
  holders still see plaintext notes unless a pack passphrase is also in use;
  anyone can create empty packs via `/setup` (operator may rate-limit later).
- **Implication:** reverse-proxy auth is still optional extra; the door is the
  default personal *pack identity* model, not a substitute for encryption when
  the host or co-holders must not read content.
