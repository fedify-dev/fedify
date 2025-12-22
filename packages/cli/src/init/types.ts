import type { Message } from "@optique/core";
import type { RequiredNotNull } from "../utils.ts";
import type { InitCommand } from "./command.ts";
import type {
  KV_STORE,
  MESSAGE_QUEUE,
  PACKAGE_MANAGER,
  WEB_FRAMEWORK,
} from "./const.ts";

export type PackageManager = typeof PACKAGE_MANAGER[number];
export type WebFramework = typeof WEB_FRAMEWORK[number];
export type MessageQueue = typeof MESSAGE_QUEUE[number];
export type KvStore = typeof KV_STORE[number];

export type MessageQueues = Record<MessageQueue, MessageQueueDescription>;
export type KvStores = Record<KvStore, KvStoreDescription>;
export type WebFrameworks = Record<WebFramework, WebFrameworkDescription>;
export type PackageManagers = Record<PackageManager, PackageManagerDescription>;
export type Runtimes = Record<PackageManager, RuntimeDescription>;

export interface RuntimeDescription {
  label: string;
  checkCommand: [string, ...string[]];
  outputPattern: RegExp;
}

export interface PackageManagerDescription {
  label: string;
  checkCommand: [string, ...string[]];
  outputPattern: RegExp;
  installUrl: string;
}

export interface WebFrameworkInitializer {
  command?: string[];
  dependencies?: object;
  devDependencies?: object;
  federationFile: string;
  loggingFile: string;
  files?: Record<string, string>;
  compilerOptions?: Record<string, string | boolean | number | string[] | null>;
  tasks?: Record<string, string>;
  instruction: Message;
}

export interface WebFrameworkDescription {
  label: string;
  packageManagers: readonly PackageManager[];
  defaultPort: number;
  init(
    data: InitCommandOptions & { projectName: string; testMode: boolean },
  ): WebFrameworkInitializer;
}

export interface MessageQueueDescription {
  label: string;
  packageManagers: readonly PackageManager[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  imports: Record<string, Record<string, string>>;
  object: string;
  denoUnstable?: string[];
  env?: Record<string, string>;
}

export interface KvStoreDescription {
  label: string;
  packageManagers: readonly PackageManager[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  imports: Record<string, Record<string, string>>;
  object: string;
  denoUnstable?: string[];
  env?: Record<string, string>;
}

export type InitCommandOptions = RequiredNotNull<InitCommand> & {
  readonly testMode: boolean;
};

export interface InitCommandData extends InitCommandOptions {
  readonly projectName: string;
  readonly initializer: WebFrameworkInitializer;
  readonly kv: KvStoreDescription;
  readonly mq: MessageQueueDescription;
  readonly env: Record<string, string>;
}

export type InitCommandIo = (data: InitCommandData) => void;
export type InitCommandAsyncIo = (data: InitCommandData) => Promise<void>;
