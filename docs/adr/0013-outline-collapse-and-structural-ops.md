# 0013. Outline collapse and structural ops on flat blocks

## Status

Accepted

## Context

The reference outliner already supports Enter / Tab nest / join / multi-line paste
([ADR 0003](./0003-flat-blocks-outline.md)). Users who know Workflowy or Dotflowy
still miss collapse, move-among-siblings, undo, multi-select, and drag reorder.

Dotflowy stores a full graph (`parentId`, `prevSiblingId`, `collapsed`, kinds).
Keyverse keeps **flat indent blocks** as the pack truth. We want Dotflowy-class
*fundamentals* without adopting its product layer (zoom, tags, mirrors, tasks).

## Decision

1. **Optional `collapsed` on blocks** — boolean, JSON only. When true and the
   block has children in the indent projection, the UI hides descendants until
   expanded. Omitted/`false` = expanded. Text interchange (`?raw` / curl) does
   **not** encode collapse; a text PUT resets it (JSON PUT is canonical for UI).

2. **Structural ops stay client-side** on the flat array: move up/down among
   siblings, edge reparent into the parent’s adjacent sibling, indent with
   subtree, delete subtree, **multi-node delete** (delete every selected root
   and its indent-subtree), Enter-as-first-child when expanded with children.
   Server only validates indent monotonicity via existing `normalizeBlocks`.

3. **Undo/redo, multi-select, drag** are client-only session state (not in the
   pack), except that their *results* persist as normal block edits + `collapsed`.
   Multi-select is a contiguous visible run (Shift+arrows, Shift+click, or
   ⌘/Ctrl+A); Backspace/Delete removes all selection roots in one history step.

4. **Out of scope here:** zoom, task/complete, paragraph kind, tags, Cmd+K,
   slash menu, OPML, MCP.

## Consequences

- **Easier:** pack files stay simple; collapse survives reload and encryption
  payload; no new backend endpoints.
- **Harder:** move/reparent and multi-select must preserve indent invariants
  (`indent ≤ prev+1`); full re-render editor must re-focus carefully.
- **Implication:** readers should honor `collapsed` so saved shape matches
  the editor. Future op-log can add `collapse` / `move` ops by block id.
