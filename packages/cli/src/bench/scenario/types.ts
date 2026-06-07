/**
 * Hand-written TypeScript types for the benchmark scenario suite format.
 *
 * These mirror the published JSON Schema in {@link ./schema.ts} and
 * *schema/bench/scenario-v1.json*.  Runtime validation is done with
 * `@cfworker/json-schema`; after a value validates, it is narrowed to
 * {@link Suite} with an `as unknown as` cast (see {@link ./validate.ts}).
 * @since 2.3.0
 * @module
 */

import type { GenerateDirective } from "../template/generate.ts";

/** A signature standard an actor can use. */
export type SignatureStandard =
  | "draft-cavage-http-signatures-12"
  | "rfc9421"
  | "ld-signatures"
  | "fep8b32";

/** The HTTP request signature standards (mutually exclusive within a group). */
export const HTTP_SIGNATURE_STANDARDS: readonly SignatureStandard[] = [
  "draft-cavage-http-signatures-12",
  "rfc9421",
];

/** A scenario type.  Only `inbox` and `webfinger` have runners so far. */
export type ScenarioType =
  | "inbox"
  | "webfinger"
  | "actor"
  | "object"
  | "fanout"
  | "collection"
  | "failure"
  | "mixed";

/** The lookahead signing strategy. */
export type SigningMode = "jit" | "pipeline" | "presign";

/** The arrival distribution for open-loop load. */
export type ArrivalDistribution = "constant" | "poisson";

/** The severity of an `expect` assertion. */
export type ExpectSeverity = "warn" | "fail";

/** A value that may be a single item or a list of items. */
export type ScalarOrList<T> = T | T[];

/** A load configuration (open-loop `rate` XOR closed-loop `concurrency`). */
export interface LoadConfig {
  readonly rate?: string | number;
  readonly concurrency?: number;
  readonly arrival?: ArrivalDistribution;
  readonly maxInFlight?: number;
}

/** Suite-wide defaults applied to every scenario unless overridden. */
export interface SuiteDefaults {
  readonly duration?: string;
  readonly warmup?: string;
  readonly load?: LoadConfig;
  readonly signing?: SigningMode;
  readonly signatureTimeWindow?: boolean;
  readonly runs?: number;
}

/** A group of synthetic actors sharing a set of signature standards. */
export interface ActorGroup {
  readonly name?: string;
  readonly count?: number;
  readonly signatureStandards: SignatureStandard[];
}

/** An `expect` assertion: a string, or an object with a severity. */
export type ExpectValue =
  | string
  | { readonly assert: string; readonly severity?: ExpectSeverity };

/** A block of `expect` assertions keyed by metric name. */
export type ExpectBlock = Record<string, ExpectValue>;

/** A generated or literal object body. */
export interface ObjectSpec {
  readonly type?: ScalarOrList<string>;
  readonly content?: string | GenerateDirective;
  readonly [key: string]: unknown;
}

/** The activity to deliver in an `inbox` scenario. */
export interface ActivitySpec {
  readonly type?: ScalarOrList<string>;
  readonly embedObject?: boolean;
  readonly object?: ObjectSpec;
}

/** The source of object URLs for an `object` scenario. */
export type ObjectSource =
  | ScalarOrList<string>
  | {
    readonly seed: ScalarOrList<string>;
    readonly collection?: ScalarOrList<string>;
    readonly limit?: number;
    readonly type?: ScalarOrList<string>;
  };

/** One weighted entry in a `mixed` scenario. */
export interface MixEntry {
  readonly scenario: string;
  readonly weight: number;
}

/** A single benchmark scenario. */
export interface Scenario {
  readonly name: string;
  readonly type: ScenarioType;
  readonly load?: LoadConfig;
  readonly duration?: string;
  readonly warmup?: string;
  readonly signing?: SigningMode;
  readonly signatureTimeWindow?: boolean;
  readonly runs?: number;
  readonly expect?: ExpectBlock;
  // inbox / webfinger / actor / collection
  readonly recipient?: ScalarOrList<string>;
  readonly inbox?: string;
  readonly activity?: ActivitySpec;
  readonly authenticated?: boolean;
  readonly collection?: ScalarOrList<string>;
  // object
  readonly source?: ObjectSource;
  // fanout
  readonly sender?: string;
  readonly followers?: number;
  readonly trigger?: Record<string, unknown>;
  readonly sinkBehavior?: Record<string, unknown>;
  readonly queueDrainTimeout?: string;
  // failure
  readonly fault?: ScalarOrList<string>;
  // mixed
  readonly mix?: MixEntry[];
}

/** A complete benchmark scenario suite. */
export interface Suite {
  /** An optional editor hint pointing at the published schema. */
  readonly $schema?: string;
  readonly version: 1;
  readonly target?: string;
  readonly defaults?: SuiteDefaults;
  readonly actors?: ActorGroup[];
  readonly scenarios: Scenario[];
}
