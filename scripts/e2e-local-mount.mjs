#!/usr/bin/env node
/**
 * E2E: read-only local pack mount via Playwright + Chromium.
 *
 * Flow:
 *  1. Start (or reuse) keyverse on PORT
 *  2. Open /local
 *  3. Seed OPFS with protocol fixture (with_attachment) via KeyverseLocalMount.seedAndMount
 *  4. Assert note list, open note, assert body text + attachment CAS open
 *
 * Usage:
 *   node scripts/e2e-local-mount.mjs
 *   BASE_URL=http://127.0.0.1:4180 node scripts/e2e-local-mount.mjs   # reuse server
 *   KEEP_SERVER=1 node scripts/e2e-local-mount.mjs
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    console.error("playwright not installed. Run: npm i -D playwright && npx playwright install chromium");
    process.exit(2);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpOk(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForUrl(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    if (await httpOk(url)) return true;
    await sleep(250);
  }
  return false;
}

function readFixturePack() {
  const fixtureRoot = path.join(ROOT, "protocol/fixtures/valid/with_attachment");
  const notePath = path.join(fixtureRoot, "notes/jhn.3.16.json");
  const protoPath = path.join(fixtureRoot, "protocol.json");
  const attName = "987a0b63eed4f3f35f547163ae0f4a38267f7301592e8f896ae5c3f6aebdb165";
  const attPath = path.join(fixtureRoot, "attachments", attName);
  const attBuf = fs.readFileSync(attPath);
  const hash = createHash("sha256").update(attBuf).digest("hex");
  if (hash !== attName) {
    throw new Error(`fixture CAS mismatch: expected ${attName}, got ${hash}`);
  }
  return {
    pathMap: {
      "protocol.json": fs.readFileSync(protoPath, "utf8"),
      door: "fixture-with-attachment",
      "notes/jhn.3.16.json": fs.readFileSync(notePath, "utf8"),
      [`attachments/${attName}`]: { base64: attBuf.toString("base64") },
    },
    expectedText: "with file",
    expectedSlug: "jhn.3.16",
    attSha: attName,
    attBytes: attBuf.length,
  };
}

async function startServer(port) {
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    PACK_DIR: path.join(ROOT, ".e2e-packs"),
    FATHOM_SITE: "off",
    MIX_ENV: process.env.MIX_ENV || "dev",
  };
  fs.mkdirSync(env.PACK_DIR, { recursive: true });
  const child = spawn("mix", ["run", "--no-deps-check", "--no-halt"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => {
    log += d.toString();
  });
  child.stderr.on("data", (d) => {
    log += d.toString();
  });
  const ready = await waitForUrl(`http://127.0.0.1:${port}/health`, 80);
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error("server failed to become ready\n" + log.slice(-2000));
  }
  return { child, log: () => log };
}

async function main() {
  const { chromium } = loadPlaywright();
  const port = Number(process.env.PORT || 4191);
  const base = (process.env.BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
  const reuse = !!process.env.BASE_URL;
  let server = null;

  if (!reuse) {
    console.log(`starting keyverse on ${base} …`);
    server = await startServer(port);
  } else {
    const ok = await waitForUrl(`${base}/health`, 10);
    if (!ok) throw new Error(`BASE_URL not healthy: ${base}/health`);
  }

  const fixture = readFixturePack();
  let browser;
  const failures = [];

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (err) => failures.push("pageerror: " + err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") failures.push("console.error: " + msg.text());
    });

    await page.goto(`${base}/local`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="local-landing"]', { timeout: 10000 });

    // Landing should expose OPFS readiness in Chromium
    const opfsReady = await page.locator('[data-testid="local-opfs-ready"]').count();
    if (!opfsReady) failures.push("OPFS ready marker missing (Chromium should support OPFS)");

    // Seed + mount fixture pack (same code path as directory handle mount)
    const mountResult = await page.evaluate(async (pathMap) => {
      const store = await window.KeyverseLocalMount.seedAndMount(pathMap, {
        packName: "e2e-with-attachment",
        label: "e2e-with-attachment",
      });
      const notes = await store.listNotes();
      const man = await store.manifest();
      return {
        kind: store.kind,
        label: store.label,
        noteSlugs: notes.map((n) => n.slug),
        notes: man.notes,
        attachments: man.attachments,
        view: window.KeyverseLocalMount.getView(),
      };
    }, fixture.pathMap);

    if (mountResult.kind !== "local-fs") failures.push("store.kind !== local-fs");
    if (mountResult.view !== "home") failures.push("view !== home after mount");
    if (!mountResult.noteSlugs.includes(fixture.expectedSlug)) {
      failures.push("note list missing " + fixture.expectedSlug + ": " + JSON.stringify(mountResult.noteSlugs));
    }
    if (mountResult.attachments < 1) failures.push("manifest attachments < 1");

    await page.waitForSelector('[data-testid="local-note-list"]', { timeout: 5000 });
    const listText = await page.locator('[data-testid="local-note-list"]').innerText();
    if (!/JHN\.3\.16/i.test(listText) && !/jhn\.3\.16/i.test(listText)) {
      failures.push("home list UI missing JHN.3.16: " + listText);
    }

    // Open note via UI click
    await page.locator(`[data-testid="note-link-${fixture.expectedSlug}"]`).click();
    await page.waitForSelector('[data-testid="local-note"]', { timeout: 5000 });
    const outline = await page.locator('[data-testid="note-outline"]').innerText();
    const outlineFlat = outline.replace(/\s+/g, " ").trim();
    if (!outlineFlat.includes(fixture.expectedText)) {
      failures.push(`note body missing "${fixture.expectedText}": ${JSON.stringify(outline)}`);
    }
    // Catch the 3-col grid bug (text squeezed into bullet column → one glyph per line)
    const singleGlyphLines = outline
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => l.length === 1 && /[A-Za-z]/.test(l));
    if (singleGlyphLines.length >= 2) {
      failures.push("outline looks vertically broken (missing ochev grid col): " + JSON.stringify(outline));
    }
    const title = await page.locator('[data-testid="note-title"]').innerText();
    if (!/JHN\.3\.16/i.test(title)) failures.push("note title wrong: " + title);

    // Attachment present + CAS blob loads
    await page.waitForSelector('[data-testid="note-attachments"]', { timeout: 3000 });
    const attBtn = page.locator(`[data-testid="att-file-${fixture.attSha.slice(0, 8)}"] .local-att-open`);
    await attBtn.click();
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return el && el.dataset.loaded === "1";
      },
      `[data-testid="att-file-${fixture.attSha.slice(0, 8)}"] .local-att-open`,
      { timeout: 5000 }
    );

    const attCheck = await page.evaluate(
      async ({ sha, expectedLen }) => {
        const store = window.KeyverseLocalMount.getStore();
        const file = await store.getAttachment(sha);
        if (!file) return { ok: false, error: "null file" };
        const buf = new Uint8Array(await file.arrayBuffer());
        return { ok: true, size: buf.length, expectedLen };
      },
      { sha: fixture.attSha, expectedLen: fixture.attBytes }
    );
    if (!attCheck.ok) failures.push("getAttachment failed: " + JSON.stringify(attCheck));
    if (attCheck.size !== fixture.attBytes) {
      failures.push(`attachment size ${attCheck.size} !== ${fixture.attBytes}`);
    }

    // Back navigation
    await page.locator('[data-testid="local-back"]').click();
    await page.waitForSelector('[data-testid="local-home"]', { timeout: 3000 });

    // Static assets + enter page link
    const packStoreStatus = await page.evaluate(async (origin) => {
      const r = await fetch(origin + "/pack-store.js");
      return r.status;
    }, base);
    if (packStoreStatus !== 200) failures.push("/pack-store.js status " + packStoreStatus);

    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    const localLink = await page.locator('[data-testid="open-local-mount"]').count();
    if (!localLink) failures.push("enter page missing Open a local pack folder link");

    // Screenshot evidence
    const artDir = path.join(ROOT, "artifacts");
    fs.mkdirSync(artDir, { recursive: true });
    await page.goto(`${base}/local`, { waitUntil: "networkidle" });
    await page.evaluate(async (pathMap) => {
      await window.KeyverseLocalMount.seedAndMount(pathMap, {
        packName: "e2e-with-attachment",
        label: "e2e-with-attachment",
      });
    }, fixture.pathMap);
    await page.waitForSelector('[data-testid="local-home"]');
    const shotHome = path.join(artDir, "e2e-local-mount-home.png");
    await page.screenshot({ path: shotHome, fullPage: true });
    await page.locator(`[data-testid="note-link-${fixture.expectedSlug}"]`).click();
    await page.waitForSelector('[data-testid="local-note"]');
    const shotNote = path.join(artDir, "e2e-local-mount-note.png");
    await page.screenshot({ path: shotNote, fullPage: true });

    if (failures.length) {
      console.error("FAIL");
      for (const f of failures) console.error(" -", f);
      process.exitCode = 1;
    } else {
      console.log("PASS local-mount e2e");
      console.log("  mount:", JSON.stringify(mountResult));
      console.log("  screenshots:", shotHome, shotNote);
    }
  } finally {
    if (browser) await browser.close();
    if (server && !process.env.KEEP_SERVER) {
      server.child.kill("SIGTERM");
      await sleep(300);
      try {
        server.child.kill("SIGKILL");
      } catch {}
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
