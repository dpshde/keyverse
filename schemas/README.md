# keyverse JSON Schemas

Machine-readable shapes for pack records. Normative prose remains [PROTOCOL.md](../PROTOCOL.md).

| File | Validates |
|------|-----------|
| [protocol.schema.json](./protocol.schema.json) | `pack/protocol.json` |
| [note.schema.json](./note.schema.json) | `pack/notes/<slug>.json` |
| [attachment.schema.json](./attachment.schema.json) | attachment rows |
| [cipher.schema.json](./cipher.schema.json) | encrypted note `cipher` |
| [op.schema.json](./op.schema.json) | `pack/ops/<slug>/<sha256>.json` op records (PROTOCOL §10) |

Offline CI gate (extra filesystem MUST rules such as slug↔filename and CAS presence):

```sh
mix keyverse.conformance
```

Fixtures: [../protocol/fixtures/](../protocol/fixtures/). Ownership/export: [../docs/OWNERSHIP.md](../docs/OWNERSHIP.md).

HTTP request/response catalogue: [docs/API.md](../docs/API.md).

Clients MUST ignore unknown properties (`additionalProperties: true`) so future
fields do not break older readers.
