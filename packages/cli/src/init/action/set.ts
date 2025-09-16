import { pipe } from "@fxts/core";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, normalize } from "node:path";
import { merge, set } from "../../utils.ts";
import { kvStores, messageQueues } from "../lib.ts";
import type {
  InitCommandData,
  InitCommandOptions,
  KvStore,
  KvStoreDescription,
  MessageQueue,
  MessageQueueDescription,
  PackageManager,
} from "../types.ts";
import webFrameworks from "../webframeworks.ts";

const setData = (data: InitCommandOptions): Promise<InitCommandData> =>
  pipe(
    data,
    setProjectName,
    setInitializer,
    setKv,
    setMq,
    setEnv,
  );

export default setData;

const setProjectName = set(
  "projectName",
  async <
    T extends { dir: string },
  >({ dir }: T) =>
    basename(existsSync(dir) ? await realpath(dir) : normalize(dir)),
);

const setInitializer = set("initializer", <
  T extends {
    webFramework: keyof typeof webFrameworks;
    projectName: string;
    packageManager: PackageManager;
  },
>({
  webFramework,
  projectName,
  packageManager,
}: T) =>
  webFrameworks[webFramework].init(
    projectName,
    packageManager,
  ));

const setKv = set("kv", <
  T extends { kvStore: KvStore },
>({ kvStore }: T) => kvStores[kvStore]);

const setMq = set(
  "mq",
  <
    T extends { messageQueue: MessageQueue },
  >({ messageQueue }: T) => messageQueues[messageQueue],
);
const setEnv = set(
  "env",
  <
    T extends { kv: KvStoreDescription; mq: MessageQueueDescription },
  >({ kv, mq }: T) => merge(kv.env)(mq.env),
);
