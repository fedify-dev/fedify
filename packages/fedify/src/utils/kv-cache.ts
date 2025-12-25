import type {
  DocumentLoader,
  DocumentLoaderOptions,
  RemoteDocument,
} from "@fedify/vocab-runtime";
import { preloadedContexts } from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreSetOptions,
} from "../federation/kv.ts";

const logger = getLogger(["fedify", "utils", "kv-cache"]);

/**
 * A mock implementation of a key–value store for testing purposes.
 */
export class MockKvStore implements KvStore {
  #values: Record<string, unknown> = {};
  get<T = unknown>(key: KvKey): Promise<T | undefined> {
    return Promise.resolve(this.#values[JSON.stringify(key)] as T | undefined);
  }
  set(
    key: KvKey,
    value: unknown,
    _options?: KvStoreSetOptions,
  ): Promise<void> {
    this.#values[JSON.stringify(key)] = value;
    return Promise.resolve();
  }
  async delete(_: KvKey): Promise<void> {}
  cas(
    ..._: [KvKey, unknown, unknown]
  ): Promise<boolean> {
    return Promise.resolve(false);
  }
  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    for (const [encodedKey, value] of Object.entries(this.#values)) {
      const key = JSON.parse(encodedKey) as KvKey;
      if (prefix != null) {
        if (key.length < prefix.length) continue;
        if (!prefix.every((p, i) => key[i] === p)) continue;
      }
      yield { key, value };
    }
  }
}

/**
 * The parameters for {@link kvCache} function.
 */
export interface KvCacheParameters {
  /**
   * The document loader to decorate with a cache.
   */
  loader: DocumentLoader;

  /**
   * The key–value store to use for backing the cache.
   */
  kv: KvStore;

  /**
   * The key prefix to use for namespacing the cache.
   * `["_fedify", "remoteDocument"]` by default.
   */
  prefix?: KvKey;

  /**
   * The per-URL cache rules in the array of `[urlPattern, duration]` pairs
   * where `urlPattern` is either a string, a {@link URL}, or
   * a {@link URLPattern} and `duration` is a {@link Temporal.DurationLike}.
   * The `duration` is allowed to be at most 30 days.
   *
   * By default, 5 minutes for all URLs.
   */
  rules?: [
    string | URL | URLPattern,
    Temporal.Duration | Temporal.DurationLike,
  ][];
}

/**
 * Decorates a {@link DocumentLoader} with a cache backed by a {@link Deno.Kv}.
 * @param parameters The parameters for the cache.
 * @returns The decorated document loader which is cache-enabled.
 */
export function kvCache(
  { loader, kv, prefix, rules }: KvCacheParameters,
): DocumentLoader {
  const keyPrefix = prefix ?? ["_fedify", "remoteDocument"];
  rules ??= [
    [new URLPattern({}), Temporal.Duration.from({ minutes: 5 })],
  ];
  for (const [p, duration] of rules) {
    if (Temporal.Duration.compare(duration, { days: 30 }) > 0) {
      throw new TypeError(
        "The maximum cache duration is 30 days: " +
          (p instanceof URLPattern
            ? `${p.protocol}://${p.username}:${p.password}@${p.hostname}:${p.port}/${p.pathname}?${p.search}#${p.hash}`
            : p.toString()),
      );
    }
  }

  return async (
    url: string,
    options?: DocumentLoaderOptions,
  ): Promise<RemoteDocument> => {
    if (url in preloadedContexts) {
      logger.debug("Using preloaded context: {url}.", { url });
      return {
        contextUrl: null,
        document: preloadedContexts[url],
        documentUrl: url,
      };
    }
    const match = matchRule(url, rules);
    if (match == null) return await loader(url, options);
    const key: KvKey = [...keyPrefix, url];
    let cache: RemoteDocument | undefined = undefined;
    try {
      cache = await kv.get<RemoteDocument>(key);
    } catch (error) {
      if (error instanceof Error) {
        logger.warn(
          "Failed to get the document of {url} from the KV cache: {error}",
          { url, error },
        );
      }
    }
    if (cache == null) {
      const remoteDoc = await loader(url, options);
      try {
        await kv.set(key, remoteDoc, { ttl: match });
      } catch (error) {
        logger.warn(
          "Failed to save the document of {url} to the KV cache: {error}",
          { url, error },
        );
      }
      return remoteDoc;
    }
    return cache;
  };
}

function matchRule(
  url: string,
  rules: [
    string | URL | URLPattern,
    Temporal.Duration | Temporal.DurationLike,
  ][],
): Temporal.Duration | null {
  for (const [pattern, d] of rules!) {
    const duration = d instanceof Temporal.Duration
      ? d
      : Temporal.Duration.from(d);
    if (typeof pattern === "string") {
      if (url === pattern) return duration;
      continue;
    }
    if (pattern instanceof URL) {
      if (pattern.href == url) return duration;
      continue;
    }
    if (pattern.test(url)) return duration;
  }
  return null;
}
