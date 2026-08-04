/**
 * Protocol §3.1 client-side note encryption (cowyo-style).
 * PBKDF2-HMAC-SHA-256 210000 iter, AES-256-GCM, 16-byte salt, 12-byte IV.
 * Passphrase never leaves the device.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import type { Attachment, Block, CipherEnvelope } from "../api/types";

export const CRYPTO_ITER = 210_000;

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  // RN has btoa via hermes? use manual base64
  if (typeof globalThis.btoa === "function") return globalThis.btoa(s);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    out += b === undefined ? "=" : chars[(n >> 6) & 63];
    out += c === undefined ? "=" : chars[n & 63];
  }
  return out;
}

function unb64(s: string): Uint8Array {
  if (typeof globalThis.atob === "function") {
    const bin = globalThis.atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const len = clean.length;
  const outLen = (len * 3) / 4 - padding;
  const bytes = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
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

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** Session cache — PBKDF2 210k is expensive; reuse key for same (passphrase, salt). */
const keyCache = new Map<string, Uint8Array>();

function deriveKey(passphrase: string, salt: Uint8Array): Uint8Array {
  const cacheKey = passphrase + "\0" + b64(salt);
  const hit = keyCache.get(cacheKey);
  if (hit) return hit;
  const key = pbkdf2(sha256, utf8ToBytes(passphrase), salt, {
    c: CRYPTO_ITER,
    dkLen: 32,
  });
  // Cap cache size (few sealed notes per session)
  if (keyCache.size > 32) keyCache.clear();
  keyCache.set(cacheKey, key);
  return key;
}

export type PlainPayload = { blocks: Block[]; attachments: Attachment[] };

export async function encryptPayload(
  obj: PlainPayload,
  passphrase: string
): Promise<CipherEnvelope> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const pt = utf8ToBytes(JSON.stringify(obj));
  const aes = gcm(key, iv);
  const ct = aes.encrypt(pt);
  return {
    v: 1,
    alg: "AES-GCM",
    kdf: "PBKDF2",
    iter: CRYPTO_ITER,
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(ct),
  };
}

export async function decryptPayload(
  cipher: CipherEnvelope,
  passphrase: string
): Promise<PlainPayload> {
  if (!cipher?.ct) throw new Error("missing cipher");
  const salt = unb64(cipher.salt);
  const iv = unb64(cipher.iv);
  const key = deriveKey(passphrase, salt);
  const aes = gcm(key, iv);
  const pt = aes.decrypt(unb64(cipher.ct));
  const obj = JSON.parse(bytesToUtf8(pt)) as PlainPayload;
  return {
    blocks: Array.isArray(obj.blocks) ? obj.blocks : [],
    attachments: Array.isArray(obj.attachments) ? obj.attachments : [],
  };
}
