/**
 * PackStore client profiles (ADR 0017).
 * - LocalFsPackStore: read-only File System Access / OPFS directory handle
 * - seed helpers for e2e (OPFS)
 */
(function (global) {
  "use strict";

  var PROTOCOL_NAME = "keyverse";
  var USER_FILES = { "protocol.json": true, door: true };
  var USER_DIRS = { notes: true, attachments: true };

  function canUseDirectoryPicker() {
    return typeof global.showDirectoryPicker === "function";
  }

  function canUseOpfs() {
    return !!(global.navigator && navigator.storage && typeof navigator.storage.getDirectory === "function");
  }

  async function readTextFile(dirHandle, name) {
    try {
      var fh = await dirHandle.getFileHandle(name);
      var file = await fh.getFile();
      return await file.text();
    } catch (e) {
      if (e && (e.name === "NotFoundError" || e.code === e.NOT_FOUND_ERR)) return null;
      throw e;
    }
  }

  async function readBinaryFile(dirHandle, name) {
    try {
      var fh = await dirHandle.getFileHandle(name);
      return await fh.getFile();
    } catch (e) {
      if (e && (e.name === "NotFoundError" || e.code === e.NOT_FOUND_ERR)) return null;
      throw e;
    }
  }

  async function getSubdir(dirHandle, name, create) {
    try {
      return await dirHandle.getDirectoryHandle(name, create ? { create: true } : undefined);
    } catch (e) {
      if (!create && e && (e.name === "NotFoundError" || e.code === e.NOT_FOUND_ERR)) return null;
      throw e;
    }
  }

  async function writeFile(dirHandle, name, data) {
    var fh = await dirHandle.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }

  /**
   * Recursively remove all entries in a directory handle (OPFS / FSA).
   */
  async function clearDirectory(dirHandle) {
    var names = [];
    for await (var entry of dirHandle.values()) {
      names.push({ name: entry.name, kind: entry.kind });
    }
    for (var i = 0; i < names.length; i++) {
      var ent = names[i];
      await dirHandle.removeEntry(ent.name, { recursive: ent.kind === "directory" });
    }
  }

  /**
   * Write a flat path map into a directory handle.
   * paths: { "protocol.json": string|Uint8Array|Blob, "notes/x.json": ... }
   */
  async function writePathMap(rootHandle, pathMap) {
    var keys = Object.keys(pathMap);
    for (var i = 0; i < keys.length; i++) {
      var rel = keys[i].replace(/^\/+/, "").replace(/\\/g, "/");
      if (!rel || rel.indexOf("..") !== -1) throw new Error("unsafe path: " + rel);
      var parts = rel.split("/");
      var dir = rootHandle;
      for (var p = 0; p < parts.length - 1; p++) {
        dir = await dir.getDirectoryHandle(parts[p], { create: true });
      }
      var data = pathMap[keys[i]];
      await writeFile(dir, parts[parts.length - 1], data);
    }
  }

  function LocalFsPackStore(dirHandle, opts) {
    this.kind = "local-fs";
    this.readOnly = true;
    this._root = dirHandle;
    this._label = (opts && opts.label) || dirHandle.name || "This folder";
    this._protocol = null;
    this._notesDir = null;
    this._attsDir = null;
  }

  Object.defineProperty(LocalFsPackStore.prototype, "label", {
    get: function () {
      return this._label;
    },
  });

  LocalFsPackStore.prototype.getProtocol = async function () {
    if (this._protocol) return this._protocol;
    var raw = await readTextFile(this._root, "protocol.json");
    var door = await readTextFile(this._root, "door");
    var version = null;
    var protocol = PROTOCOL_NAME;
    if (raw) {
      try {
        var j = JSON.parse(raw);
        protocol = j.protocol || protocol;
        version = j.version || null;
      } catch (e) {
        throw new Error("invalid protocol.json");
      }
    }
    this._protocol = {
      protocol: protocol,
      version: version,
      door_phrase: door ? String(door).trim() : null,
      kind: "local-fs",
      read_only: true,
      label: this._label,
    };
    return this._protocol;
  };

  LocalFsPackStore.prototype._notes = async function () {
    if (this._notesDir) return this._notesDir;
    this._notesDir = await getSubdir(this._root, "notes", false);
    return this._notesDir;
  };

  LocalFsPackStore.prototype._attachments = async function () {
    if (this._attsDir) return this._attsDir;
    this._attsDir = await getSubdir(this._root, "attachments", false);
    return this._attsDir;
  };

  LocalFsPackStore.prototype.listNotes = async function () {
    var notesDir = await this._notes();
    if (!notesDir) return [];
    var out = [];
    for await (var entry of notesDir.values()) {
      if (entry.kind !== "file") continue;
      if (!entry.name.endsWith(".json")) continue;
      var slug = entry.name.slice(0, -".json".length);
      var text = await readTextFile(notesDir, entry.name);
      if (text == null) continue;
      var rec;
      try {
        rec = JSON.parse(text);
      } catch (e) {
        out.push({
          slug: slug,
          id: null,
          label: slug,
          encrypted: false,
          updated_at: null,
          error: "invalid json",
        });
        continue;
      }
      var scope = rec.scope || {};
      var label =
        scope.osis ||
        (scope.slug ? String(scope.slug).toUpperCase() : null) ||
        slug.toUpperCase();
      out.push({
        slug: scope.slug || slug,
        id: rec.id || null,
        label: label,
        kind: scope.kind || null,
        encrypted: !!(rec.encrypted || rec.cipher),
        updated_at: rec.updated_at || rec.created_at || null,
        block_count: Array.isArray(rec.blocks) ? rec.blocks.length : 0,
        attachment_count: Array.isArray(rec.attachments) ? rec.attachments.length : 0,
      });
    }
    out.sort(function (a, b) {
      return String(a.slug).localeCompare(String(b.slug));
    });
    return out;
  };

  LocalFsPackStore.prototype.getNote = async function (slug) {
    var notesDir = await this._notes();
    if (!notesDir) return null;
    var safe = String(slug || "")
      .trim()
      .toLowerCase();
    if (!safe || safe.indexOf("..") !== -1 || safe.indexOf("/") !== -1) {
      throw new Error("invalid slug");
    }
    var text = await readTextFile(notesDir, safe + ".json");
    if (text == null) return null;
    return JSON.parse(text);
  };

  LocalFsPackStore.prototype.getAttachment = async function (sha256) {
    var hex = String(sha256 || "")
      .trim()
      .toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) return null;
    var atts = await this._attachments();
    if (!atts) return null;
    return readBinaryFile(atts, hex);
  };

  LocalFsPackStore.prototype.manifest = async function () {
    var notes = await this.listNotes();
    var attsDir = await this._attachments();
    var attCount = 0;
    var attBytes = 0;
    if (attsDir) {
      for await (var entry of attsDir.values()) {
        if (entry.kind !== "file") continue;
        if (!/^[0-9a-f]{64}$/i.test(entry.name)) continue;
        attCount++;
        try {
          var f = await (await attsDir.getFileHandle(entry.name)).getFile();
          attBytes += f.size || 0;
        } catch (e) {}
      }
    }
    var proto = await this.getProtocol();
    return {
      protocol: proto.protocol,
      version: proto.version,
      door: proto.door_phrase,
      notes: notes.length,
      attachments: attCount,
      attachment_bytes: attBytes,
      user_owned: true,
      kind: "local-fs",
      read_only: true,
      export: {
        include: ["protocol.json", "door", "notes/**", "attachments/**"],
        exclude: ["text/**", "_cache/**"],
      },
    };
  };

  /**
   * Open a directory handle as a pack. Requires protocol.json or notes/.
   */
  async function openLocalPack(dirHandle, opts) {
    if (!dirHandle) throw new Error("missing directory handle");
    var protoRaw = await readTextFile(dirHandle, "protocol.json");
    var notesDir = await getSubdir(dirHandle, "notes", false);
    if (!protoRaw && !notesDir) {
      throw new Error("That folder doesn’t look like keyverse notes");
    }
    if (protoRaw) {
      try {
        var j = JSON.parse(protoRaw);
        if (j.protocol && j.protocol !== PROTOCOL_NAME) {
          throw new Error("That folder isn’t keyverse notes");
        }
      } catch (e) {
        if (e.message && e.message.indexOf("That folder") === 0) throw e;
        throw new Error("That folder isn’t keyverse notes");
      }
    }
    var label = (opts && opts.label) || null;
    if (!label) {
      var door = await readTextFile(dirHandle, "door");
      label = (door && String(door).trim()) || dirHandle.name || "This folder";
    }
    var store = new LocalFsPackStore(dirHandle, { label: label });
    await store.getProtocol();
    return store;
  }

  async function pickAndOpenLocalPack() {
    if (!canUseDirectoryPicker()) {
      throw new Error("Opening a folder needs Chrome or Edge on this device");
    }
    var handle = await global.showDirectoryPicker({ mode: "read" });
    return openLocalPack(handle);
  }

  /**
   * E2E / test helper: seed OPFS with a path map and open as LocalFsPackStore.
   * pathMap values: string | ArrayBuffer | Uint8Array | { base64: string }
   */
  async function seedOpfsPackAndOpen(pathMap, opts) {
    if (!canUseOpfs()) throw new Error("OPFS not available");
    opts = opts || {};
    var packName = opts.packName || "keyverse-e2e-pack";
    var root = await navigator.storage.getDirectory();
    // Remove previous pack if present
    try {
      await root.removeEntry(packName, { recursive: true });
    } catch (e) {}
    var pack = await root.getDirectoryHandle(packName, { create: true });
    var normalized = {};
    var keys = Object.keys(pathMap || {});
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = pathMap[k];
      if (v && typeof v === "object" && v.base64) {
        var bin = atob(v.base64);
        var bytes = new Uint8Array(bin.length);
        for (var b = 0; b < bin.length; b++) bytes[b] = bin.charCodeAt(b);
        normalized[k] = bytes;
      } else {
        normalized[k] = v;
      }
    }
    await writePathMap(pack, normalized);
    return openLocalPack(pack, { label: opts.label || packName });
  }

  global.KeyversePackStore = {
    PROTOCOL_NAME: PROTOCOL_NAME,
    USER_FILES: USER_FILES,
    USER_DIRS: USER_DIRS,
    canUseDirectoryPicker: canUseDirectoryPicker,
    canUseOpfs: canUseOpfs,
    LocalFsPackStore: LocalFsPackStore,
    openLocalPack: openLocalPack,
    pickAndOpenLocalPack: pickAndOpenLocalPack,
    seedOpfsPackAndOpen: seedOpfsPackAndOpen,
    writePathMap: writePathMap,
    clearDirectory: clearDirectory,
  };
})(typeof window !== "undefined" ? window : globalThis);
