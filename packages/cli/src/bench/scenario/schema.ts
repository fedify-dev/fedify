/**
 * The embedded JSON Schema (draft 2020-12) for benchmark scenario suite files.
 *
 * These objects are the runtime copies used by the validator; they are
 * published, byte-for-byte, under *schema/bench/* and a drift guard keeps them
 * in sync.  The matching TypeScript types live in {@link ./types.ts}.
 *
 * The schema expresses every scenario type discussed for `fedify bench`
 * (`inbox`, `webfinger`, `actor`, `object`, `fanout`, `collection`, `failure`,
 * `mixed`).  All but `collection` have runners in this version.  Three
 * cross-field rules are enforced here rather than in code:
 *
 *  -  exactly one HTTP request signature scheme per actor group
 *     (`contains` + `minContains`/`maxContains`);
 *  -  `rate` XOR `concurrency` in a load block (`oneOf`);
 *  -  the allowed `expect` metrics per scenario type (`if`/`then` +
 *     `propertyNames`).
 * @since 2.3.0
 * @module
 */

/** The hosted URL that serves the current scenario schema. */
export const SCENARIO_SCHEMA_ID =
  "https://json-schema.fedify.dev/bench/scenario-v2.json";

/** The hosted URL that serves the version 1 scenario schema. */
export const SCENARIO_SCHEMA_ID_V1 =
  "https://json-schema.fedify.dev/bench/scenario-v1.json";

const READ_METRICS = [
  "successRate",
  "throughputPerSec",
  "errors.total",
  "errors.4xx",
  "errors.5xx",
  "latency.p50",
  "latency.p95",
  "latency.p99",
  "latency.mean",
  "latency.max",
];

const INBOX_METRICS = [
  ...READ_METRICS,
  "signatureVerification.p50",
  "signatureVerification.p95",
  "signatureVerification.p99",
];

const FANOUT_METRICS = [
  "successRate",
  "deliveryThroughput",
  "errors.total",
  "errors.4xx",
  "errors.5xx",
  "queueDrain.p50",
  "queueDrain.p95",
  "queueDrain.p99",
];

// A `mixed` scenario blends others, so it may assert any of their metrics.
const MIXED_METRICS = [...new Set([...INBOX_METRICS, ...FANOUT_METRICS])];

/** The benchmark scenario suite JSON Schema (draft 2020-12). */
export const scenarioSchemaV1 = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: SCENARIO_SCHEMA_ID_V1,
  title: "Fedify benchmark scenario suite",
  type: "object",
  required: ["version", "scenarios"],
  additionalProperties: false,
  properties: {
    $schema: {
      type: "string",
      description: "An optional editor hint pointing at this schema.",
    },
    version: { const: 1 },
    target: {
      type: "string",
      format: "uri",
      description: "The target base URL; may be overridden by --target.",
    },
    defaults: { $ref: "#/$defs/defaults" },
    actors: {
      type: "array",
      items: { $ref: "#/$defs/actorGroup" },
    },
    scenarios: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/$defs/scenario" },
    },
  },
  $defs: {
    duration: {
      type: "string",
      pattern: "^\\d+(\\.\\d+)?(ms|s|m|h)$",
      description: "A duration such as 500ms, 30s, 2m, or 1h.",
    },
    rate: {
      description: "An open-loop arrival rate such as 200/s, or a number.",
      oneOf: [
        { type: "number", exclusiveMinimum: 0 },
        { type: "string", pattern: "^\\d+(\\.\\d+)?\\s*/\\s*(s|m|h)$" },
      ],
    },
    size: {
      description: "A byte size such as 2KB or a plain number of bytes.",
      oneOf: [
        { type: "number", minimum: 0 },
        {
          type: "string",
          pattern:
            "^\\s*\\d+(\\.\\d+)?\\s*([Bb]|[Kk][Bb]|[Kk][Ii][Bb]|[Mm][Bb]|[Mm][Ii][Bb]|[Gg][Bb]|[Gg][Ii][Bb])?\\s*$",
        },
      ],
    },
    signatureStandard: {
      enum: [
        "draft-cavage-http-signatures-12",
        "rfc9421",
        "ld-signatures",
        "fep8b32",
      ],
    },
    signingMode: { enum: ["jit", "pipeline", "presign"] },
    arrival: { enum: ["constant", "poisson"] },
    scalarOrListString: {
      oneOf: [
        { type: "string" },
        { type: "array", items: { type: "string" }, minItems: 1 },
      ],
    },
    load: {
      type: "object",
      additionalProperties: false,
      properties: {
        rate: { $ref: "#/$defs/rate" },
        concurrency: { type: "integer", minimum: 1 },
        arrival: { $ref: "#/$defs/arrival" },
        maxInFlight: { type: "integer", minimum: 1 },
      },
      // `rate` (open-loop) and `concurrency` (closed-loop) are mutually
      // exclusive, but neither is required here: a load block may set only
      // `arrival`/`maxInFlight` and inherit the model from `defaults` (or the
      // built-in open-loop default), which the normalizer already supports.
      not: { required: ["rate", "concurrency"] },
    },
    defaults: {
      type: "object",
      additionalProperties: false,
      properties: {
        duration: { $ref: "#/$defs/duration" },
        warmup: { $ref: "#/$defs/duration" },
        load: { $ref: "#/$defs/load" },
        signing: { $ref: "#/$defs/signingMode" },
        signatureTimeWindow: { type: "boolean" },
        runs: { type: "integer", minimum: 1 },
      },
    },
    actorGroup: {
      type: "object",
      additionalProperties: false,
      required: ["signatureStandards"],
      properties: {
        name: { type: "string" },
        count: { type: "integer", minimum: 1 },
        signatureStandards: {
          type: "array",
          uniqueItems: true,
          minItems: 1,
          items: { $ref: "#/$defs/signatureStandard" },
          contains: { enum: ["draft-cavage-http-signatures-12", "rfc9421"] },
          minContains: 1,
          maxContains: 1,
          description:
            "Exactly one HTTP request signature scheme, plus optional " +
            "document signature schemes.",
        },
      },
    },
    generateDirective: {
      type: "object",
      additionalProperties: false,
      required: ["generate"],
      properties: {
        generate: { enum: ["lorem"] },
        size: { $ref: "#/$defs/size" },
      },
    },
    content: {
      oneOf: [
        { type: "string" },
        { $ref: "#/$defs/generateDirective" },
      ],
    },
    objectSpec: {
      type: "object",
      properties: {
        type: { $ref: "#/$defs/scalarOrListString" },
        content: { $ref: "#/$defs/content" },
      },
    },
    activitySpec: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { $ref: "#/$defs/scalarOrListString" },
        embedObject: { type: "boolean" },
        object: { $ref: "#/$defs/objectSpec" },
      },
    },
    objectSource: {
      oneOf: [
        { $ref: "#/$defs/scalarOrListString" },
        {
          type: "object",
          additionalProperties: false,
          required: ["seed"],
          properties: {
            seed: { $ref: "#/$defs/scalarOrListString" },
            collection: { $ref: "#/$defs/scalarOrListString" },
            limit: { type: "integer", minimum: 1 },
            type: { $ref: "#/$defs/scalarOrListString" },
          },
        },
      ],
    },
    expectSeverity: { enum: ["warn", "fail"] },
    expectValue: {
      oneOf: [
        {
          type: "string",
          description: "An assertion such as '>= 99%' or '< 100ms'.",
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["assert"],
          properties: {
            assert: { type: "string" },
            severity: { $ref: "#/$defs/expectSeverity" },
          },
        },
      ],
    },
    mixEntry: {
      type: "object",
      additionalProperties: false,
      required: ["scenario", "weight"],
      properties: {
        scenario: { type: "string" },
        weight: { type: "number", exclusiveMinimum: 0 },
      },
    },
    scenario: {
      type: "object",
      additionalProperties: false,
      required: ["name", "type"],
      properties: {
        name: { type: "string" },
        type: {
          enum: [
            "inbox",
            "webfinger",
            "actor",
            "object",
            "fanout",
            "collection",
            "failure",
            "mixed",
          ],
        },
        load: { $ref: "#/$defs/load" },
        duration: { $ref: "#/$defs/duration" },
        warmup: { $ref: "#/$defs/duration" },
        signing: { $ref: "#/$defs/signingMode" },
        signatureTimeWindow: { type: "boolean" },
        runs: { type: "integer", minimum: 1 },
        expect: {
          type: "object",
          additionalProperties: { $ref: "#/$defs/expectValue" },
        },
        // inbox / webfinger / actor / collection
        recipient: { $ref: "#/$defs/scalarOrListString" },
        inbox: { type: "string" },
        activity: { $ref: "#/$defs/activitySpec" },
        authenticated: { type: "boolean" },
        collection: { $ref: "#/$defs/scalarOrListString" },
        // object
        source: { $ref: "#/$defs/objectSource" },
        // fanout
        sender: { type: "string" },
        followers: { type: "integer", minimum: 1 },
        trigger: { type: "object" },
        sinkBehavior: { type: "object" },
        queueDrainTimeout: { $ref: "#/$defs/duration" },
        // failure
        fault: { $ref: "#/$defs/scalarOrListString" },
        // mixed
        mix: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/mixEntry" },
        },
      },
      allOf: [
        {
          if: { properties: { type: { const: "inbox" } } },
          then: {
            required: ["recipient"],
            properties: {
              expect: { propertyNames: { enum: INBOX_METRICS } },
            },
          },
        },
        {
          if: { properties: { type: { const: "webfinger" } } },
          then: {
            required: ["recipient"],
            properties: {
              expect: { propertyNames: { enum: READ_METRICS } },
            },
          },
        },
        {
          if: { properties: { type: { const: "actor" } } },
          then: {
            required: ["recipient"],
            properties: {
              expect: { propertyNames: { enum: INBOX_METRICS } },
            },
          },
        },
        {
          if: { properties: { type: { const: "object" } } },
          then: {
            required: ["source"],
            properties: {
              expect: { propertyNames: { enum: READ_METRICS } },
            },
          },
        },
        {
          if: { properties: { type: { const: "collection" } } },
          then: {
            required: ["recipient"],
            properties: {
              expect: { propertyNames: { enum: READ_METRICS } },
            },
          },
        },
        {
          if: { properties: { type: { const: "fanout" } } },
          then: {
            required: ["sender"],
            properties: {
              expect: { propertyNames: { enum: FANOUT_METRICS } },
            },
          },
        },
        {
          if: { properties: { type: { const: "failure" } } },
          then: {
            required: ["fault"],
            properties: {
              expect: { propertyNames: { enum: READ_METRICS } },
            },
          },
        },
        {
          if: { properties: { type: { const: "mixed" } } },
          then: {
            required: ["mix"],
            properties: {
              expect: { propertyNames: { enum: MIXED_METRICS } },
            },
          },
        },
      ],
    },
  },
} as const;

/** The current benchmark scenario suite JSON Schema (draft 2020-12). */
export const scenarioSchemaV2 = {
  ...scenarioSchemaV1,
  $id: SCENARIO_SCHEMA_ID,
  $defs: {
    ...scenarioSchemaV1.$defs,
    scenario: {
      ...scenarioSchemaV1.$defs.scenario,
      properties: {
        ...scenarioSchemaV1.$defs.scenario.properties,
        sinkBase: { type: "string" },
      },
      allOf: scenarioSchemaV1.$defs.scenario.allOf.map((condition) =>
        condition.if.properties.type.const === "failure"
          ? {
            if: condition.if,
            then: {
              properties: condition.then.properties,
            },
          }
          : condition
      ),
    },
  },
} as const;
