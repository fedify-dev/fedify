import type { Message } from "@optique/core";
import type { InitCommand } from "./command.ts";
import type {
  KV_STORE,
  MESSAGE_QUEUE,
  PACKAGE_MANAGER,
  WEB_FRAMEWORK,
} from "./const.ts";
import type { RequiredNotNull } from "./utils.ts";

/** Supported package manager identifiers: `"deno"`, `"pnpm"`, `"bun"`, `"yarn"`, `"npm"`. */
export type PackageManager = typeof PACKAGE_MANAGER[number];

/** Supported web framework identifiers: `"hono"`, `"nitro"`, `"next"`, `"elysia"`, `"express"`. */
export type WebFramework = typeof WEB_FRAMEWORK[number];

/** Supported message queue identifiers: `"denokv"`, `"redis"`, `"postgres"`, `"amqp"`. */
export type MessageQueue = typeof MESSAGE_QUEUE[number];

/** Supported key-value store identifiers: `"denokv"`, `"redis"`, `"postgres"`. */
export type KvStore = typeof KV_STORE[number];

/** A mapping from each {@link MessageQueue} identifier to its description. */
export type MessageQueues = Record<MessageQueue, MessageQueueDescription>;

/** A mapping from each {@link KvStore} identifier to its description. */
export type KvStores = Record<KvStore, KvStoreDescription>;

/** A mapping from each {@link WebFramework} identifier to its description. */
export type WebFrameworks = Record<WebFramework, WebFrameworkDescription>;

/** A mapping from each {@link PackageManager} identifier to its description. */
export type PackageManagers = Record<PackageManager, PackageManagerDescription>;

/** A mapping from each {@link PackageManager} identifier to its runtime description. */
export type Runtimes = Record<PackageManager, RuntimeDescription>;

/**
 * Describes a JavaScript runtime (Deno, Node.js, or Bun) and how to check
 * whether it is installed.
 */
export interface RuntimeDescription {
  /** Human-readable name of the runtime (e.g., `"Deno"`, `"Node.js"`). */
  label: string;
  /** Shell command to run for checking availability (e.g., `["deno", "--version"]`). */
  checkCommand: [string, ...string[]];
  /** Regex to match against the command's stdout to confirm the runtime is installed. */
  outputPattern: RegExp;
}

/**
 * Describes a package manager (deno, pnpm, bun, yarn, npm) and how to check
 * whether it is installed.
 */
export interface PackageManagerDescription {
  /** Human-readable name of the package manager. */
  label: string;
  /** Shell command to run for checking availability. */
  checkCommand: [string, ...string[]];
  /** Regex to match against the command's stdout to confirm it is installed. */
  outputPattern: RegExp;
  /** URL where the user can install this package manager. */
  installUrl: string;
}

/**
 * The result returned by a web framework's `init()` function.
 * Contains all the information needed to scaffold a project for that framework,
 * including dependencies, template files, compiler options, and task scripts.
 */
export interface WebFrameworkInitializer {
  /** Optional shell command to run before scaffolding (e.g., `create-next-app`). */
  command?: string[];
  /** Runtime dependencies to install (package name to version). */
  dependencies?: object;
  /** Development-only dependencies to install (package name to version). */
  devDependencies?: object;
  /** Relative path where the federation configuration file will be created. */
  federationFile: string;
  /** Relative path where the logging configuration file will be created. */
  loggingFile: string;
  /** Additional files to create, keyed by relative path to file content. */
  files?: Record<string, string>;
  /** TypeScript compiler options to include in `tsconfig.json`. */
  compilerOptions?: Record<string, string | boolean | number | string[] | null>;
  /** Task scripts keyed by task name (e.g., `"dev"`, `"prod"`, `"lint"`). */
  tasks?: Record<string, string>;
  /** Instructions shown to the user after project initialization is complete. */
  instruction: Message;
}

/**
 * Describes a web framework integration (Hono, Express, Nitro, Next.js,
 * ElysiaJS) and how to initialize a project with it.
 */
export interface WebFrameworkDescription {
  /** Human-readable name of the framework (e.g., `"Hono"`, `"Next.js"`). */
  label: string;
  /** Package managers that this framework supports. */
  packageManagers: readonly PackageManager[];
  /** Default port for the development server. */
  defaultPort: number;
  /**
   * Factory function that returns the initializer configuration for this
   * framework, given the user's selected options.
   */
  init(
    data: InitCommandOptions & { projectName: string; testMode: boolean },
  ): WebFrameworkInitializer;
}

/**
 * Describes a message queue backend (Deno KV, Redis, PostgreSQL, AMQP) and
 * the dependencies, imports, and environment variables it requires.
 */
export interface MessageQueueDescription {
  /** Human-readable name of the message queue backend. */
  label: string;
  /** Package managers that this message queue supports. */
  packageManagers: readonly PackageManager[];
  /** Runtime dependencies required by this message queue. */
  dependencies?: Record<string, string>;
  /** Development-only dependencies required by this message queue. */
  devDependencies?: Record<string, string>;
  /** ES module imports needed, keyed by module specifier to named exports. */
  imports: Record<string, Record<string, string>>;
  /** TypeScript expression that creates the message queue instance. */
  object: string;
  /** Deno unstable feature flags required (e.g., `["kv"]`). */
  denoUnstable?: string[];
  /** Environment variables required, keyed by name to default value. */
  env?: Record<string, string>;
}

/**
 * Describes a key-value store backend (Deno KV, Redis, PostgreSQL) and
 * the dependencies, imports, and environment variables it requires.
 */
export interface KvStoreDescription {
  /** Human-readable name of the key-value store backend. */
  label: string;
  /** Package managers that this KV store supports. */
  packageManagers: readonly PackageManager[];
  /** Runtime dependencies required by this KV store. */
  dependencies?: Record<string, string>;
  /** Development-only dependencies required by this KV store. */
  devDependencies?: Record<string, string>;
  /** ES module imports needed, keyed by module specifier to named exports. */
  imports: Record<string, Record<string, string>>;
  /** TypeScript expression that creates the KV store instance. */
  object: string;
  /** Deno unstable feature flags required (e.g., `["kv"]`). */
  denoUnstable?: string[];
  /** Environment variables required, keyed by name to default value. */
  env?: Record<string, string>;
}

/**
 * Fully resolved initialization options with all fields guaranteed non-null.
 * Created after the user has answered all interactive prompts.
 */
export type InitCommandOptions = RequiredNotNull<InitCommand> & {
  readonly testMode: boolean;
};

/**
 * The complete data object used throughout the initialization process.
 * Extends {@link InitCommandOptions} with derived fields such as the project
 * name, framework initializer, KV/MQ descriptions, and environment variables.
 */
export interface InitCommandData extends InitCommandOptions {
  /** The project name, derived from the target directory's basename. */
  readonly projectName: string;
  /** The resolved initializer configuration from the chosen web framework. */
  readonly initializer: WebFrameworkInitializer;
  /** The resolved key-value store description. */
  readonly kv: KvStoreDescription;
  /** The resolved message queue description. */
  readonly mq: MessageQueueDescription;
  /** Combined environment variables from both KV store and message queue. */
  readonly env: Record<string, string>;
}

/** A synchronous side-effect function that operates on {@link InitCommandData}. */
export type InitCommandIo = (data: InitCommandData) => void;

/** An asynchronous side-effect function that operates on {@link InitCommandData}. */
export type InitCommandAsyncIo = (data: InitCommandData) => Promise<void>;
