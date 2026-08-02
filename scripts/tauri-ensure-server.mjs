#!/usr/bin/env node
/**
 * Ensure local keyverse (mix) is listening before `tauri dev` attaches the webview.
 * Non-destructive: if :4180 already answers, exit 0 immediately.
 * Otherwise spawn `mix run --no-halt` and wait for /health.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const HOST = process.env.KV_DEV_HOST || "127.0.0.1";
const PORT = process.env.PORT || process.env.KV_DEV_PORT || "4180";
const BASE = `http://${HOST}:${PORT}`;
const ROOT = new URL("..", import.meta.url).pathname;

async function healthy() {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch {
    return false;
  }
}

if (await healthy()) {
  console.log(`[tauri-dev] keyverse already up at ${BASE}`);
  process.exit(0);
}

console.log(`[tauri-dev] starting mix on ${BASE} …`);
const child = spawn("mix", ["run", "--no-halt"], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, HOST, PORT: String(PORT) },
  detached: false,
});

child.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(`[tauri-dev] mix exited ${code}`);
    process.exit(code);
  }
});

for (let i = 0; i < 60; i++) {
  await sleep(500);
  if (await healthy()) {
    console.log(`[tauri-dev] ready ${BASE}`);
    // Keep mix alive as long as this process lives (Tauri keeps beforeDevCommand running).
    await new Promise(() => {});
  }
}

console.error("[tauri-dev] timed out waiting for /health");
child.kill("SIGTERM");
process.exit(1);
