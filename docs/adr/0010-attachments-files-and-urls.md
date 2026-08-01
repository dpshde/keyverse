# 0010. Attachments: any file type and URLs

## Status

Accepted

## Context

Study notes need PDFs, images, audio, scans, and pointers to external pages.
A passage-addressed pack that only stores outline text forces users into
side channels and breaks “the folder is the truth.” MIME allowlists always
lag real use.

## Decision

1. Notes MAY carry an ordered `attachments[]` array of `file` or `url` rows.
2. File bytes are **content-addressed** at `pack/attachments/<sha256>` with
   **no MIME allowlist** (`mime` is advisory metadata).
3. URL attachments store only metadata (`url`, optional `title`); no crawl.
4. Optional in-band `![[att:…]]` / `![[https://…]]` in block text for display.
5. Updating blocks without sending `attachments` **preserves** existing rows.
6. With client-side encryption (ADR 0012), attachment **metadata** may live
   inside the sealed payload; file **bytes** stay CAS on disk. Attach APIs on a
   sealed note return metadata without writing plaintext onto the note file.

## Consequences

- **Easier:** one pack holds notes + binaries + link-outs; portable backup;
  future CAS/permanence can reuse the same hashes.
- **Harder:** pack size grows; clients must stream large files carefully;
  GC of unreferenced blobs is optional and easy to get wrong if shared;
  sealing a note hides names/URLs of attachments but not blob bytes by hash.
  Hosts SHOULD enforce size caps, per-note counts, filename/MIME hygiene,
  http(s)-only URL schemes, and `X-Content-Type-Options: nosniff` on blob GET
  (reference door: `Keyverse.Attach`, `MAX_ATTACH_BYTES`, `MAX_ATTACH_PER_NOTE`).
- **Implication:** never store file bytes inside note JSON; never require a
  separate media database for conformance.
