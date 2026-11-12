import type { AtomicKvStore } from "@fedify/fedify/federation";
import { WorkersD1KvStore } from "../../dist/mod.js";

interface GeneratedD1Meta {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
  served_by_region?: string;
  served_by_primary?: boolean;
}

interface GeneratedD1Response {
  success: true;
  meta: GeneratedD1Meta & Record<string, unknown>;
  error?: never;
}

type GeneratedD1Result<T = unknown> = GeneratedD1Response & {
  results: T[];
};

interface GeneratedD1ExecResult {
  count: number;
  duration: number;
}

/**
 * Mirrors the D1 prepared statement declaration shape emitted by
 * `wrangler types`, but comes from a distinct local declaration source.
 */
interface GeneratedD1PreparedStatement {
  bind(...values: unknown[]): GeneratedD1PreparedStatement;
  first<T = unknown>(colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<GeneratedD1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<GeneratedD1Result<T>>;
  raw<T = unknown[]>(options: {
    columnNames: true;
  }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
}

interface GeneratedD1DatabaseSession {
  prepare(query: string): GeneratedD1PreparedStatement;
  batch<T = unknown>(
    statements: GeneratedD1PreparedStatement[],
  ): Promise<GeneratedD1Result<T>[]>;
  getBookmark(): string | null;
}

/**
 * Mirrors the D1 binding declaration shape emitted by `wrangler types`.
 */
interface GeneratedD1Database {
  prepare(query: string): GeneratedD1PreparedStatement;
  batch<T = unknown>(
    statements: GeneratedD1PreparedStatement[],
  ): Promise<GeneratedD1Result<T>[]>;
  exec(query: string): Promise<GeneratedD1ExecResult>;
  withSession(constraintOrBookmark?: string): GeneratedD1DatabaseSession;
}

declare const generatedD1: GeneratedD1Database;

export const store: AtomicKvStore = new WorkersD1KvStore(generatedD1);
export const sessionStore: AtomicKvStore = new WorkersD1KvStore(
  generatedD1.withSession("first-primary"),
  { initialized: true },
);
