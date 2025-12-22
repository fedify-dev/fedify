import { pipe, tap, throwError, unless, when } from "@fxts/core/index.js";
import { select } from "@inquirer/prompts";
import { printErrorMessage } from "../../utils.ts";
import { KV_STORE } from "../const.ts";
import { isTest, kvStores } from "../lib.ts";
import type { KvStore, PackageManager } from "../types.ts";

/**
 * Fills in the key-value store by prompting the user if not provided.
 * Ensures the selected KV store is compatible with the chosen package manager.
 *
 * @param options - Initialization options possibly containing a kvStore and packageManager
 * @returns A promise resolving to options with a guaranteed kvStore
 */
const fillKvStore: //
  <
    T extends {
      kvStore?: KvStore;
      packageManager: PackageManager;
      testMode: boolean;
    },
  >(options: T) => Promise<KvDefined<T>> //
 = (options) =>
  pipe(
    options,
    when(isKvStoreEmpty, askKvStore) as <
      T extends { kvStore?: KvStore; packageManager: PackageManager },
    >(options: T) => KvDefined<T>,
    unless(
      isKvSupportsPm,
      (opt: KvDefined<typeof options>) =>
        pipe(
          opt,
          when(isTest, throwError(unmatchedWhileTesting)),
          tap(noticeUnmatched),
          fillKvStore,
        ),
    ),
  ) as Promise<KvDefined<typeof options>>;

export default fillKvStore;

type KvDefined<T> = Omit<T, "kvStore"> & { kvStore: KvStore };

const isKvStoreEmpty = <T extends { kvStore?: KvStore }>(
  options: T,
): options is T & { kvStore: undefined } => !options.kvStore;

const askKvStore = async <
  T extends { packageManager: PackageManager },
>(data: T): Promise<Omit<T, "kvStore"> & { kvStore: KvStore }> => ({
  ...data,
  kvStore: await select<KvStore>({
    message: "Choose the key-value store to use",
    choices: KV_STORE.map(choiceKvStore(data.packageManager)),
  }),
});

const unmatchedWhileTesting = <
  T extends { kvStore: KvStore; packageManager: PackageManager },
>({ kvStore: kv, packageManager: pm }: T) =>
  new Error(
    `Key-value store '${kv}' is not compatible with package manager '${pm}'`,
  );

const noticeUnmatched = <
  T extends { kvStore: KvStore; packageManager: PackageManager },
>({ kvStore: kv, packageManager: pm }: T) =>
  printErrorMessage`Error: Key-value store '${kv}' is not compatible with package manager '${pm}'`;

const choiceKvStore = (pm: PackageManager) => (kv: KvStore) => ({
  name: isKvSupportsPm({ kvStore: kv, packageManager: pm })
    ? kv
    : `${kv} (not supported with ${pm})`,
  value: kv,
  disabled: !isKvSupportsPm({ kvStore: kv, packageManager: pm }),
});

const isKvSupportsPm = <
  T extends { kvStore: KvStore; packageManager: PackageManager },
>({ kvStore, packageManager }: T) =>
  kvStores[kvStore].packageManagers.includes(packageManager);
