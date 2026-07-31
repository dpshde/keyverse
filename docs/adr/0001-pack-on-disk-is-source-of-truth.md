# 0001. Pack on disk is the source of truth

## Status

Accepted

## Context

Scripture notes must survive app rewrites, dead servers, and tool churn. Users (and agents) need to read and write notes without a proprietary database. Sync and multi-device permanence may come later, but the durable artifact must stay a folder of files.

## Decision

The **pack directory** (plain JSON files under `notes/`, plus `protocol.json`) is the system of record. Any process that reads/writes a conforming pack is a valid client. The HTTP server is a **door**, not the store.

Empty writes delete the note file (cowyo-style). Files are UTF-8, pretty-printed JSON. Optionally sealed notes (ADR 0012) still live as ordinary JSON files whose content field is ciphertext — the pack remains portable and inspectable as files, even when note *text* is not readable without the passphrase.

## Consequences

- **Easier:** backup = copy folder; debugging = open a file; multi-client potential via the filesystem; protocol claim is testable with the server off.
- **Harder:** concurrent multi-writer safety is not free (single-writer assumed in the demo); “soft delete” and rich query need additional layers later; sealed notes need a client that understands the envelope (PROTOCOL §3.1).
- **Implication:** never require a running DB for the pack to be complete.
