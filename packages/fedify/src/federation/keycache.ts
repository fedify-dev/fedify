import { CryptographicKey, Multikey } from "@fedify/vocab";
import {
  type DocumentLoader,
  FetchError,
  UrlError,
} from "@fedify/vocab-runtime";
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
  unavailableKeyTtl?: Temporal.Duration;
}

export class KvKeyCache implements KeyCache {
  readonly kv: KvStore;
  readonly prefix: KvKey;
  readonly options: KvKeyCacheOptions;
  readonly unavailableKeyTtl: Temporal.Duration;
  readonly nullKeys: Map<string, Temporal.Instant>;

  constructor(kv: KvStore, prefix: KvKey, options: KvKeyCacheOptions = {}) {
    this.kv = kv;
    this.prefix = prefix;
    this.options = options;
    this.unavailableKeyTtl = options.unavailableKeyTtl ??
      Temporal.Duration.from({ minutes: 10 });
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
    await this.kv.set(this.#entryKey(keyId), serialized);
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
      let error: Error;
      if (
        "errorType" in cached && cached.errorType === "FetchError" &&
        "errorUrl" in cached && typeof cached.errorUrl === "string" &&
        URL.canParse(cached.errorUrl)
      ) {
        error = new FetchError(cached.errorUrl);
        // FetchError prefixes its constructor message with the URL.  The
        // stored message already includes it, so restore it verbatim.
        error.message = cached.errorMessage;
      } else if (
        "errorType" in cached && cached.errorType === "UrlError" &&
        "errorReason" in cached &&
        (cached.errorReason === "dns" || cached.errorReason === "disallowed")
      ) {
        error = new UrlError(cached.errorMessage, {
          reason: cached.errorReason,
        });
      } else {
        // Older entries and unknown error classes keep their generic shape.
        error = new Error(cached.errorMessage);
      }
      error.name = cached.errorName;
      if (
        "errorCause" in cached && cached.errorCause != null &&
        typeof cached.errorCause === "object" &&
        "name" in cached.errorCause &&
        typeof cached.errorCause.name === "string" &&
        "message" in cached.errorCause &&
        typeof cached.errorCause.message === "string"
      ) {
        if (
          "isDomException" in cached.errorCause &&
          cached.errorCause.isDomException === true
        ) {
          error.cause = new DOMException(
            cached.errorCause.message,
            cached.errorCause.name,
          );
        } else {
          error.cause = Object.assign(new Error(cached.errorCause.message), {
            name: cached.errorCause.name,
          });
        }
      }
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
    const cause = error.error.cause;
    await this.kv.set(
      this.#getFetchErrorKey(keyId),
      {
        errorName: error.error.name,
        errorMessage: error.error.message,
        ...(error.error instanceof FetchError
          ? { errorType: "FetchError", errorUrl: error.error.url.href }
          : error.error instanceof UrlError
          ? { errorType: "UrlError", errorReason: error.error.reason }
          : {}),
        ...(cause instanceof Error || cause instanceof DOMException
          ? {
            errorCause: {
              name: cause.name,
              message: cause.message,
              isDomException: cause instanceof DOMException,
            },
          }
          : {}),
      },
      { ttl: this.unavailableKeyTtl },
    );
  }
}
