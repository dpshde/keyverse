/**
 * keyverse protocol types (door HTTP profile + pack note records).
 * Unknown keys MUST be ignored by clients (PROTOCOL.md).
 */

export type ScopeKind = "verse" | "range" | "chapter";

export interface Scope {
  kind: ScopeKind;
  osis: string;
  slug: string;
}

export interface Block {
  id: string;
  indent: number;
  text: string;
  collapsed?: boolean;
}

export interface FileAttachment {
  id: string;
  kind: "file";
  name: string;
  mime?: string;
  sha256: string;
  bytes?: number;
  created_at?: string;
}

export interface UrlAttachment {
  id: string;
  kind: "url";
  url: string;
  title?: string;
  created_at?: string;
}

export type Attachment = FileAttachment | UrlAttachment;

export interface CipherEnvelope {
  v: number;
  alg: string;
  kdf: string;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

export interface Note {
  id: string;
  scope: Scope;
  blocks?: Block[];
  attachments?: Attachment[];
  encrypted?: boolean;
  cipher?: CipherEnvelope;
  body?: string; // legacy
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface ProtocolInfo {
  protocol: string;
  version: string;
  multipack?: boolean;
  door?: boolean;
  door_phrase?: string;
  door_open?: boolean;
  cors?: boolean;
  max_attach_bytes?: number;
  features?: Record<string, boolean>;
  endpoints?: string[];
  [key: string]: unknown;
}

export interface ResolveResult {
  ok: boolean;
  q?: string;
  scope?: Scope;
  label?: string;
  error?: string;
}

export interface SuggestItem {
  label: string;
  insertText: string;
  canonical: string;
  kind: string;
}

export interface ChapterVerse {
  v: number;
  text: string;
  /** Section heading shown above this verse (BSB pericope titles) */
  heading?: string;
}

export interface ChapterText {
  translation?: string;
  book: string;
  chapter: number;
  verses: ChapterVerse[];
  [key: string]: unknown;
}

export interface ReadBundle {
  ok: boolean;
  meta?: {
    display?: string;
    book?: string;
    chapter?: number;
    slug?: string;
    [key: string]: unknown;
  };
  seed?: Record<string, Block[]>;
  text?: ChapterText;
  notes?: Note[];
  error?: string;
  [key: string]: unknown;
}

export interface PackManifest {
  protocol?: string;
  door?: string;
  notes?: number;
  attachments?: number;
  attachment_bytes?: number;
  [key: string]: unknown;
}
