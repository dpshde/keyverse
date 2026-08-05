# Using keyverse

Day-to-day use of keyverse. Hosting and deploy: [SELF_HOST.md](./SELF_HOST.md),
[PRODUCTION.md](./PRODUCTION.md).

## Install as an app

| Platform | How |
|----------|-----|
| **Desktop Chrome / Edge** | Install icon in the address bar, or **Install** when offered |
| **Android Chrome** | Menu → **Install app** / **Add to Home screen** |
| **iPhone / iPad Safari** | Share → **Add to Home Screen** |

Install from a page under *your* key so the app opens your notes.

**Offline:** pages you already opened may work without a connection. Saving notes
and new attachments need the network.

## Open your notes

No account. Your **key** is four words — it’s also the link to your notes.

| Situation | What to do |
|-----------|------------|
| **First time** | Open the site → **Create and open notes** (suggested key, or type your own) |
| **This computer** (already set up) | Open the site → **Open my notes** |
| **Phone / another device** | Enter your key → **Open notes** |
| **New key** | Sign-in → **Create a new key** — keeps notes; old links stop working |
| **Return visit** | Bookmark after first open (key is remembered for prefilling) |
| **Share pack** | On home, tap your four-word key → QR + **Share** |
| **Share a passage** | On a note or reader page → **Share** — deep link to the **reading view** for that verse, range, or chapter (see below) |

Wrong key → try again.

### Passage deep links

Design: [ADR 0019](./adr/0019-passage-deep-link-sharing.md). Addressing: [ADR 0002](./adr/0002-osis-passage-addressing.md). Projection: [ADR 0004](./adr/0004-compose-dont-absorb.md).

| Scope | Example URL | What opens |
|-------|-------------|------------|
| Verse | `/{key}/read/jhn.3.16` | Chapter reader, verse highlighted; notes on that verse (and covering ranges) projected in |
| Range | `/{key}/read/jhn.3.16-18` | Same reader; range highlight + notes inside the range |
| Chapter | `/{key}/read/jhn.3` | Full chapter reading view + all notes in the chapter |

| Kind of link | Path | Use when |
|--------------|------|----------|
| **Share (default)** | `/read/{slug}` | Hand someone the projected study view |
| **Editor** | `/note/{slug}` | Jump straight to that address’s outline only |
| **Pack** | `/{key}/` | Full library / co-editing |

**Trust:** every deep link includes your multiword key. Anyone with the URL can open the whole pack (not only that passage). Rotate the key if a link leaks ([ADR 0011](./adr/0011-multiword-door-access.md)). Sealed notes still need the client passphrase ([ADR 0012](./adr/0012-client-side-note-encryption.md)).

**QR:** pack home is default. Passage QR:

```text
GET /{key}/api/share-qr?origin=https://your.host&path=/read/jhn.3.16
```

Allowed `path` values: `/`, `/note/<slug>`, `/read/<slug>`.

**Mobile:** Share from the note or reader header when sync is on. Local-only packs have no cloud URL until sync is enabled.

## Optional passphrase (encrypt notes)

Extra lock on note text (separate from your four-word key). Details:
[ADR 0012](./adr/0012-client-side-note-encryption.md), [PROTOCOL §3.1](../PROTOCOL.md).

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
| Type on the home search box | **Reference autocomplete** as you type (books → chapters → verses) |
| ↑ / ↓ | Move through suggestions |
| Enter | Open the highlighted suggestion (or submit free text) |
| Tab | Fill the box with the suggestion and keep typing (e.g. pick a book, then chapter) |
| Esc | Close the suggestion list |
| Free text submit | Same as before → editor (`/note/…`) or chapter reader (`/read/…`) |
| `/go?q=Rom+8:28-30` | Same normalization |
| Sloppy URL `/note/john.3.16` | 302 to canonical `/note/jhn.3.16` |

### Home note list (folders)

Notes are still **one file per address** ([ADR 0004](./adr/0004-compose-dont-absorb.md)).
The home list *projects* a tree from OSIS geometry:

| What you see | Meaning |
|--------------|---------|
| **Chapter folder** (e.g. John 3) | Verse/range notes in that chapter when there is no chapter note |
| **Chapter note** as folder | If you have a note on the whole chapter, it is the parent row; contained notes nest under it |
| **Click a parent row** | Expand / collapse that branch (same as the chevron; remembered in this browser) |
| **Click a leaf verse/passage** | Opens the reader scrolled to that spot (highlighted) |
| **Edit icon** (pencil, every row) | Opens the note editor for that address |
| **Read icon** (book, every row) | Opens the reading view (verse/range scopes highlight in the chapter) |
| **Indent** | Contained passages (e.g. John 3:16 under John 3:16–18 under John 3) |
| **Chevron** | Collapse / expand a branch |

Sort is scripture order (book → chapter → verse), not recency. Multi-chapter ranges sit at book level.

API: `GET /api/suggest?q=john+3` (see PROTOCOL §7).

## Editor (`/note/<slug>`)

- **Outliner:** each line is a bullet (Dotflowy-style fundamentals). Blank
  bullets are allowed. Collapse state is saved on the note ([ADR 0013](./adr/0013-outline-collapse-and-structural-ops.md)).
- **Autosave** after a short debounce. Status shows “saved” / “saved · encrypted” /
  “cleared” / errors.

### Keyboard (fundamentals)

| Key | Action |
|-----|--------|
| **Enter** | Split at caret → new sibling (at end of an **expanded** bullet with children → new **first child**) |
| **Tab** / **Shift+Tab** | Nest / unnest (moves whole subtree) |
| **⌘/Ctrl+Shift+↑** / **↓** | Move among siblings; at the edge reparent under the parent’s adjacent sibling |
| **⌘/Ctrl+↑** / **↓** | Collapse / expand |
| **Backspace** at start of empty bullet | Delete and focus previous |
| **Backspace** at start with text | Join into previous |
| **⌘/Ctrl+Shift+Backspace** | Delete bullet and its whole subtree |
| **↑** / **↓** at line edges | Move between bullets (keeps caret column) |
| **←** / **→** at line edges | Snake to previous / next bullet |
| **⌘/Ctrl+Z** / **⌘/Ctrl+Shift+Z** | Undo / redo |
| **Shift+↑** / **↓** at line edges | Select whole nodes (extends one step; then Tab indents, **Backspace/Delete** removes all selected roots + subtrees, Esc clears) |
| **⌘/Ctrl+A** | Select all visible nodes (then Backspace/Delete for multi-node delete) |

**Mouse / touch:** hover chevron to fold; drag the **bullet** to reorder/reparent;
**Shift+click** a bullet/row to extend multi-node selection; mobile toolbar has
unnest / nest / fold.

- **Inline markdown** (stored as markers, like Dotflowy):

  | Type | Example |
  |------|---------|
  | Bold | `**loved the world**` |
  | Italic | `*only Son*` or `_only Son_` |
  | Strike | `~~old note~~` |
  | Code | `` `JHN.3.16` `` |
  | Link | `[essay](https://example.com)` |
  | Wiki | `[[John 3:16]]` or `[[John 3:16\|label]]` |

  Focus a line → edit **source**. Blur / other lines → **rendered**. Reader
  always shows rendered form. No nested styles (`***` is not bold+italic).
- **Attachments:** one quiet list under the note. **+ File**, or **+ Link**
  (expands to a field; Enter to add, Esc to cancel). Remove with ×.
- **Within / Part of / Overlaps:** inbox cards — open the related note; they are
  not embedded editors (compose-don’t-absorb).

Mobile: Nest/Unnest/Fold toolbar sticks above the home indicator; large tap targets.

## Reading view (`/read/<slug>`)

This is the **default share target** for a verse, range, or chapter
([ADR 0019](./adr/0019-passage-deep-link-sharing.md)).

- BSB chapter text (fetched once, cached under `pack/text/bsb/`).
- **Click verse text:** show/hide all notes for that verse (all or none). Empty
  verse → start a note on that verse.
- **Expand notes** (header): open every verse tray that has notes — useful for
  verse-by-verse (VBV) review. Toggles to **collapse notes**; **Esc** also
  collapses all when everything is open. Hidden when the chapter has no notes.
- **Long-press** a verse: always open/create a **single-verse** note (even when
  a multi-verse passage note covers that verse).
- **Select a passage** (multi-verse note):

  | Gesture | Result |
  |---------| |--------|
  | **Shift+click** another verse | Note on the continuous range (e.g. John 3:16–18) |
  | **Drag** across verses (mouse) | Same — release to write |
  | **Long-press then drag** to another verse (touch) | Same |
- Selected verses highlight as one block; the passage note opens **after** the
  last verse (so you read the whole passage, then the note). Address is still
  `jhn.3.16-18`. Label shows **Passage · John 3:16–18** while reading and writing.
- Small gutter dot = verse has notes while collapsed (including sealed notes, and
  every verse inside a range note).
- **Passage** notes vs **This verse** notes are separated when both exist under
  the same end verse.
- Click an outline (or passage label) to edit that note **inline**.
- **Encrypted** notes show a short “open to unlock” link (full editor unlock
  flow) instead of an inline outline.
- **Unselect** a multi-verse selection: click any selected verse again, click
  outside the scripture, or **Esc**.
- Esc steps back: editing → selection/notes → clear.

Chapter note (if any) sits above the chapter text; click to edit.

## Cross-references

| Syntax | Meaning |
|--------|---------|
| `[[John 3:16]]` | Link to that passage address |
| `[[jhn.3.16]]` | Same via slug |
| `[[John 3:16\|label]]` | Custom display label (useful when linking notes by meaning) |
| `![[att:att_…]]` | Embed/link a file attachment on this note |
| `![[https://example.com]]` | External URL |

**Typing `[[` in the outliner** (mobile + web) opens a suggester:

- **Passages / books** — same autocomplete style as the home search field
- **Other notes** — matches slug, display name, and note body text (local pack scan)

Accept inserts a complete `[[…]]` (natural-language target by default). Optional `|label` still works if you type it.

**Clicking a wiki link** always opens the **reader** (not the bare note editor):

| Target | Behavior |
|--------|----------|
| Passage only (no note file yet) | Reader scrolled / highlighted to that ref |
| Note exists at that address | Reader scrolled there **with that note tray expanded** |

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

**Mobile + cloud:** local delete must clear the door too, or quietSync will pull
the note back. The client keeps a pending-delete tombstone until an empty PUT
succeeds; full sync re-checks live notes before push. See
[ADR 0021](./adr/0021-local-delete-wins-cloud-mirror.md) and
[mobile/README.md](../mobile/README.md#cloud-mirror--note-deletes).

## Related

- Protocol (incl. encryption envelope): [PROTOCOL.md §3.1](../PROTOCOL.md)
- Self-host / production: [SELF_HOST.md](./SELF_HOST.md), [PRODUCTION.md](./PRODUCTION.md)
- Decisions: [ADR 0011 door](./adr/0011-multiword-door-access.md), [ADR 0012 encryption](./adr/0012-client-side-note-encryption.md), [ADR 0021 local delete vs mirror](./adr/0021-local-delete-wins-cloud-mirror.md), [adr/](./adr/)
