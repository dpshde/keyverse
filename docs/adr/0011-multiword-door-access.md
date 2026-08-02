# 0011. Multiword door URL is the access key (cowyo-style)

## Status

Accepted (updated 2026-08-01: opaque pack_id + rotatable binding)

## Context

keyverse has no accounts (ADR 0005). Self-host and shared packs still need a
simple way to keep a pack from being world-writable on an open network. Cowyo’s
answer was: a random multiword path *is* the secret — no login form, no email.

## Decision

1. **Human access** is a **door phrase**: 3–8 lowercase words joined by hyphens
   (e.g. `quiet-river-lantern-notes`). Routes live under `/{door}/…`. Knowing
   the full URL is access to **that** pack only.
2. **System identity** is an opaque **`pack_id`** (`p_<hex>`). On disk the pack
   is `PACK_DIR/<pack_id>/` (notes, attachments, `protocol.json` with `pack_id`).
3. **Binding** maps multiword → `{pack_id, role}` under `PACK_DIR/_doors/`
   (hashed key files + ETS cache). Create writes a write binding; **rotate**
   (`POST /api/door/rotate`) issues a new multiword, revokes the old one, keeps
   the same pack directory.
4. Root `/` without a door offers enter-key and create-key. Wrong door → generic
   404 (do not distinguish unknown vs revoked beyond “didn’t work” on enter).
5. `DOOR_OPEN=1` disables the prefix for trusted local demos only (one shared pack).
6. Legacy packs that used the multiword string as the directory name still open
   until rotated (first rotate promotes them to an opaque id).

Passage addresses (OSIS) remain the note identity inside a pack. The door is
host access, not confidentiality of note content (see ADR 0012).

## Consequences

- **Easier:** memorable URLs; rotation without moving note data; pack backups
  stable under `pack_id`; protocol layering (ADR 0014) stays clean.
- **Harder:** lose the multiword → use export/backup or operator restore of
  `_doors` binding; all clients still use door prefix (`window.BASE`).
- **Implication:** reverse-proxy auth remains optional; multiword is UX +
  capability, not the on-disk folder name for new packs.
