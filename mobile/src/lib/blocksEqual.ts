import type { Block } from "../api/types";

/** True when outline content is equivalent (skip pointless editor rehydrate). */
export function blocksEqual(a: Block[] | undefined, b: Block[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      (a[i].text || "") !== (b[i].text || "") ||
      (a[i].indent | 0) !== (b[i].indent | 0) ||
      !!a[i].collapsed !== !!b[i].collapsed
    ) {
      return false;
    }
  }
  return true;
}
