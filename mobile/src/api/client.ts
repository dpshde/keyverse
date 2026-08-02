/**
 * Full door HTTP client — protocol checklist from docs/API.md.
 * BASE = {host}/{door}  (multiword door is the pack selector / secret).
 */
import type {
  Attachment,
  Block,
  Note,
  PackManifest,
  ProtocolInfo,
  ReadBundle,
  ResolveResult,
  SuggestItem,
  ChapterText,
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
  /** e.g. https://keyverse-production.up.railway.app */
  host: string;
  /** multiword door phrase, or "" if DOOR_OPEN host */
  door: string;
};

function joinUrl(host: string, path: string): string {
  const h = host.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${h}${p}`;
}

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

  private async req(
    method: string,
    path: string,
    init: RequestInit & { rawBody?: ArrayBuffer | Blob | string } = {}
  ): Promise<{ status: number; body: unknown; headers: Headers; res: Response }> {
    const url = path.startsWith("http") ? path : `${this.base}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(init.headers || {});
    const { rawBody, ...rest } = init;
    const body = rawBody !== undefined ? rawBody : rest.body;
    const res = await fetch(url, { ...rest, method, headers, body: body as BodyInit | undefined });
    const parsed = await parseBody(res);
    if (!res.ok) {
      const msg =
        typeof parsed === "object" && parsed && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new ApiError(res.status, parsed, msg);
    }
    return { status: res.status, body: parsed, headers: res.headers, res };
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

  async resolve(q: string): Promise<ResolveResult> {
    const { body } = await this.req("GET", `/api/resolve?q=${encodeURIComponent(q)}`);
    return body as ResolveResult;
  }

  async suggest(q: string, limit = 8): Promise<SuggestItem[]> {
    const { body } = await this.req(
      "GET",
      `/api/suggest?q=${encodeURIComponent(q)}&limit=${limit}`
    );
    const b = body as { suggestions?: SuggestItem[] };
    return b.suggestions || [];
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
    if (!res.ok) {
      const parsed = await parseBody(res);
      throw new ApiError(res.status, parsed);
    }
    return res.text();
  }

  /**
   * PUT note. Omit `attachments` to preserve existing (protocol rule).
   * Empty blank blocks + no attachments → delete.
   */
  async putNote(
    slug: string,
    payload: {
      blocks?: Block[];
      attachments?: Attachment[];
      encrypted?: boolean;
      cipher?: Note["cipher"];
    }
  ): Promise<Note | { deleted: true; slug: string }> {
    const { body } = await this.req("PUT", `/api/note/${encodeURIComponent(slug)}`, {
      headers: { "content-type": "application/json" },
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
      headers: {
        "content-type": mime,
        "x-filename": filename,
      },
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

  shareQrUrl(origin: string): string {
    return `${this.base}/api/share-qr?origin=${encodeURIComponent(origin)}`;
  }
}

/** Hydrate legacy body → blocks (PROTOCOL.md). */
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
