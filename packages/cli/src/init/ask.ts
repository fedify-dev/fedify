import type {
  KvStore,
  MessageQueue,
  PackageManager,
  WebFramework,
} from "./types.ts";
import type { InitCommand } from "./command.ts";
import {
  KV_STORE,
  MESSAGE_QUEUE,
  PACKAGE_MANAGER,
  WEB_FRAMEWORK,
} from "./const.ts";

const askPackageManager: //
  (p: PackageManager | undefined) => PackageManager = //
  (p) => p ?? PACKAGE_MANAGER[0];
const askWebFramework: //
  (w: WebFramework | undefined) => WebFramework = //
  (w) => w ?? WEB_FRAMEWORK[0];
const askMessageQueue: //
  (m: MessageQueue | undefined) => MessageQueue = //
  (m) => m ?? MESSAGE_QUEUE[0];
const askKvStore: (k: KvStore | undefined) => KvStore = //
  (k) => k ?? KV_STORE[0];
const askDir: (d: string | undefined) => string = (d) => d ?? ".";
const askOptions: (options: InitCommand) => Required<InitCommand> = (
  options,
) => ({
  ...options,
  dir: askDir(options.dir),
  packageManager: askPackageManager(options.packageManager),
  webFramework: askWebFramework(options.webFramework),
  messageQueue: askMessageQueue(options.messageQueue),
  kvStore: askKvStore(options.kvStore),
});

export default askOptions;
