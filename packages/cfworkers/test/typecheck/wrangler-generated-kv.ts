import type { Queue } from "@cloudflare/workers-types";
import { WorkersKvStore, WorkersMessageQueue } from "../../dist/mod.js";

interface GeneratedKvGetWithMetadataResult<Value, Metadata> {
  readonly value: Value | null;
  readonly metadata: Metadata | null;
  readonly cacheStatus: string | null;
}

interface GeneratedKvListKey<Metadata, Key extends string = string> {
  readonly name: Key;
  readonly expiration?: number;
  readonly metadata?: Metadata;
}

type GeneratedKvListResult<Metadata, Key extends string = string> =
  | {
    readonly list_complete: false;
    readonly keys: readonly GeneratedKvListKey<Metadata, Key>[];
    readonly cursor: string;
    readonly cacheStatus: string | null;
  }
  | {
    readonly list_complete: true;
    readonly keys: readonly GeneratedKvListKey<Metadata, Key>[];
    readonly cacheStatus: string | null;
  };

/**
 * Mirrors the minimal single-key Cloudflare KV declaration shape emitted by
 * `wrangler types`, but comes from a distinct local declaration source.
 */
interface GeneratedKvNamespace<Key extends string = string> {
  get(key: Key): Promise<string | null>;
  get<ExpectedValue = unknown>(
    key: Key,
    type: "json",
  ): Promise<ExpectedValue | null>;
  getWithMetadata<Metadata = unknown>(
    key: Key,
  ): Promise<GeneratedKvGetWithMetadataResult<string, Metadata>>;
  getWithMetadata<ExpectedValue = unknown, Metadata = unknown>(
    key: Key,
    type: "json",
  ): Promise<GeneratedKvGetWithMetadataResult<ExpectedValue, Metadata>>;
  put(
    key: Key,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: {
      expiration?: number;
      expirationTtl?: number;
      metadata?: any | null;
    },
  ): Promise<void>;
  delete(key: Key): Promise<void>;
  list<Metadata = unknown>(
    options?: {
      limit?: number;
      prefix?: string | null;
      cursor?: string | null;
    },
  ): Promise<GeneratedKvListResult<Metadata, Key>>;
}

declare const queue: Queue;
declare const generatedKv: GeneratedKvNamespace<string>;

new WorkersKvStore(generatedKv);
new WorkersMessageQueue(queue, { orderingKv: generatedKv });
