/**
 * Self-test for sync merge policy (mirrors syncMerge.ts rules).
 * Run: node mobile/scripts/sync-merge-selftest.mjs
 */
function contentScore(note) {
  if (!note) return { nonempty: 0, chars: 0, attCount: 0, empty: true, encrypted: false };
  if (note.encrypted) return { nonempty: 1, chars: 1, attCount: 0, empty: false, encrypted: true };
  let nonempty = 0,
    chars = 0;
  for (const b of note.blocks || []) {
    const t = (b.text || "").trim();
    if (!t) continue;
    nonempty++;
    chars += t.length;
  }
  const attCount = (note.attachments || []).length;
  return { nonempty, chars, attCount, empty: nonempty === 0 && attCount === 0, encrypted: false };
}

function isNewer(a, b) {
  const aa = a || "";
  const bb = b || "";
  if (!aa) return false;
  if (!bb) return true;
  return aa > bb;
}

function wouldDestroyRemote(local, remote) {
  const L = contentScore(local);
  const R = contentScore(remote);
  if (R.empty) return false;
  if (L.encrypted || R.encrypted) return false;
  if (L.empty && !R.empty) return true;
  if (L.nonempty < R.nonempty && L.chars < R.chars) return true;
  if (L.nonempty <= R.nonempty && R.chars >= 40 && L.chars < R.chars * 0.5) return true;
  return false;
}

function richer(a, b) {
  const A = contentScore(a);
  const B = contentScore(b);
  if (A.nonempty !== B.nonempty) return A.nonempty > B.nonempty ? "a" : "b";
  if (A.chars !== B.chars) return A.chars > B.chars ? "a" : "b";
  if (A.attCount !== B.attCount) return A.attCount > B.attCount ? "a" : "b";
  return "tie";
}

function decideMerge({ local, remote, pendingDelete }) {
  if (pendingDelete) return "delete_remote";
  if (!local && remote) return "pull";
  if (local && !remote) {
    if (contentScore(local).empty) return "skip";
    return "push";
  }
  if (!local && !remote) return "skip";
  if (wouldDestroyRemote(local, remote)) {
    return "pull";
  }
  if (isNewer(local.updated_at, remote.updated_at)) return "push";
  if (isNewer(remote.updated_at, local.updated_at)) return "pull";
  const r = richer(local, remote);
  if (r === "a") return "push";
  if (r === "b") return "pull";
  return "skip";
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("ok:", msg);
  }
}

const thin = {
  updated_at: "2026-08-08T01:00:00.000Z",
  blocks: [{ id: "b1", indent: 0, text: "Remember sins no more" }],
};
const rich = {
  updated_at: "2026-08-08T01:01:00.000Z",
  blocks: [
    { id: "b1", indent: 0, text: "Remember sins no more" },
    { id: "b2", indent: 1, text: "God claimed us as HIS via Jesus" },
  ],
};
const empty = { updated_at: "2026-08-08T02:00:00.000Z", blocks: [{ id: "b1", indent: 0, text: "" }] };

// Classic stomp: thin older vs rich newer → pull
assert(decideMerge({ local: thin, remote: rich }) === "pull", "older thin pulls richer remote");

// Empty never stomps
assert(
  decideMerge({
    local: empty,
    remote: rich,
  }) === "pull",
  "empty local pulls remote even if clock newer"
);

// Local only with content → push
assert(
  decideMerge({ local: { ...rich, updated_at: "t" }, remote: null }) === "push",
  "local-only content pushes"
);

// Local only empty shell → skip
assert(decideMerge({ local: empty, remote: null }) === "skip", "empty local-only skips");

// Pending delete
assert(
  decideMerge({ local: rich, remote: rich, pendingDelete: true }) === "delete_remote",
  "pending delete wins"
);

// Remote only
assert(decideMerge({ local: null, remote: rich }) === "pull", "remote-only pulls");

// Bulk sync must not push thinner even if clock is newer (mirror path allows shrink)
const intentionalThin = {
  updated_at: "2026-08-08T03:00:00.000Z",
  blocks: [{ id: "b1", indent: 0, text: "Remember sins no more" }],
};
assert(
  decideMerge({ local: intentionalThin, remote: rich }) === "pull",
  "bulk plan pulls richer remote even when local is newer thin"
);

// Equal stamp: richer wins
const a = { updated_at: "T", blocks: [{ id: "1", indent: 0, text: "x" }] };
const b = {
  updated_at: "T",
  blocks: [
    { id: "1", indent: 0, text: "x" },
    { id: "2", indent: 0, text: "yy" },
  ],
};
assert(decideMerge({ local: a, remote: b }) === "pull", "equal stamp prefers richer remote");
assert(decideMerge({ local: b, remote: a }) === "push", "equal stamp prefers richer local");

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall sync-merge selftests passed");
