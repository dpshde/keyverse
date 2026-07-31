# Using versepack

Day-to-day product surface of the reference door. Paths below assume you already
opened your **multiword door** (`/{door}/…`). See [SELF_HOST.md](./SELF_HOST.md)
and [ADR 0011](./adr/0011-multiword-door-access.md).

## Open the pack

1. Start the server and copy the printed URL, e.g.  
   `http://localhost:4180/quiet-river-lantern/`
2. Bookmark it. That URL is access (cowyo-style).
3. If you only remember the words: open `http://host:port/`, paste the phrase,
   **Open door**.

There is no account screen after that.

## Optional encryption (pack passphrase)

Separate from the multiword door — same idea as cowyo’s page password.
Details: [ADR 0012](./adr/0012-client-side-note-encryption.md), [PROTOCOL §3.1](../PROTOCOL.md).

| Action | What happens |
|--------|----------------|
| **Set passphrase** (home or editor bar) | Session-only; never sent to the server |
| Edit while set | Autosave writes `{ encrypted: true, cipher }` only; status **saved · encrypted** |
| Open sealed note | Unlock gate, or auto-unlock if the session still has the phrase |
| URL tip | `…/note/jhn.3.16#pw=yourphrase` — hash is stripped after load |
| **Lock** | Clears passphrase from this browser; reload |
| **Unlock** (bar) | Prompt + reload; use when opening sealed notes on another tab |

| | Door (URL) | Pack passphrase |
|--|------------|-----------------|
| Protects | Who can hit the pack | Who can read sealed note text |
| Stored | `pack/door` / env | Your head (+ browser session) |
| Server sees | Routes under `/{door}/` | Ciphertext only |

**Limits:** forget the passphrase → sealed content is gone. File **bytes** under
`attachments/` stay content-addressed (not passphrase-encrypted); only outline
text and attachment metadata are sealed. Home list shows excerpt **encrypted**
for sealed notes.

## Find a passage

| Action | Result |
|--------|--------|
| Type on the home search box | Goes to editor (`/note/…`) or reader for chapters (`/read/…`) |
| `/go?q=Rom+8:28-30` | Same normalization |
| Sloppy URL `/note/john.3.16` | 302 to canonical `/note/jhn.3.16` |

## Editor (`/note/<slug>`)

- **Outliner:** each line is a bullet. **Enter** new item; **Nest** / **Unnest**
  (or Tab / Shift-Tab) change indent. Blank bullets are allowed.
- **Autosave** after a short debounce. Status shows “saved” / “saved · encrypted” /
  “cleared” / errors.
- **Wiki links:** type `[[John 3:16]]` or `[[John 3:16|label]]`. Shown as links
  when the outline is read-only (reader / after reload). While editing, text is
  raw `[[…]]`.
- **Attachments:** two separate kinds on every note page:
  - **Files** — “Add file” (any type; multi-select; mobile camera/files via system picker)
  - **Links** — paste `https://…` and “Add link”  
  Listed separately; remove with ×. Stored per PROTOCOL §5.
- **Within / Part of / Overlaps:** inbox cards — open the related note; they are
  not embedded editors (compose-don’t-absorb).

Mobile: Nest/Unnest toolbar sticks above the home indicator; large tap targets.

## Reading view (`/read/<slug>`)

- BSB chapter text (fetched once, cached under `pack/text/bsb/`).
- **Click verse text:** show/hide all notes for that verse (all or none).
- Small gutter dot = verse has notes while collapsed (including sealed notes).
- **Passage** notes (ranges starting here) vs **This verse** notes are separated
  when both exist.
- Click an outline (or passage label) to edit that note **inline**.
- **Encrypted** notes show a short “open to unlock” link (full editor unlock
  flow) instead of an inline outline.
- Esc steps back: editing → notes shown → notes hidden.

Chapter note (if any) sits above the chapter text; click to edit.

## Cross-references

| Syntax | Meaning |
|--------|---------|
| `[[John 3:16]]` | Link to that note address |
| `[[jhn.3.16]]` | Same via slug |
| `[[John 3:16\|label]]` | Custom label |
| `![[att:att_…]]` | Embed/link a file attachment on this note |
| `![[https://example.com]]` | External URL |

Full rules: [PROTOCOL.md §4.1 and §5](../PROTOCOL.md).

## Attachments

Files and links are **separate types** in the UI (not mixed into one list):

| Kind | Storage | UI |
|------|---------|-----|
| **Files** | `pack/attachments/<sha256>` | “Add file”; image thumbs when applicable; open/download |
| **Links** | Metadata on the note only | “Add link” form; open externally |

No MIME allowlist. Large files: `MAX_ATTACH_BYTES` (default 50 MiB).  
In the reader, files and links for a note appear under its outline when notes are open.

## Empty note

Clearing all text **and** removing attachments deletes the note file (cowyo empty
page). A note that only has attachments keeps a blank bullet so the address
remains.

## Related

- Protocol (incl. encryption envelope): [PROTOCOL.md §3.1](../PROTOCOL.md)
- Self-host / production: [SELF_HOST.md](./SELF_HOST.md), [PRODUCTION.md](./PRODUCTION.md)
- Decisions: [ADR 0011 door](./adr/0011-multiword-door-access.md), [ADR 0012 encryption](./adr/0012-client-side-note-encryption.md), [adr/](./adr/)
