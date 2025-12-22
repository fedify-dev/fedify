import { CryptographicKey, Multikey } from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { KeyCache } from "../sig/key.ts";
import type { KvKey, KvStore } from "./kv.ts";

export interface KvKeyCacheOptions {
  documentLoader?: DocumentLoader;
  contextLoader?: DocumentLoader;
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
      await this.kv.delete([...this.prefix, keyId.href]);
      return;
    }
    this.nullKeys.delete(keyId.href);
    const serialized = await key.toJsonLd(this.options);
    await this.kv.set([...this.prefix, keyId.href], serialized);
  }
}
