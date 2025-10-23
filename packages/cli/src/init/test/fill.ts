import { isEmpty, pipe } from "@fxts/core";
import type { TestInitCommand } from "../command.ts";
import {
  KV_STORE,
  MESSAGE_QUEUE,
  PACKAGE_MANAGER,
  WEB_FRAMEWORK,
} from "../const.ts";
import type {
  DefineAllOptions,
  DefineOption,
  MultipleOption,
} from "./types.ts";

export const fillEmptyOptions = <T extends TestInitCommand>(
  options: T,
): DefineAllOptions<T> =>
  pipe(
    options,
    fillWebFramework,
    fillPackageManager,
    fillKVStore,
    fillMessageQueue,
    fillRunMode,
  ) as DefineAllOptions<T>;

const fillOption = <
  K extends MultipleOption,
  AllValues = TestInitCommand[K] extends readonly (infer U)[] ? (U & string)[]
    : never,
>(
  key: K,
  allValues: AllValues,
) =>
<T extends TestInitCommand>(
  options: T,
): T extends Awaited<DefineOption<T, infer J>> | DefineOption<T, infer J>
  ? DefineOption<T, J | K>
  : DefineOption<T, K> =>
  ({
    ...options,
    [key]: (isEmpty(options[key])
      ? allValues
      : (options[key].filter((i) =>
        (allValues as readonly unknown[]).includes(i)
      ) as T[K])),
  }) as T extends Awaited<DefineOption<T, infer J>> | DefineOption<T, infer J>
    ? DefineOption<T, J | K>
    : DefineOption<T, K>;

const fillWebFramework = fillOption("webFramework", WEB_FRAMEWORK);
const fillPackageManager = fillOption("packageManager", PACKAGE_MANAGER);
const fillKVStore = fillOption("kvStore", KV_STORE);
const fillMessageQueue = fillOption("messageQueue", MESSAGE_QUEUE);

const fillRunMode = <T extends TestInitCommand>(
  options: DefineAllOptions<T>,
): DefineAllOptions<T> => ({
  ...options,
  ...(options.hydRun || options.dryRun ? {} : { hydRun: true, dryRun: true }),
});
