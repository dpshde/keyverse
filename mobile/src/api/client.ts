/**
 * Full door HTTP client — complete protocol surface (docs/API.md + PROTOCOL.md).
 */
import type {
  Attachment,
  Block,
  ChapterText,
  Note,
  PackManifest,
  ProtocolInfo,
  ReadBundle,
  ResolveResult,
  SuggestItem,
  CipherEnvelope,
} from "./types";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export type SessionConfig = {
  host: string;
  door: string;
};

export function doorBase(cfg: SessionConfig): string {
  const h = cfg.host.replace(/\/+$/, "");
  const d = (cfg.door || "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!d) return h;
  return `${h}/${d}`;
}

async function parseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class KeyverseClient {
  constructor(public cfg: SessionConfig) {}

  get base(): string {
    return doorBase(this.cfg);
  }

  get hostRoot(): string {
    return this.cfg.host.replace(/\/+$/, "");
  }

  private async req(
    method: string,
    path: string,
    init: RequestInit & { rawBody?: ArrayBuffer | Blob | string; base?: "door" | "host" } = {}
  ): Promise<{ status: number; body: unknown; headers: Headers; res: Response }> {
    const root = init.base === "host" ? this.hostRoot : this.base;
    const url = path.startsWith("http")
      ? path
      : `${root}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(init.headers || {});
    const { rawBody, base: _b, ...rest } = init;
    const body = rawBody !== undefined ? rawBody : rest.body;
    const res = await fetch(url, { ...rest, method, headers, body: body as BodyInit | undefined });
    const parsed = await parseBody(res);
    if (!res.ok) {
      const msg =
        typeof parsed === "object" && parsed && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : typeof parsed === "string" && parsed.length < 200
            ? parsed
            : `HTTP ${res.status}`;
      throw new ApiError(res.status, parsed, msg);
    }
    return { status: res.status, body: parsed, headers: res.headers, res };
  }

  // —— Host (no door) ——
  async health(): Promise<Record<string, unknown>> {
    const { body } = await this.req("GET", "/health", { base: "host" });
    return body as Record<string, unknown>;
  }

  /**
   * Claim a new multipack door (form POST /setup).
   * Returns normalized door phrase on success.
   */
  async setupClaim(door: string): Promise<string> {
    const body = new URLSearchParams();
    body.set("door", door);
    body.set("intent", "claim");
    const res = await fetch(`${this.hostRoot}/setup`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      body: body.toString(),
      redirect: "manual",
    });
    // 302 → /{door}/
    const loc = res.headers.get("location") || "";
    const m = loc.match(/\/([a-z0-9]+(?:-[a-z0-9]+){2,})\//i);
    if (m) return m[1].toLowerCase();
    if (res.status >= 200 && res.status < 400) {
      // follow-up: try open protocol on claimed door
      const d = door.trim().toLowerCase().replace(/\s+/g, "-");
      const probe = await fetch(`${this.hostRoot}/${d}/api/protocol`);
      if (probe.ok) return d;
    }
    const text = await res.text();
    throw new ApiError(res.status, text, "setup claim failed");
  }

  // —— Discovery ——
  async protocol(): Promise<ProtocolInfo> {
    const { body } = await this.req("GET", "/api/protocol");
    return body as ProtocolInfo;
  }

  async doorInfo(): Promise<Record<string, unknown>> {
    const { body } = await this.req("GET", "/api/door");
    return body as Record<string, unknown>;
  }

  async rotateDoor(): Promise<{ door: string; pack_id?: string; url_path?: string }> {
    const { body } = await this.req("POST", "/api/door/rotate", {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return body as { door: string; pack_id?: string; url_path?: string };
  }

  async resolve(q: string): Promise<ResolveResult> {
    const { body } = await this.req("GET", `/api/resolve?q=${encodeURIComponent(q)}`);
    return body as ResolveResult;
  }

  async suggest(q: string, limit = 8): Promise<SuggestItem[]> {
    const { body } = await this.req(
      "GET",
      `/api/suggest?q=${encodeURIComponent(q)}&limit=${limit}`
    );
    return (body as { suggestions?: SuggestItem[] }).suggestions || [];
  }

  // —— Notes ——
  async listNotes(): Promise<Note[]> {
    const { body } = await this.req("GET", "/api/notes");
    return Array.isArray(body) ? (body as Note[]) : [];
  }

  async getNote(slug: string): Promise<Note> {
    const { body } = await this.req("GET", `/api/note/${encodeURIComponent(slug)}`);
    return body as Note;
  }

  async getNoteRaw(slug: string): Promise<string> {
    const url = `${this.base}/api/note/${encodeURIComponent(slug)}?raw`;
    const res = await fetch(url, { headers: { Accept: "text/plain" } });
    if (!res.ok) throw new ApiError(res.status, await parseBody(res));
    return res.text();
  }

  /**
   * PUT note JSON.
   * @param opts.baseUpdatedAt When set, sends `X-KV-Base-Updated-At` so the door
   *   returns **409** if the on-disk note is newer (optimistic concurrency).
   * @param opts.allowShrink When true, sends `X-KV-Allow-Shrink: 1` so intentional
   *   line-deletes pass the door anti-stomp guard. **Bulk quietSync must omit this.**
   */
  async putNote(
    slug: string,
    payload: {
      blocks?: Block[];
      attachments?: Attachment[];
      encrypted?: boolean;
      cipher?: CipherEnvelope;
    },
    opts?: { baseUpdatedAt?: string; allowShrink?: boolean }
  ): Promise<Note | { deleted: true; slug: string }> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts?.baseUpdatedAt) {
      headers["x-kv-base-updated-at"] = opts.baseUpdatedAt;
    }
    if (opts?.allowShrink) {
      headers["x-kv-allow-shrink"] = "1";
    }
    const { body } = await this.req("PUT", `/api/note/${encodeURIComponent(slug)}`, {
      headers,
      body: JSON.stringify(payload),
    });
    return body as Note | { deleted: true; slug: string };
  }

  async putNoteText(slug: string, text: string): Promise<Note | { deleted: true; slug: string }> {
    const { body } = await this.req("PUT", `/api/note/${encodeURIComponent(slug)}`, {
      headers: { "content-type": "text/plain" },
      body: text,
    });
    return body as Note | { deleted: true; slug: string };
  }

  // —— Attachments ——
  async addUrlAttachment(
    slug: string,
    url: string,
    title?: string
  ): Promise<Note | { encrypted: true; attachment: Attachment }> {
    const { body } = await this.req("POST", `/api/note/${encodeURIComponent(slug)}/attachments`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "url", url, title }),
    });
    return body as Note | { encrypted: true; attachment: Attachment };
  }

  async addFileAttachment(
    slug: string,
    bytes: ArrayBuffer,
    filename: string,
    mime = "application/octet-stream"
  ): Promise<Note | { encrypted: true; attachment: Attachment }> {
    const { body } = await this.req("POST", `/api/note/${encodeURIComponent(slug)}/attachments`, {
      headers: { "content-type": mime, "x-filename": filename },
      rawBody: bytes,
    });
    return body as Note | { encrypted: true; attachment: Attachment };
  }

  async deleteAttachment(
    slug: string,
    attId: string,
    sha256?: string
  ): Promise<Note | { encrypted: true; removed: string }> {
    const q = sha256 ? `?sha256=${encodeURIComponent(sha256)}` : "";
    const { body } = await this.req(
      "DELETE",
      `/api/note/${encodeURIComponent(slug)}/attachments/${encodeURIComponent(attId)}${q}`
    );
    return body as Note | { encrypted: true; removed: string };
  }

  attachmentBlobUrl(sha256: string, name?: string): string {
    const q = name ? `?name=${encodeURIComponent(name)}` : "";
    return `${this.base}/api/attachments/${sha256}${q}`;
  }

  async getAttachmentBytes(sha256: string): Promise<ArrayBuffer> {
    const res = await fetch(this.attachmentBlobUrl(sha256));
    if (!res.ok) throw new ApiError(res.status, await parseBody(res));
    return res.arrayBuffer();
  }

  // —— Scripture / reader ——
  async chapterText(book: string, chapter: number): Promise<ChapterText> {
    const { body } = await this.req(
      "GET",
      `/api/text/bsb/${encodeURIComponent(book)}/${chapter}`
    );
    return body as ChapterText;
  }

  async readBundle(slug: string): Promise<ReadBundle> {
    const { body } = await this.req("GET", `/api/read/${encodeURIComponent(slug)}`);
    return body as ReadBundle;
  }

  // —— Pack ownership ——
  async packManifest(): Promise<PackManifest> {
    const { body } = await this.req("GET", "/api/pack");
    return body as PackManifest;
  }

  exportUrl(): string {
    return `${this.base}/api/pack/export`;
  }

  shareQrUrl(origin?: string): string {
    const o = origin || this.hostRoot;
    return `${this.base}/api/share-qr?origin=${encodeURIComponent(o)}`;
  }

  async importPack(
    zipBytes: ArrayBuffer,
    mode: "merge" | "replace" = "merge"
  ): Promise<Record<string, unknown>> {
    const { body } = await this.req("POST", `/api/pack/import?mode=${mode}`, {
      headers: { "content-type": "application/zip" },
      rawBody: zipBytes,
    });
    return body as Record<string, unknown>;
  }

  async exportPackBytes(): Promise<ArrayBuffer> {
    const res = await fetch(this.exportUrl());
    if (!res.ok) throw new ApiError(res.status, await parseBody(res));
    return res.arrayBuffer();
  }

  /**
   * Contribution heatmap. Default = calendar YTD (Jan 1 → today).
   * Pass `days` only for a trailing N-day window.
   */
  async activityHeatmap(days?: number): Promise<{
    days: { date: string; count: number; level: number }[];
    total: number;
    notes_taken_ytd: number;
    /** @deprecated use notes_taken_ytd */
    lines_added_ytd?: number;
    ytd_from: string;
    ytd_to: string;
    from: string;
    to: string;
    source: string;
    canon?: {
      books: {
        osis: string;
        name: string;
        chapters: number;
        notes: number;
        ratio: number;
        heat: number;
        t0: number;
        t1: number;
      }[];
      testament_seam_t: number;
      total_chapters: number;
      total_notes: number;
      books_with_notes: number;
      heat_scale?: { notes_per_chapter_at_90: number };
    };
  }> {
    const q = days != null ? `?days=${days}` : "";
    const { body } = await this.req("GET", `/api/activity${q}`);
    return body as {
      days: { date: string; count: number; level: number }[];
      total: number;
      notes_taken_ytd: number;
      lines_added_ytd?: number;
      ytd_from: string;
      ytd_to: string;
      from: string;
      to: string;
      source: string;
      canon?: {
        books: {
          osis: string;
          name: string;
          chapters: number;
          notes: number;
          ratio: number;
          heat: number;
          t0: number;
          t1: number;
        }[];
        testament_seam_t: number;
        total_chapters: number;
        total_notes: number;
        books_with_notes: number;
        heat_scale?: { notes_per_chapter_at_90: number };
      };
    };
  }

  /** Events for one UTC day, with before/after outline text when ops exist. */
  async activityDay(date: string): Promise<{
    date: string;
    count: number;
    events: {
      kind: string;
      slug: string;
      label: string;
      at: string;
      hash?: string | null;
      summary: string;
      before_text?: string | null;
      after_text?: string | null;
      encrypted?: boolean;
      has_diff?: boolean;
    }[];
  }> {
    const { body } = await this.req("GET", `/api/activity?date=${encodeURIComponent(date)}`);
    return body as {
      date: string;
      count: number;
      events: {
        kind: string;
        slug: string;
        label: string;
        at: string;
        hash?: string | null;
        summary: string;
        before_text?: string | null;
        after_text?: string | null;
        encrypted?: boolean;
        has_diff?: boolean;
      }[];
    };
  }
}

export function hydrateBlocks(note: Note): Block[] {
  if (Array.isArray(note.blocks) && note.blocks.length) {
    return note.blocks.map((b, i) => ({
      id: b.id || `b_${i}`,
      indent: Math.max(0, b.indent | 0),
      text: b.text || "",
      collapsed: !!b.collapsed,
    }));
  }
  if (typeof note.body === "string" && note.body.length) {
    return note.body.split("\n").map((line, i) => {
      const m = /^( *)(.*)$/.exec(line);
      const spaces = m ? m[1].length : 0;
      return {
        id: `b_legacy_${i}`,
        indent: Math.floor(spaces / 2),
        text: m ? m[2] : line,
      };
    });
  }
  return [{ id: newBlockId(), indent: 0, text: "" }];
}

export function newBlockId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function blocksToInterchange(blocks: Block[]): string {
  return blocks.map((b) => `${"  ".repeat(b.indent | 0)}${b.text || ""}`).join("\n");
}

export function isBlankNote(blocks: Block[], attachments: Attachment[]): boolean {
  const emptyBlocks = !blocks.some((b) => (b.text || "").trim());
  return emptyBlocks && attachments.length === 0;
}
