/**
 * The embedded JSON Schema (draft 2020-12) for benchmark report output.
 *
 * Like the scenario schema, this object is the runtime copy and is published,
 * byte-for-byte, as *schema/bench/report-v1.json*; a drift guard keeps the two
 * in sync.  The matching TypeScript types live in {@link ./model.ts}.
 * @since 2.3.0
 * @module
 */

/** The hosted URL that serves the report schema. */
export const REPORT_SCHEMA_ID =
  "https://json-schema.fedify.dev/bench/report-v1.json";

/** The benchmark report JSON Schema (draft 2020-12). */
export const reportSchemaV1 = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: REPORT_SCHEMA_ID,
  title: "Fedify benchmark report",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "tool",
    "environment",
    "target",
    "startedAt",
    "finishedAt",
    "suite",
    "passed",
    "scenarios",
  ],
  properties: {
    $schema: { type: "string" },
    schemaVersion: { const: 1 },
    tool: {
      type: "object",
      additionalProperties: false,
      required: ["name", "version"],
      properties: {
        name: { type: "string" },
        version: { type: "string" },
      },
    },
    environment: {
      type: "object",
      additionalProperties: false,
      required: ["runtime", "runtimeVersion", "os", "cpuCount"],
      properties: {
        runtime: { type: "string" },
        runtimeVersion: { type: "string" },
        os: { type: "string" },
        cpuCount: { type: "integer", minimum: 0 },
      },
    },
    target: {
      type: "object",
      additionalProperties: false,
      required: ["url", "statsAvailable"],
      properties: {
        url: { type: "string" },
        fedifyVersion: { type: ["string", "null"] },
        statsAvailable: { type: "boolean" },
      },
    },
    startedAt: { type: "string" },
    finishedAt: { type: "string" },
    suite: {
      type: "object",
      additionalProperties: false,
      required: ["configHash"],
      properties: {
        name: { type: "string" },
        configHash: { type: "string" },
      },
    },
    passed: { type: "boolean" },
    scenarios: {
      type: "array",
      items: { $ref: "#/$defs/scenarioResult" },
    },
  },
  $defs: {
    latencyMs: {
      type: "object",
      additionalProperties: false,
      required: ["p50", "p95", "p99", "mean", "max"],
      properties: {
        p50: { type: "number" },
        p95: { type: "number" },
        p99: { type: "number" },
        mean: { type: "number" },
        max: { type: "number" },
      },
    },
    partialLatencyMs: {
      type: "object",
      additionalProperties: false,
      properties: {
        p50: { type: "number" },
        p95: { type: "number" },
        p99: { type: "number" },
      },
    },
    loadSummary: {
      type: "object",
      additionalProperties: false,
      required: ["model", "durationMs", "warmupMs"],
      properties: {
        model: { enum: ["open", "closed"] },
        ratePerSec: { type: "number" },
        arrival: { type: "string" },
        concurrency: { type: "integer" },
        durationMs: { type: "number" },
        warmupMs: { type: "number" },
        maxInFlight: { type: "integer" },
      },
      oneOf: [
        {
          properties: { model: { const: "open" } },
          required: ["ratePerSec", "arrival"],
          not: { required: ["concurrency"] },
        },
        {
          properties: { model: { const: "closed" } },
          required: ["concurrency"],
          not: {
            anyOf: [{ required: ["ratePerSec"] }, { required: ["arrival"] }],
          },
        },
      ],
    },
    requestSummary: {
      type: "object",
      additionalProperties: false,
      required: ["total", "ok", "failed", "successRate"],
      properties: {
        total: { type: "integer", minimum: 0 },
        ok: { type: "integer", minimum: 0 },
        failed: { type: "integer", minimum: 0 },
        successRate: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    clientMetrics: {
      type: "object",
      additionalProperties: false,
      required: ["latencyMs"],
      properties: {
        latencyMs: { $ref: "#/$defs/latencyMs" },
      },
    },
    serverMetrics: {
      type: "object",
      additionalProperties: false,
      properties: {
        signatureVerificationMs: {
          type: "object",
          additionalProperties: false,
          required: ["overall"],
          properties: {
            overall: { $ref: "#/$defs/partialLatencyMs" },
            byStandard: {
              type: "object",
              additionalProperties: { $ref: "#/$defs/partialLatencyMs" },
            },
          },
        },
        queue: {
          type: "object",
          additionalProperties: false,
          properties: {
            drainMs: { $ref: "#/$defs/partialLatencyMs" },
            depthMax: { type: "number" },
          },
        },
      },
    },
    errorBucket: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "reason", "count"],
      properties: {
        kind: { type: "string" },
        status: { type: "integer" },
        reason: { type: "string" },
        count: { type: "integer", minimum: 0 },
      },
    },
    expectResult: {
      type: "object",
      additionalProperties: false,
      required: [
        "metric",
        "op",
        "threshold",
        "unit",
        "actual",
        "severity",
        "pass",
      ],
      properties: {
        metric: { type: "string" },
        op: { enum: ["lt", "lte", "gt", "gte", "eq"] },
        threshold: { type: "number" },
        unit: { type: ["string", "null"] },
        actual: { type: ["number", "null"] },
        severity: { enum: ["warn", "fail"] },
        pass: { type: "boolean" },
      },
    },
    scenarioResult: {
      type: "object",
      additionalProperties: false,
      required: [
        "name",
        "type",
        "load",
        "requests",
        "throughputPerSec",
        "client",
        "server",
        "errors",
        "expectations",
        "passed",
      ],
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
        load: { $ref: "#/$defs/loadSummary" },
        requests: { $ref: "#/$defs/requestSummary" },
        throughputPerSec: { type: "number" },
        client: { $ref: "#/$defs/clientMetrics" },
        server: {
          anyOf: [{ $ref: "#/$defs/serverMetrics" }, { type: "null" }],
        },
        errors: {
          type: "array",
          items: { $ref: "#/$defs/errorBucket" },
        },
        expectations: {
          type: "array",
          items: { $ref: "#/$defs/expectResult" },
        },
        passed: { type: "boolean" },
        histogram: { $ref: "#/$defs/serializedHistogram" },
      },
    },
    serializedHistogram: {
      type: "object",
      additionalProperties: false,
      required: [
        "version",
        "subBucketCount",
        "count",
        "zeroCount",
        "min",
        "max",
        "sum",
        "indices",
        "counts",
      ],
      properties: {
        version: { const: 1 },
        subBucketCount: { type: "integer", minimum: 1 },
        count: { type: "integer", minimum: 0 },
        zeroCount: { type: "integer", minimum: 0 },
        min: { type: "number" },
        max: { type: "number" },
        sum: { type: "number" },
        indices: { type: "array", items: { type: "integer" } },
        counts: { type: "array", items: { type: "integer", minimum: 0 } },
      },
    },
  },
} as const;
