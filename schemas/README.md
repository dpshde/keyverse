# keyverse JSON Schemas

Machine-readable shapes for pack records. Normative prose remains [PROTOCOL.md](../PROTOCOL.md).

| File | Validates |
|------|-----------|
| [protocol.schema.json](./protocol.schema.json) | `pack/protocol.json` |
| [note.schema.json](./note.schema.json) | `pack/notes/<slug>.json` |
| [attachment.schema.json](./attachment.schema.json) | attachment rows |
| [cipher.schema.json](./cipher.schema.json) | encrypted note `cipher` |

HTTP request/response catalogue: [docs/API.md](../docs/API.md).

Clients MUST ignore unknown properties (`additionalProperties: true`) so future
fields do not break older readers.
