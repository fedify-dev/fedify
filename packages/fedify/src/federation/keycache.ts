import { CryptographicKey, Multikey } from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { TracerProvider } from "@opentelemetry/api";
import type {
  CompatibleKeyCache,
  CompatibleKeyCacheEntry,
  CompatibleKeyScope,
  FetchErrorMetadataCache,
  FetchKeyErrorResult,
} from "../sig/key.ts";
import { MAX_PORTABLE_KEY_TTL } from "../sig/key-owner-evidence.ts";
import type { KvKey, KvStore } from "./kv.ts";

// Cached keys carry the owner that was verified when they were fetched, so
// entries written by a version that did not verify ownership cannot be
// trusted—an attacker who probed a vulnerable instance left a forged key
// behind under their own key id.  Entries live under this segment so that
// upgrading retires the whole previous generation, whatever prefix the
// application configured.  See GHSA-q9f8-5hc7-898f.
const KEY_CACHE_GENERATION = "2";

// Keys at FEP-ef61 compatible identifiers are cached apart for each purpose,
// under this segment; see KvKeyCache.compatibleKeyScope().
const COMPATIBLE_KEY_SEGMENT = "__compatible";

// The actor document stored along with a key is as large as its remote
// actor makes it, and some stores, e.g., Deno KV, refuse values larger than
// 64 KiB.  A larger document is not stored, which only costs the key its
// owner, i.e., the owner is fetched again when it is asked for:
const MAX_OWNER_BYTES = 32 * 1024;

interface CompatibleKeyEntry {
  readonly key: unknown;
  readonly expires: number;
  // The expanded root node of the verified document of the portable actor
  // that owns the key, if any:
  readonly owner?: unknown;
}

function isCompatibleKeyEntry(value: unknown): value is CompatibleKeyEntry {
  return value != null && typeof value === "object" && "key" in value &&
    "expires" in value && typeof value.expires === "number";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export interface KvKeyCacheOptions {
  documentLoader?: DocumentLoader;
  contextLoader?: DocumentLoader;
  tracerProvider?: TracerProvider;
  unavailableKeyTtl?: Temporal.Duration;

  /**
   * The TTL for successfully cached keys.  `30` days by default.
   *
   * Entries written by Fedify versions older than 2.4.0 have no TTL and
   * are left untouched by this option; see the *Clearing legacy cache
   * entries* section of the key–value store guide if you want to expire
   * them proactively.
   * @default `Temporal.Duration.from({ days: 30 })`
   * @since 2.4.0
   */
  keyTtl?: Temporal.Duration;

  /**
   * The clock that decides when entries of keys at compatible identifiers
   * expire.  Only for testing.
   * @internal
   */
  now?: () => Temporal.Instant;
}

export class KvKeyCache implements FetchErrorMetadataCache {
  readonly kv: KvStore;
  readonly prefix: KvKey;
  readonly options: KvKeyCacheOptions;
  readonly unavailableKeyTtl: Temporal.Duration;
  readonly keyTtl: Temporal.Duration;
  readonly nullKeys: Map<string, Temporal.Instant>;

  constructor(kv: KvStore, prefix: KvKey, options: KvKeyCacheOptions = {}) {
    this.kv = kv;
    this.prefix = prefix;
    this.options = options;
    this.unavailableKeyTtl = options.unavailableKeyTtl ??
      Temporal.Duration.from({ minutes: 10 });
    this.keyTtl = options.keyTtl ?? Temporal.Duration.from({ days: 30 });
    this.nullKeys = new Map();
  }

  #getFetchErrorKey(keyId: URL): KvKey {
    return [...this.prefix, "__fetchError", keyId.href];
  }

  #entryKey(keyId: URL): KvKey {
    return [...this.prefix, KEY_CACHE_GENERATION, keyId.href];
  }

  async get(
    keyId: URL,
  ): Promise<CryptographicKey | Multikey | null | undefined> {
    const negativeExpiration = this.nullKeys.get(keyId.href);
    if (negativeExpiration != null) {
      if (Temporal.Now.instant().until(negativeExpiration).sign >= 0) {
        return null;
      }
      this.nullKeys.delete(keyId.href);
    }
    const serialized = await this.kv.get(this.#entryKey(keyId));
    if (serialized === undefined) return undefined;
    if (serialized === null) {
      this.nullKeys.set(
        keyId.href,
        Temporal.Now.instant().add(this.unavailableKeyTtl),
      );
      return null;
    }
    try {
      return await CryptographicKey.fromJsonLd(serialized, this.options);
    } catch {
      try {
        return await Multikey.fromJsonLd(serialized, this.options);
      } catch {
        await this.kv.delete(this.#entryKey(keyId));
        return undefined;
      }
    }
  }

  async set(
    keyId: URL,
    key: CryptographicKey | Multikey | null,
  ): Promise<void> {
    if (key == null) {
      this.nullKeys.set(
        keyId.href,
        Temporal.Now.instant().add(this.unavailableKeyTtl),
      );
      await this.kv.set(this.#entryKey(keyId), null, {
        ttl: this.unavailableKeyTtl,
      });
      return;
    }
    this.nullKeys.delete(keyId.href);
    const serialized = await key.toJsonLd(this.options);
    await this.kv.set(this.#entryKey(keyId), serialized, {
      ttl: this.keyTtl,
    });
  }

  /**
   * Returns the namespace of keys at FEP-ef61 compatible identifiers looked
   * up for the given purpose.  Its entries carry the time they expire, which
   * is checked when they are read, so that an entry is never used after
   * the proof that vouched for its key expired, however late the underlying
   * store evicts it.
   * @param scope The purpose of the lookups.
   * @returns The namespace.
   * @internal
   */
  compatibleKeyScope(scope: CompatibleKeyScope): Required<CompatibleKeyCache> {
    const now = this.options.now ?? (() => Temporal.Now.instant());
    const entryKey = (keyId: URL): KvKey => [
      ...this.prefix,
      COMPATIBLE_KEY_SEGMENT,
      scope,
      keyId.href,
    ];
    const isExpired = (entry: CompatibleKeyEntry): boolean =>
      entry.expires <= now().epochMilliseconds;
    // A key at a compatible identifier may be a gateway key, which the
    // portable actor's signed document vouches for.  The actor can drop
    // the gateway or the key from its document at any time, so the key is
    // looked up again at least this often, however long other keys are
    // cached:
    const keyTtl = Math.min(
      this.keyTtl.total("millisecond"),
      MAX_PORTABLE_KEY_TTL.total("millisecond"),
    );
    const unavailableKeyTtl = this.unavailableKeyTtl.total("millisecond");
    const getEntry = async (
      keyId: URL,
    ): Promise<CompatibleKeyCacheEntry | null | undefined> => {
      const entry = await this.kv.get(entryKey(keyId));
      if (entry === undefined) return undefined;
      if (!isCompatibleKeyEntry(entry) || isExpired(entry)) {
        await this.kv.delete(entryKey(keyId));
        return undefined;
      }
      if (entry.key === null) return null;
      let expires: Temporal.Instant;
      try {
        expires = Temporal.Instant.fromEpochMilliseconds(entry.expires);
      } catch (error) {
        // E.g., NaN or a time Temporal cannot represent:
        if (!(error instanceof RangeError)) throw error;
        await this.kv.delete(entryKey(keyId));
        return undefined;
      }
      let key: CryptographicKey | Multikey;
      try {
        key = await CryptographicKey.fromJsonLd(entry.key, this.options);
      } catch {
        try {
          key = await Multikey.fromJsonLd(entry.key, this.options);
        } catch {
          await this.kv.delete(entryKey(keyId));
          return undefined;
        }
      }
      // Parsing the key may have taken long enough for it to expire:
      if (isExpired(entry)) return undefined;
      return {
        key,
        // A malformed owner only costs the key its owner, not the key itself:
        ...(isJsonObject(entry.owner) ? { owner: entry.owner } : {}),
        expires,
      };
    };
    return {
      get: async (keyId) => {
        const entry = await getEntry(keyId);
        return entry == null ? entry : entry.key;
      },
      getEntry,
      set: async (keyId, key, options) => {
        const serialized = key == null
          ? null
          : await key.toJsonLd(this.options);
        const current = now();
        let expires = current.epochMilliseconds +
          (key == null ? unavailableKeyTtl : keyTtl);
        if (options?.expires != null) {
          expires = Math.min(expires, options.expires.epochMilliseconds);
        }
        const ttl = expires - current.epochMilliseconds;
        if (ttl <= 0) {
          // Whatever was cached before is not valid any longer either:
          await this.kv.delete(entryKey(keyId));
          return undefined;
        }
        const owner = key == null || options?.owner == null ||
            new TextEncoder().encode(JSON.stringify(options.owner)).length >
              MAX_OWNER_BYTES
          ? undefined
          : options.owner;
        await this.kv.set(
          entryKey(keyId),
          {
            key: serialized,
            expires,
            ...(owner == null ? {} : { owner }),
          } satisfies CompatibleKeyEntry,
          { ttl: Temporal.Duration.from({ milliseconds: ttl }) },
        );
        return key == null
          ? undefined
          : Temporal.Instant.fromEpochMilliseconds(expires);
      },
      delete: async (keyId) => {
        await this.kv.delete(entryKey(keyId));
      },
    };
  }

  async getFetchError(keyId: URL): Promise<FetchKeyErrorResult | undefined> {
    const cached = await this.kv.get(this.#getFetchErrorKey(keyId));
    if (cached == null || typeof cached !== "object") return undefined;
    if (
      "status" in cached && typeof cached.status === "number" &&
      "statusText" in cached && typeof cached.statusText === "string" &&
      "headers" in cached && Array.isArray(cached.headers) &&
      "body" in cached && typeof cached.body === "string"
    ) {
      return {
        status: cached.status,
        response: new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers: cached.headers,
        }),
      };
    } else if (
      "errorName" in cached && typeof cached.errorName === "string" &&
      "errorMessage" in cached && typeof cached.errorMessage === "string"
    ) {
      const error = new Error(cached.errorMessage);
      error.name = cached.errorName;
      return { error };
    }
    return undefined;
  }

  async setFetchError(
    keyId: URL,
    error: FetchKeyErrorResult | null,
  ): Promise<void> {
    if (error == null) {
      await this.kv.delete(this.#getFetchErrorKey(keyId));
      return;
    }
    if ("status" in error) {
      await this.kv.set(
        this.#getFetchErrorKey(keyId),
        {
          status: error.status,
          statusText: error.response.statusText,
          headers: Array.from(error.response.headers.entries()),
          body: await error.response.clone().text(),
        },
        { ttl: this.unavailableKeyTtl },
      );
      return;
    }
    await this.kv.set(
      this.#getFetchErrorKey(keyId),
      {
        errorName: error.error.name,
        errorMessage: error.error.message,
      },
      { ttl: this.unavailableKeyTtl },
    );
  }
}
