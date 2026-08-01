# Protocol tree

Offline-first protocol assets. **No HTTP required** to prove interop.

```
protocol/
  README.md                 ← this file
  fixtures/
    valid/…                 ← must pass conformance
    invalid/…               ← must fail with expected error codes
```

## Layers

| Layer | Normative home | Optional? |
|-------|----------------|-----------|
| **Pack core** | [PROTOCOL.md](../PROTOCOL.md) + [schemas/](../schemas/) | No |
| **Conformance** | `mix keyverse.conformance` + fixtures here | CI gate |
| **Door HTTP profile** | [docs/API.md](../docs/API.md) | Yes — transport |
| **Ownership transfer** | [docs/OWNERSHIP.md](../docs/OWNERSHIP.md) | Profile for doors |
| **Host runtime** | Elixir release / any door | Replaceable |

## Commands

```sh
mix keyverse.conformance              # all fixtures
mix keyverse.conformance path/to/pack # one pack
mix keyverse.export PACK_DIR out.zip
mix keyverse.import in.zip DEST_DIR
```

## Fixture contract

Each fixture directory may include `expect.json`:

```json
{ "must_pass": true }
{ "error_codes_any": ["slug_filename_mismatch"] }
```

Valid fixtures must validate. Invalid fixtures must fail and, when
`error_codes_any` is set, produce at least one listed code.

## Hardening checklist

- [x] Pack fixtures + offline validator
- [x] Export/import zip (user data only)
- [x] HTTP pack transfer profile
- [x] Ownership doc
- [ ] External JSON Schema CI (ajv) optional second client
- [ ] Op-log / multi-writer (ADR 0008)
- [ ] Stable 0.2 version pin (stop `-demo` suffix)
