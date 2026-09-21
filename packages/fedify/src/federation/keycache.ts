import { CryptographicKey, Multikey } from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { TracerProvider } from "@opentelemetry/api";
import type { FetchKeyErrorResult, KeyCache } from "../sig/key.ts";
import type { KvKey, KvStore } from "./kv.ts";

// Cached keys carry the owner that was verified when they were fetched, so
// entries written by a version that did not verify ownership cannot be
// trusted—an attacker who probed a vulnerable instance left a forged key
// behind under their own key id.  Entries live under this segment so that
// upgrading retires the whole previous generation, whatever prefix the
// application configured.  See GHSA-q9f8-5hc7-898f.
const KEY_CACHE_GENERATION = "2";

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
}

export class KvKeyCache implements KeyCache {
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
