# 0005. Frictionless capture, no accounts

## Status

Accepted

## Context

Capture fails when save buttons, logins, or mode switches sit between thought and text. Priority order is frictionlessness > portability > permanence.

## Decision

The reference client has **no accounts, no save button, no account session**.
Open an address, type, autosave (debounced). Empty content clears the address
(when no attachments remain).

**Network access** to a pack uses a cowyo-style multiword door URL (ADR 0011) —
not a username/password form. Knowing the URL/phrase is access.

**Optional note confidentiality** uses a separate client-side pack passphrase
(ADR 0012). That is not an account, not server auth, and not required to
capture plaintext notes. Optional extra auth may still sit in a reverse proxy.

## Consequences

- **Easier:** lowest possible time-to-first-note; curl and browser are equal citizens; “login” is bookmark-the-URL; encryption is opt-in after capture works.
- **Harder:** multi-device conflict needs later sync (ADR 0008); no per-user partitions in the pack; lose the door phrase → lose easy HTTP access; lose the pack passphrase → sealed notes unreadable.
- **Implication:** never add a username/password wall to the default door without an alternate local/offline path.
