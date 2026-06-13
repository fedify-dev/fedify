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

export const benchCommand = command(
  "bench",
  merge(
    "Benchmark options",
    object({
      command: constant("bench"),
      scenario: group(
        "Arguments",
        argument(string({ metavar: "SCENARIO_FILE" }), {
          description:
            message`Path to the benchmark suite file (YAML or JSON).`,
        }),
      ),
      target: optional(
        option("-t", "--target", string({ metavar: "URL" }), {
          description: message`Override the target URL declared in the suite.`,
        }),
      ),
      format: formatOption,
      output: optional(
        option("-o", "--output", string({ metavar: "OUTPUT_PATH" }), {
          description:
            message`Write the report to a file instead of standard output.`,
        }),
      ),
      dryRun: withDefault(
        flag("--dry-run", {
          description:
            message`Resolve discovery and print the benchmark plan without \
sending load.`,
        }),
        false,
      ),
      advertiseHost: optional(
        option("--advertise-host", string({ metavar: "HOST" }), {
          description:
            message`Host (name or IP) a non-loopback target can reach the \
benchmark's synthetic actor server at.  Required for signed scenarios against a \
non-loopback target; binds the synthetic server on all interfaces and uses this \
host in the actor and key URLs the target dereferences.`,
        }),
      ),
      allowUnsafeTarget,
    }),
    userAgentOption,
  ),
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
