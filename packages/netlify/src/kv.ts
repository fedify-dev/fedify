import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreSetOptions,
} from "@fedify/fedify/federation";
import { decodeBase64Url, encodeBase64Url } from "byte-encodings/base64url";
import { isEqual } from "es-toolkit";
import type { NetlifyBlobsStore } from "./types.ts";

const MAX_BLOB_KEY_BYTES = 600;
const BLOB_KEY_PREFIX = "fedify1.";
const BLOB_KEY_SEPARATOR = ".";
const textDecoder = new TextDecoder();

/**
 * A key-value store that uses Netlify Blobs.
 *
 * @since 2.4.0
 */
export class NetlifyBlobsKvStore implements KvStore {
  readonly #store: NetlifyBlobsStore;

  /**
   * Creates a new Netlify Blobs-backed key-value store.
   * @param store The Netlify Blobs store to use.
   */
  constructor(store: NetlifyBlobsStore) {
    this.#store = store;
  }

  private serializeKey(key: KvKey): string {
    const serialized = BLOB_KEY_PREFIX +
      key.map((part) => encodeBase64Url(part)).join(BLOB_KEY_SEPARATOR) +
      BLOB_KEY_SEPARATOR;
    if (new TextEncoder().encode(serialized).byteLength > MAX_BLOB_KEY_BYTES) {
      throw new RangeError(
        "The encoded key exceeds Netlify Blobs' 600-byte key limit.",
      );
    }
    return serialized;
  }

  private deserializeKey(key: string): KvKey {
    const encodedParts = key.slice(BLOB_KEY_PREFIX.length, -1).split(
      BLOB_KEY_SEPARATOR,
    );
    return encodedParts.map((part) =>
      textDecoder.decode(decodeBase64Url(part))
    ) as [string, ...string[]];
  }

  private serializePrefix(prefix?: KvKey): string {
    return prefix == null ? BLOB_KEY_PREFIX : this.serializeKey(prefix);
  }

  private isAbsent(metadata: Record<string, unknown>): boolean {
    if (metadata.tombstone === true) return true;
    const expireIn = metadata.expireIn;
    return typeof expireIn === "number" &&
      expireIn <= Temporal.Now.instant().epochMilliseconds;
  }

  private getEtag(entry: { readonly etag?: string } | null): string {
    if (entry?.etag == null) {
      throw new Error("Netlify Blobs did not return an ETag.");
    }
    return entry.etag;
  }

  /**
   * {@inheritDoc KvStore.get}
   */
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    const result = await this.#store.getWithMetadata(this.serializeKey(key), {
      type: "json",
    });

    if (result === null || this.isAbsent(result.metadata)) return undefined;
    return result.data as T;
  }

  /**
   * {@inheritDoc KvStore.set}
   */
  async set(
    key: KvKey,
    value: unknown,
    options?: KvStoreSetOptions | undefined,
  ): Promise<void> {
    const expireIn = options?.ttl == null
      ? null
      : Temporal.Now.instant().epochMilliseconds +
        options.ttl.total("millisecond");

    await this.#store.setJSON(this.serializeKey(key), value, {
      metadata: { "expireIn": expireIn },
    });
  }

  /**
   * {@inheritDoc KvStore.delete}
   */
  delete(key: KvKey): Promise<void> {
    return this.#store.delete(this.serializeKey(key));
  }

  /**
   * {@inheritDoc KvStore.list}
   */
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    const pages = this.#store.list({
      paginate: true,
      prefix: this.serializePrefix(prefix),
    });
    for await (const page of pages) {
      for (const blob of page.blobs) {
        const key = this.deserializeKey(blob.key);
        const value = await this.get(key);

        if (value === undefined) continue;

        yield {
          key: key,
          value: value,
        };
      }
    }
  }

  /**
   * {@inheritDoc KvStore.cas}
   */
  async cas(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    while (true) {
      const entry = await this.#store.getWithMetadata(this.serializeKey(key), {
        consistency: "strong",
        type: "json",
      });

      const currentValue = entry === null || this.isAbsent(entry.metadata)
        ? undefined
        : entry.data;

      if (!isEqual(currentValue, expectedValue)) return false;

      if (entry === null && newValue === undefined) {
        return true;
      }

      const serializedKey = this.serializeKey(key);

      if (newValue === undefined) {
        const result = await this.#store.setJSON(serializedKey, null, {
          onlyIfMatch: this.getEtag(entry),
          metadata: { tombstone: true },
        });
        if (result.modified) return true;
        continue;
      }

      const metadata = {
        "expireIn": options?.ttl == null
          ? null
          : Temporal.Now.instant().epochMilliseconds +
            options.ttl.total("millisecond"),
      };

      const result = entry === null
        ? await this.#store.setJSON(serializedKey, newValue, {
          onlyIfNew: true,
          metadata: metadata,
        })
        : await this.#store.setJSON(serializedKey, newValue, {
          onlyIfMatch: this.getEtag(entry),
          metadata: metadata,
        });

      if (result.modified) return true;
    }
  }
}
