import type { DocumentLoader } from "../runtime/docloader.ts";
import type { KeyCache } from "../sig/key.ts";
import { CryptographicKey, Multikey } from "../vocab/vocab.ts";
import type { KvKey, KvStore } from "./kv.ts";

const NULL_KEY_CACHE_VALUE = { _fedify: "key-unavailable" };
const NULL_KEY_CACHE_TTL = Temporal.Duration.from({ minutes: 5 });

export interface KvKeyCacheOptions {
  documentLoader?: DocumentLoader;
  contextLoader?: DocumentLoader;
}

function isNullKeyCacheValue(
  value: unknown,
): value is typeof NULL_KEY_CACHE_VALUE {
  return typeof value === "object" && value != null &&
    "_fedify" in value &&
    value._fedify === NULL_KEY_CACHE_VALUE._fedify;
}

export class KvKeyCache implements KeyCache {
  readonly kv: KvStore;
  readonly prefix: KvKey;
  readonly options: KvKeyCacheOptions;
  readonly nullKeys: Set<string>;

  constructor(kv: KvStore, prefix: KvKey, options: KvKeyCacheOptions = {}) {
    this.kv = kv;
    this.prefix = prefix;
    this.nullKeys = new Set();
    this.options = options;
  }

  async get(
    keyId: URL,
  ): Promise<CryptographicKey | Multikey | null | undefined> {
    if (this.nullKeys.has(keyId.href)) return null;
    const serialized = await this.kv.get([...this.prefix, keyId.href]);
    if (serialized == null) return undefined;
    if (isNullKeyCacheValue(serialized)) {
      this.nullKeys.add(keyId.href);
      return null;
    }
    try {
      return await CryptographicKey.fromJsonLd(serialized, this.options);
    } catch {
      try {
        return await Multikey.fromJsonLd(serialized, this.options);
      } catch {
        await this.kv.delete([...this.prefix, keyId.href]);
        return undefined;
      }
    }
  }

  async set(
    keyId: URL,
    key: CryptographicKey | Multikey | null,
  ): Promise<void> {
    if (key == null) {
      this.nullKeys.add(keyId.href);
      await this.kv.set(
        [...this.prefix, keyId.href],
        NULL_KEY_CACHE_VALUE,
        { ttl: NULL_KEY_CACHE_TTL },
      );
      return;
    }
    this.nullKeys.delete(keyId.href);
    const serialized = await key.toJsonLd(this.options);
    await this.kv.set([...this.prefix, keyId.href], serialized);
  }
}
