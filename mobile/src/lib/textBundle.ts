/**
 * Bundled offline chapter text: BSB + KJV (public domain).
 * Packs are chapters.json.gz (same shape as server priv/bsb).
 */
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { gunzipSync } from "fflate";
import { Platform } from "react-native";
import type { ChapterText } from "../api/types";

export type TranslationId = "BSB" | "KJV";

type PackIndex = Record<string, ChapterText>;

const cache: Partial<Record<TranslationId, PackIndex>> = {};
const loadPromise: Partial<Record<TranslationId, Promise<PackIndex>>> = {};

// Metro requires static require paths
const ASSETS: Record<TranslationId, number> = {
  BSB: require("../../assets/text/bsb/chapters.json.gz"),
  KJV: require("../../assets/text/kjv/chapters.json.gz"),
};

function b64ToBytes(b64: string): Uint8Array {
  if (typeof globalThis.atob === "function") {
    const bin = globalThis.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const outLen = (clean.length * 3) / 4 - padding;
  const bytes = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (chars.indexOf(clean[i]) << 18) |
      (chars.indexOf(clean[i + 1]) << 12) |
      (chars.indexOf(clean[i + 2]) << 6) |
      chars.indexOf(clean[i + 3]);
    if (p < outLen) bytes[p++] = (n >> 16) & 255;
    if (p < outLen) bytes[p++] = (n >> 8) & 255;
    if (p < outLen) bytes[p++] = n & 255;
  }
  return bytes;
}

async function loadPack(tr: TranslationId): Promise<PackIndex> {
  if (cache[tr]) return cache[tr]!;
  if (loadPromise[tr]) return loadPromise[tr]!;
  loadPromise[tr] = (async () => {
    const asset = Asset.fromModule(ASSETS[tr]);
    await asset.downloadAsync();
    const uri = asset.localUri || asset.uri;
    if (!uri) throw new Error(`missing asset uri for ${tr}`);

    // Web: fetch ArrayBuffer (readAsStringAsync is native-only). Native: FileSystem base64.
    let gz: Uint8Array;
    if (Platform.OS === "web") {
      const res = await fetch(uri);
      if (!res.ok) throw new Error(`fetch ${uri}: ${res.status}`);
      gz = new Uint8Array(await res.arrayBuffer());
    } else {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      gz = b64ToBytes(b64);
    }

    const jsonBytes = gunzipSync(gz);
    const text = new TextDecoder().decode(jsonBytes);
    const idx = JSON.parse(text) as PackIndex;
    cache[tr] = idx;
    return idx;
  })();
  try {
    return await loadPromise[tr]!;
  } finally {
    delete loadPromise[tr];
  }
}

export async function preloadTexts(trs: TranslationId[] = ["BSB", "KJV"]): Promise<void> {
  await Promise.all(trs.map((t) => loadPack(t).catch(() => null)));
}

/** Sync chapter text if pack already in memory (no gunzip). */
export function peekChapter(
  tr: TranslationId,
  book: string,
  chapter: number
): ChapterText | null {
  const idx = cache[tr];
  if (!idx) return null;
  const doc = idx[`${book.toLowerCase()}.${chapter}`];
  if (!doc) return null;
  return {
    ...doc,
    translation: tr,
    book: doc.book || book.toUpperCase(),
    chapter: doc.chapter || chapter,
    verses: doc.verses || [],
  };
}

export async function getChapter(
  tr: TranslationId,
  book: string,
  chapter: number
): Promise<ChapterText> {
  const idx = await loadPack(tr);
  const key = `${book.toLowerCase()}.${chapter}`;
  const doc = idx[key];
  if (!doc) throw new Error(`${tr} chapter not found: ${key}`);
  return {
    ...doc,
    translation: tr,
    book: doc.book || book.toUpperCase(),
    chapter: doc.chapter || chapter,
    verses: doc.verses || [],
  };
}

export function chapterKey(book: string, chapter: number): string {
  return `${book.toLowerCase()}.${chapter}`;
}
