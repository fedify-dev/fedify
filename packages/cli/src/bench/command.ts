import { bindConfig } from "@optique/config";
import {
  argument,
  choice,
  command,
  constant,
  flag,
  group,
  type InferValue,
  merge,
  message,
  object,
  option,
  optional,
  or,
  string,
  withDefault,
} from "@optique/core";
import { configContext } from "../config.ts";
import { userAgentOption } from "../options.ts";

const formatOption = bindConfig(
  option(
    "-f",
    "--format",
    choice(["text", "json", "markdown"], { metavar: "FORMAT" }),
    {
      description: message`The output format for the benchmark report.`,
    },
  ),
  {
    context: configContext,
    key: (config) => config.bench?.format ?? "text",
    default: "text",
  },
);

// Deliberately NOT config-backed: this safety override must be an explicit
// per-run acknowledgment on the command line, so a persisted config file cannot
// silently disable the gate for every run.
const allowUnsafeTarget = withDefault(
  flag("--allow-unsafe-target", {
    description:
      message`Allow benchmarking a public target that does not advertise \
benchmark mode.  Must be given on the command line for each run; it cannot be \
set in a configuration file.`,
  }),
  false,
);

const outputOption = optional(
  option("-o", "--output", string({ metavar: "OUTPUT_PATH" }), {
    description:
      message`Write the report to a file instead of standard output.`,
  }),
);

const targetOption = optional(
  option("-t", "--target", string({ metavar: "URL" }), {
    description: message`Override the target URL declared in the suite.`,
  }),
);

const advertiseHostOption = optional(
  option("--advertise-host", string({ metavar: "HOST" }), {
    description: message`Host (name or IP) a non-loopback target can reach the \
benchmark's synthetic actor server at.  Required for signed scenarios against a \
non-loopback target; binds the synthetic server on all interfaces and uses this \
host in the actor and key URLs the target dereferences.`,
  }),
);

const runParser = merge(
  "Benchmark options",
  object({
    command: constant("bench"),
    mode: constant("run"),
    scenario: group(
      "Arguments",
      argument(string({ metavar: "SCENARIO_FILE" }), {
        description: message`Path to the benchmark suite file (YAML or JSON).`,
      }),
    ),
    target: targetOption,
    format: formatOption,
    output: outputOption,
    dryRun: withDefault(
      flag("--dry-run", {
        description:
          message`Resolve discovery and print the benchmark plan without \
sending load.`,
      }),
      false,
    ),
    advertiseHost: advertiseHostOption,
    allowUnsafeTarget,
  }),
  userAgentOption,
);

const compareParser = command(
  "compare",
  merge(
    "Compare options",
    object({
      command: constant("bench"),
      mode: constant("compare"),
      base: option("--base", string({ metavar: "REF" }), {
        description: message`The base git ref to benchmark.`,
      }),
      head: option("--head", string({ metavar: "REF" }), {
        description: message`The head git ref to benchmark.`,
      }),
      file: option("--file", string({ metavar: "SCENARIO_FILE" }), {
        description: message`Path to the benchmark suite file (YAML or JSON).`,
      }),
      startCommand: option(
        "--start-command",
        string({ metavar: "COMMAND" }),
        {
          description:
            message`Shell command that starts the target application in each \
checked-out worktree.`,
        },
      ),
      readyUrl: option("--ready-url", string({ metavar: "URL" }), {
        description:
          message`URL that returns success when the started target is ready.`,
      }),
      readyTimeout: withDefault(
        option("--ready-timeout", string({ metavar: "DURATION" }), {
          description: message`How long to wait for --ready-url.`,
        }),
        "30s",
      ),
      maxRegression: option(
        "--max-regression",
        string({ metavar: "PERCENT" }),
        {
          description:
            message`Maximum regression tolerated after the measured noise band.`,
        },
      ),
      target: targetOption,
      format: formatOption,
      output: outputOption,
      dryRun: constant(false),
      advertiseHost: advertiseHostOption,
      allowUnsafeTarget,
    }),
    userAgentOption,
  ),
  {
    brief: message`Compare base and head benchmark runs.`,
    description:
      message`Run the same benchmark suite against two git revisions on the \
same runner, then fail when the head revision regresses beyond the configured \
tolerance and measured noise band.`,
  },
);

export const benchCommand = command(
  "bench",
  or(compareParser, runParser),
  {
    brief: message`Benchmark a Fedify federation workload.`,
    description: message`Run an ActivityPub-specific load benchmark against a \
cooperative Fedify target running in benchmark mode.

The suite file declares the target, actors, and scenarios.  This version \
executes the \`inbox\`, \`webfinger\`, \`actor\`, \`object\`, \`fanout\`, \
\`failure\`, and \`mixed\` scenario types; \`collection\` remains reserved by \
the suite format.`,
  },
);

export type BenchCommand = InferValue<typeof benchCommand>;
export type BenchRunCommand = Extract<BenchCommand, { mode: "run" }>;
export type BenchCompareCommand = Extract<BenchCommand, { mode: "compare" }>;
