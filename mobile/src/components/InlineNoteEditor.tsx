import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { Attachment, Block, Note } from "../api/types";
import { hydrateBlocks } from "../api/client";
import { Outliner } from "./Outliner";
import * as Local from "../lib/localPack";
import { blocksEqual } from "../lib/blocksEqual";
import { mirrorNoteIfCloud } from "../lib/cloudSync";
import { hapticLight } from "../lib/haptics";
import { pushOnce } from "../lib/nav";
import { useTheme } from "../context/ThemeContext";
import { radius, space, type ThemeColors } from "../theme";


type Props = {
  slug: string;
  /** Optional label above the outliner (e.g. range passage name) */
  label?: string;
  /** Seed blocks when creating / unlocking */
  initialBlocks?: Block[];
  initialAttachments?: Attachment[];
  /**
   * Bumps when the note changes externally (e.g. full note page save).
   * Prefer note.updated_at so the tray rehydrates without remounting the reader.
   */
  revision?: string;
  encrypted?: boolean;
  locked?: boolean;
  lockedMessage?: string;
  /** Called after a successful local write (for index refresh) */
  onSaved?: (note: Note | { deleted: true; slug: string }) => void;
  /**
   * Live block edits (before debounce save). Reader uses this so the has-note
   * rail clears as soon as content is emptied, not only after autosave.
   */
  onBlocksLive?: (blocks: Block[]) => void;
  compact?: boolean;
  /**
   * Offer a quiet text control to open the dedicated /note/[slug] page.
   * Default true for reader trays.
   */
  allowFullPage?: boolean;
};

/**
 * Inline outliner under a verse: quick capture + debounced save.
 * Stays live with the full note page via localPack.subscribeNoteChanges.
 */
export function InlineNoteEditor({
  slug,
  label,
  initialBlocks,
  initialAttachments = [],
  revision,
  encrypted,
  locked,
  lockedMessage = "Encrypted — set passphrase in Settings",
  onSaved,
  onBlocksLive,
  compact = true,
  allowFullPage = true,
}: Props) {
  const { color, ui, type } = useTheme();
  const styles = useMemo(() => makeInlineNoteStyles(color, type), [color, type]);
  const router = useRouter();
  const [blocks, setBlocks] = useState<Block[]>(() =>
    initialBlocks?.length ? initialBlocks : Local.emptyBlocks()
  );
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments);
  const blocksRef = useRef(blocks);
  const attsRef = useRef(attachments);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while local edits are unflushed — ignore external rehydrate. */
  const dirtyRef = useRef(false);
  /**
   * Note was deleted elsewhere (home swipe / empty save / cloud). Blocks further
   * autosave and unmount flush so dirty tray content cannot resurrect the note.
   */
  const deletedRef = useRef(false);
  const saveGen = useRef(0);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onBlocksLiveRef = useRef(onBlocksLive);
  onBlocksLiveRef.current = onBlocksLive;
  blocksRef.current = blocks;
  attsRef.current = attachments;

  const applyBlocks = useCallback((next: Block[], atts?: Attachment[]) => {
    if (blocksEqual(next, blocksRef.current) && atts === undefined) return;
    setBlocks(next.length ? next : Local.emptyBlocks());
    if (atts !== undefined) setAttachments(atts);
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // New slug mount — allow saves again
  useEffect(() => {
    deletedRef.current = false;
  }, [slug]);

  // Seed / external revision from parent (reader resolved map)
  useEffect(() => {
    if (deletedRef.current || dirtyRef.current || timer.current) return;
    if (initialBlocks) {
      applyBlocks(initialBlocks.length ? initialBlocks : Local.emptyBlocks());
    }
    if (initialAttachments) {
      setAttachments(initialAttachments);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision drives external sync
  }, [slug, revision]);

  // Live: full note page / cloud pull / other surfaces
  useEffect(() => {
    return Local.subscribeNoteChanges((ch) => {
      if (ch.slug !== slug) return;
      if (ch.deleted) {
        // Always honor local deletes — even mid-type — so zombies cannot re-save
        clearTimer();
        dirtyRef.current = false;
        deletedRef.current = true;
        saveGen.current += 1;
        applyBlocks(Local.emptyBlocks(), []);
        onBlocksLiveRef.current?.(Local.emptyBlocks());
        return;
      }
      // Don't clobber in-progress typing
      if (dirtyRef.current || timer.current) return;
      deletedRef.current = false;
      const note = ch.note;
      if (note.encrypted) {
        // Encrypted body not available without passphrase — parent handles lock UI
        return;
      }
      applyBlocks(hydrateBlocks(note), (note.attachments || []) as Attachment[]);
    });
  }, [slug, applyBlocks, clearTimer]);

  const save = useCallback(async () => {
    clearTimer();
    if (deletedRef.current) return null;
    const gen = ++saveGen.current;
    try {
      const res = await Local.putNote(slug, {
        blocks: blocksRef.current,
        attachments: attsRef.current,
      });
      if (gen !== saveGen.current || deletedRef.current) return res;
      dirtyRef.current = false;
      if ("deleted" in res && res.deleted) {
        deletedRef.current = true;
      }
      onSavedRef.current?.(res);
      // Mirror put *or* empty-delete so cloud cannot resurrect cleared notes
      mirrorNoteIfCloud(slug).catch(() => {});
      return res;
    } catch {
      if (gen !== saveGen.current) return null;
      return null;
    }
  }, [slug, clearTimer]);

  const scheduleSave = useCallback(() => {
    if (deletedRef.current) return;
    dirtyRef.current = true;
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      void save();
    }, 650);
  }, [save, clearTimer]);

  const onBlocksChange = useCallback((next: Block[]) => {
    // User is typing again after a delete — intentional recreate
    deletedRef.current = false;
    dirtyRef.current = true;
    setBlocks(next);
    onBlocksLiveRef.current?.(next);
  }, []);

  const openFullPage = useCallback(async () => {
    hapticLight();
    if (timer.current != null || dirtyRef.current) {
      await save();
    }
    pushOnce(router, `/note/${encodeURIComponent(slug)}`);
  }, [save, router, slug]);

  useEffect(() => {
    return () => {
      if (deletedRef.current) return;
      if (timer.current == null && !dirtyRef.current) return;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      // Unmount flush — skip if deleted while tray was open (pending or gone)
      void (async () => {
        if (deletedRef.current) return;
        if (await Local.isPendingDelete(slug)) return;
        try {
          const res = await Local.putNote(slug, {
            blocks: blocksRef.current,
            attachments: attsRef.current,
          });
          dirtyRef.current = false;
          onSavedRef.current?.(res);
          mirrorNoteIfCloud(slug).catch(() => {});
        } catch {
          /* ignore */
        }
      })();
    };
  }, [slug]);

  if (locked || (encrypted && !initialBlocks?.length)) {
    return (
      <View style={[styles.tray, compact && styles.trayCompact]}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <Text style={styles.locked}>{lockedMessage}</Text>
        {allowFullPage ? (
          <Pressable onPress={openFullPage} hitSlop={8} accessibilityRole="link">
            <Text style={ui.link}>Open full note</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  // Stable element so Outliner React.memo is not defeated every parent render
  const fullNoteLink = useMemo(
    () =>
      allowFullPage ? (
        <Pressable
          onPress={openFullPage}
          accessibilityRole="button"
          accessibilityLabel="Open full note page"
          hitSlop={8}
          style={({ pressed }) => [styles.fullLink, pressed && styles.fullLinkPressed]}
        >
          <Text style={styles.fullTxt}>Open full note</Text>
        </Pressable>
      ) : null,
    [allowFullPage, openFullPage]
  );

  return (
    <View style={[styles.tray, compact && styles.trayCompact]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Outliner
        blocks={blocks}
        onChange={onBlocksChange}
        editable
        compact={compact}
        onDirty={scheduleSave}
        // Same footer row as nest/unnest (not stacked above Open full note)
        footerEnd={compact ? fullNoteLink : undefined}
      />
      {!compact && fullNoteLink ? (
        <View style={styles.fullRow}>{fullNoteLink}</View>
      ) : null}
    </View>
  );
}

function makeInlineNoteStyles(color: ThemeColors, type: { caption: object; meta: object; bodyStrong: object; title: object; label: object; [k: string]: object }) {
  return StyleSheet.create({
  tray: {
    marginTop: space[2],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: color.fill,
    gap: space[2],
  },
  trayCompact: {
    paddingTop: space[3],
    paddingBottom: space[1],
    paddingHorizontal: space[3],
    gap: space[2],
  },
  label: {
    ...type.label,
    marginBottom: 0,
  },
  fullRow: {
    alignSelf: "stretch",
    minHeight: 44,
    justifyContent: "center",
    paddingTop: space[2],
    paddingBottom: space[1],
    marginTop: space[1],
    marginBottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.lineSoft,
  },
  fullLink: {
    minHeight: 40,
    justifyContent: "center",
    paddingVertical: 8,
  },
  fullLinkPressed: {
    opacity: 0.65,
  },
  fullTxt: {
    fontSize: 15,
    fontWeight: "600",
    color: color.inkSoft,
    letterSpacing: -0.2,
  },
  locked: {
    color: color.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
}
