#!/usr/bin/env node
/**
 * Merge BSB section headings from bible.helloao.org into chapters.json.gz.
 * Headings are public-domain BSB pericope titles; attached as verse.heading
 * (shown above that verse in the reader).
 *
 * Usage: node scripts/enrich-bsb-headings.mjs
 */
import { createGunzip, createGzip } from "node:zlib";
import { createReadStream, createWriteStream, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const packPath = path.join(root, "priv/bsb/chapters.json.gz");
const mobilePath = path.join(root, "mobile/assets/text/bsb/chapters.json.gz");
const API = "https://bible.helloao.org/api/BSB";

async function gunzipJson(file) {
  const zlib = await import("node:zlib");
  const buf = zlib.gunzipSync(readFileSync(file));
  return JSON.parse(buf.toString("utf8"));
}

async function gzipJson(obj, file) {
  const zlib = await import("node:zlib");
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  writeFileSync(file, zlib.gzipSync(payload, { level: 9 }));
}

function flattenContent(parts) {
  if (!Array.isArray(parts)) return String(parts || "");
  return parts
    .map((p) => (typeof p === "string" ? p : p?.text || ""))
    .join("")
    .trim();
}

async function fetchHeadings(book, chapter) {
  const url = `${API}/${book}/${chapter}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const data = await res.json();
  const content = data?.chapter?.content || [];
  /** @type {Record<number, string>} verse number -> heading before it */
  const map = {};
  let pending = null;
  for (const block of content) {
    if (block.type === "heading") {
      const t = flattenContent(block.content);
      if (t) pending = t;
    } else if (block.type === "verse" && block.number != null) {
      if (pending) {
        map[block.number] = pending;
        pending = null;
      }
    }
  }
  return map;
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function main() {
  if (!existsSync(packPath)) {
    console.error("missing", packPath);
    process.exit(1);
  }
  console.log("loading", packPath);
  const chapters = await gunzipJson(packPath);
  const keys = Object.keys(chapters);
  console.log("chapters", keys.length);

  // Unique book ids from keys
  let headingsAdded = 0;
  let chaptersWith = 0;
  let errors = 0;

  await mapPool(keys, 8, async (key) => {
    const [book, chStr] = key.split(".");
    const chapter = Number(chStr);
    const doc = chapters[key];
    if (!doc?.verses) return;
    try {
      const map = await fetchHeadings(book.toUpperCase(), chapter);
      let n = 0;
      doc.verses = doc.verses.map((vr) => {
        const h = map[vr.v];
        if (!h) {
          const { heading: _drop, ...rest } = vr;
          return rest;
        }
        n++;
        return { ...vr, heading: h };
      });
      if (n) {
        headingsAdded += n;
        chaptersWith++;
      }
      if (chaptersWith % 50 === 0 && n) process.stdout.write(".");
    } catch (e) {
      errors++;
      if (errors < 8) console.warn("\nfail", key, e.message);
    }
  });

  console.log(`\nok headings=${headingsAdded} chapters_with_headings=${chaptersWith} errors=${errors}`);
  console.log("writing", packPath);
  await gzipJson(chapters, packPath);
  if (existsSync(path.dirname(mobilePath))) {
    copyFileSync(packPath, mobilePath);
    console.log("copied", mobilePath);
  }
  // sample
  const sample = chapters["heb.8"]?.verses?.filter((v) => v.heading).slice(0, 3);
  console.log("sample heb.8", sample);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
