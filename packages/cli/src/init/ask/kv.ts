import { select } from "@inquirer/prompts";
import { KV_STORE } from "../const.ts";
import { kvStores } from "../lib.ts";
import type { KvStore, PackageManager } from "../types.ts";

/**
 * Fills in the key-value store by prompting the user if not provided.
 * Ensures the selected KV store is compatible with the chosen package manager.
 *
 * @param options - Initialization options possibly containing a kvStore and packageManager
 * @returns A promise resolving to options with a guaranteed kvStore
 */
const fillKvStore: //
  <T extends { kvStore?: KvStore; packageManager: PackageManager }>(
    options: T,
  ) => Promise<T & { kvStore: KvStore }> = async (options) => //
  ({
    ...options,
    kvStore: options.kvStore ?? await askKvStore(options.packageManager),
  });

export default fillKvStore;

const askKvStore = (pm: PackageManager) =>
  select<KvStore>({
    message: "Choose the key-value store to use",
    choices: KV_STORE.map(choiceKvStore(pm)),
  });

const choiceKvStore = (pm: PackageManager) => (value: KvStore) => ({
  name: isKvSupportsPm(value, pm)
    ? value
    : `${value} (not supported with ${pm})`,
  value,
  disabled: !isKvSupportsPm(value, pm),
});

const isKvSupportsPm = (kv: KvStore, pm: PackageManager) =>
  kvStores[kv].packageManagers.includes(pm);
