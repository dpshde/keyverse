# 0012. Client-side note encryption (cowyo-style passphrase)

## Status

Accepted

## Context

The multiword door (ADR 0011) keeps casual strangers off the HTTP surface, but
anyone with the door URL—or filesystem access to `pack/notes/`—can read every
note in cleartext. Cowyo offered an optional page password that encrypted
content in the browser so the server never saw plaintext. Users asked for the
same layer on keyverse without introducing accounts (ADR 0005).

Server-side encryption at rest, multi-device key exchange, and blob encryption
remain deferred permanence work (ADR 0008). This ADR covers the optional
capture-layer seal only.

## Decision

1. **Optional pack passphrase**, entirely client-side (Web Crypto in the
   reference door). The server stores and serves opaque envelopes; it never
   derives keys or sees the passphrase.
2. **Algorithm:** PBKDF2-HMAC-SHA-256 (210 000 iterations) → AES-256-GCM.
   Envelope fields (base64 where noted): `v`, `alg`, `kdf`, `iter`, `salt`,
   `iv`, `ct`. See PROTOCOL.md §3.1.
3. **Sealed note record on disk:**
   `{ encrypted: true, cipher, blocks: [], attachments: [] }` plus
   `id` / `scope` / timestamps. Plaintext before encryption is
   `JSON.stringify({ blocks, attachments })` with the same shapes as an
   unencrypted note.
4. **Passphrase storage:** `sessionStorage` scoped to the door base path;
   optional URL hash `#pw=…` / `#password=…` / `#key=…`, stripped immediately
   after ingest (hash never appears in HTTP requests). Never POST the
   passphrase.
5. **UI:** crypto bar on home and editor — Set passphrase / Unlock / Lock.
   Sealed notes show an unlock gate on `/note/…`. Reader lists sealed notes as
   “Encrypted — open to unlock” (no inline edit of ciphertext).
6. **HTTP:**
   - `PUT` with `{ encrypted: true, cipher }` replaces the record with a seal.
   - Plaintext JSON `PUT` unwraps a sealed note (client decrypted and is saving
     cleartext).
   - `GET ?raw` / plain-text interchange against a sealed note → `409 encrypted`.
   - Attach POST/DELETE on a sealed note must not write plaintext metadata onto
     the note JSON; file POSTs still store CAS blobs and return
     `{ encrypted: true, attachment }` for the client to fold into the next
     cipher `PUT`.
7. **Attachments:** file **bytes** remain content-addressed at
   `pack/attachments/<sha256>` (ADR 0010). Only attachment **metadata** is
   sealed. Knowing a hash still fetches the blob if the door is open.
8. **Independent of the door:** door = who can hit the HTTP surface;
   passphrase = who can read sealed note content. Either, both, or neither.

## Consequences

- **Easier:** personal or shared-host notes can stay private from the host
  operator and from door-URL holders who lack the passphrase; no server crypto
  stack; pack stays plain files (ciphertext JSON is still portable and
  backupable).
- **Harder:** forget the passphrase → sealed content is unrecoverable; offline
  tools must implement the same envelope to edit sealed notes; file blobs are
  not confidential by hash alone; excerpts / search over sealed notes are
  opaque until unlock.
- **Implication:** this is **not** multi-device key exchange, server-side
  encryption at rest, or full blob encryption — those remain ADR 0008. Prefer
  a strong passphrase; treat `#pw=` links as secrets; back up the passphrase
  offline if the content matters.
