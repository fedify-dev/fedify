import type {
  KV_STORE,
  MESSAGE_QUEUE,
  PACKAGE_MANAGER,
  RUNTIME,
  WEB_FRAMEWORK,
} from "./const.ts";
export type Runtime = typeof RUNTIME[number];
export type PackageManager = typeof PACKAGE_MANAGER[number];
export type WebFramework = typeof WEB_FRAMEWORK[number];
export type MessageQueue = typeof MESSAGE_QUEUE[number];
export type KvStore = typeof KV_STORE[number];

export type Runtimes = Record<Runtime, RuntimeDescription>;
export type MessageQueues = Record<MessageQueue, MessageQueueDescription>;
export type KvStores = Record<KvStore, KvStoreDescription>;
export type WebFrameworks = Record<WebFramework, WebFrameworkDescription>;

export interface RuntimeDescription {
  label: string;
  checkCommand: [string, ...string[]];
  outputPattern: RegExp;
}

export interface PackageManagerDescription {
  label: string;
  checkCommand: [string, ...string[]];
  outputPattern: RegExp;
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
  instruction: string;
}

export interface WebFrameworkDescription {
  label: string;
  runtimes: readonly Runtime[];
  init(
    projectName: string,
    runtime: Runtime,
    pm: PackageManager,
  ): WebFrameworkInitializer;
}

export interface MessageQueueDescription {
  label: string;
  runtimes: readonly Runtime[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  imports: Record<string, Record<string, string>>;
  object: Partial<Record<Runtime, string>>;
  denoUnstable?: string[];
  env?: Record<string, string>;
}

export interface KvStoreDescription {
  label: string;
  runtimes: readonly Runtime[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  imports: Record<string, Record<string, string>>;
  object: Partial<Record<Runtime, string>>;
  denoUnstable?: string[];
  env?: Record<string, string>;
}
