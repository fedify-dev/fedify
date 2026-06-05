import { writeFile } from "node:fs/promises";
import process from "node:process";
import { getContextLoader, getDocumentLoader } from "../docloader.ts";
import { buildFleet } from "./actor/fleet.ts";
import type { BenchCommand } from "./command.ts";
import {
  buildReport,
  buildScenarioResult,
  configHash,
  detectEnvironment,
} from "./result/build.ts";
import { probeBenchmarkMode } from "./discovery/probe.ts";
import { renderReport, type ReportFormat } from "./render/index.ts";
import { validateExpectBlock } from "./result/expect/evaluate.ts";
import { loadSuiteFile, renderSuiteTemplates } from "./scenario/load.ts";
import {
  normalizeSuite,
  type ResolvedScenario,
  type ResolvedSuite,
} from "./scenario/normalize.ts";
import type { Suite } from "./scenario/types.ts";
import { validateSuite } from "./scenario/validate.ts";
import { assertTargetAllowed, UnsafeTargetError } from "./safety/gate.ts";
import { classifyTarget } from "./safety/tiers.ts";
import { runnerFor } from "./scenarios/registry.ts";
import {
  spawnSyntheticServer,
  type SyntheticServer,
} from "./server/synthetic.ts";

/** Injectable dependencies for {@link runBench}, overridable in tests. */
export interface RunBenchDeps {
  /** Terminates the process with an exit code. */
  readonly exit?: (code: number) => void;
  /** Writes the rendered report to the output path or standard output. */
  readonly writeOutput?: (
    content: string,
    outputPath: string | undefined,
  ) => Promise<void>;
  /** Emits a progress line (to standard error by default). */
  readonly log?: (message: string) => void;
  /** Fetch implementation. */
  readonly fetch?: typeof fetch;
}

/** The scenario types that need the synthetic actor/key server. */
const SIGNED_TYPES = new Set(["inbox"]);

/**
 * Runs the `fedify bench` command: load and validate the suite, gate the
 * target, run each scenario, and render the report.  The process exits 0 when
 * every `expect` gate passes and 1 otherwise; configuration and safety errors
 * exit 2.
 * @param command The parsed `bench` command options.
 * @param deps Injectable dependencies for testing.
 */
export default async function runBench(
  command: BenchCommand,
  deps: RunBenchDeps = {},
): Promise<void> {
  // Set the exit code rather than terminating, so cleanup (closing the fleet)
  // and output flushing complete before the process exits.
  const exit = deps.exit ?? ((code: number) => {
    process.exitCode = code;
  });
  const writeOutput = deps.writeOutput ?? defaultWriteOutput;
  const log = deps.log ??
    ((message: string) => process.stderr.write(`${message}\n`));
  const fetchImpl = deps.fetch ?? fetch;

  // Loading, validation, and normalization failures are all user-facing
  // configuration errors.
  let validated: Suite;
  let suite: ResolvedSuite;
  try {
    const raw = await loadSuiteFile(command.scenario);
    const rendered = renderSuiteTemplates(raw, command.target);
    validated = validateSuite(rendered, command.scenario);
    suite = normalizeSuite(validated, { target: command.target });
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    return void exit(2);
  }

  // Preflight every runner so an unsupported scenario type, an option the
  // runner cannot honor, or a malformed `expect` assertion fails fast, before
  // any probe or load.
  let runners;
  try {
    runners = suite.scenarios.map((scenario) => {
      const runner = runnerFor(scenario.type);
      runner.validate?.(scenario);
      validateExpectBlock(scenario.expect);
      return runner;
    });
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    return void exit(2);
  }

  if (command.dryRun) {
    await writeOutput(renderPlan(suite), command.output);
    return void exit(0);
  }

  const tier = classifyTarget(suite.target);
  const probe = await probeBenchmarkMode(suite.target, fetchImpl);
  try {
    assertTargetAllowed({
      tier,
      benchmarkMode: probe.benchmarkMode,
      allowUnsafe: command.allowUnsafeTarget,
      dryRun: false,
    });
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      log(error.message);
      return void exit(2);
    }
    throw error;
  }

  // The synthetic actor server is only reachable on the client's loopback, so
  // a remote (public) target cannot dereference its keys.  Signed scenarios
  // therefore require a loopback or private target.
  if (
    tier === "public" && suite.scenarios.some((s) => SIGNED_TYPES.has(s.type))
  ) {
    log(
      "Signed scenarios (inbox) require a loopback or private target: the " +
        "benchmark's synthetic actor server is only reachable on the client's " +
        "loopback, so a public target cannot dereference its keys.  Use a " +
        "local target, or a read scenario such as webfinger.",
    );
    return void exit(2);
  }

  const allowPrivateAddress = tier !== "public";
  const documentLoader = await getDocumentLoader({
    allowPrivateAddress,
    userAgent: command.userAgent,
  });
  const contextLoader = await getContextLoader({
    allowPrivateAddress,
    userAgent: command.userAgent,
  });

  let fleet: SyntheticServer | undefined;
  const startedAt = new Date().toISOString();
  try {
    if (suite.scenarios.some((s) => SIGNED_TYPES.has(s.type))) {
      fleet = await spawnSyntheticServer(await buildFleet(suite.actors));
    }
    const results = [];
    for (let i = 0; i < suite.scenarios.length; i++) {
      const scenario = suite.scenarios[i];
      log(`Running scenario "${scenario.name}" (${scenario.type})…`);
      const measurement = await runners[i].run({
        scenario,
        target: suite.target,
        documentLoader,
        contextLoader,
        allowPrivateAddress,
        fleet: fleet ?? null,
        fetch: fetchImpl,
      });
      results.push(buildScenarioResult(scenario, measurement));
    }
    const report = buildReport({
      scenarios: results,
      environment: detectEnvironment(),
      target: {
        url: suite.target.href,
        fedifyVersion: probe.fedifyVersion,
        statsAvailable: probe.benchmarkMode,
      },
      startedAt,
      finishedAt: new Date().toISOString(),
      suite: {
        // Hash the whole authored suite plus the effective target, so any
        // change to defaults, actors, or scenarios changes the hash.
        configHash: configHash({ suite: validated, target: suite.target.href }),
      },
    });
    await writeOutput(
      renderReport(report, command.format as ReportFormat),
      command.output,
    );
    return void exit(report.passed ? 0 : 1);
  } finally {
    await fleet?.close();
  }
}

async function defaultWriteOutput(
  content: string,
  outputPath: string | undefined,
): Promise<void> {
  if (outputPath == null) {
    process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
    return;
  }
  await writeFile(outputPath, content, { encoding: "utf-8" });
}

function renderPlan(suite: ResolvedSuite): string {
  const lines = [
    "Fedify benchmark plan (dry run)",
    "",
    `Target: ${suite.target.href}`,
    "",
  ];
  for (const scenario of suite.scenarios) {
    lines.push(
      `- ${scenario.name} (${scenario.type}): ${describePlan(scenario)}`,
    );
  }
  lines.push("", "No requests were sent.");
  return `${lines.join("\n")}\n`;
}

function describePlan(scenario: ResolvedScenario): string {
  const load = scenario.load.kind === "open"
    ? `open-loop ${scenario.load.ratePerSec}/s ${scenario.load.arrival}`
    : `closed-loop concurrency ${scenario.load.concurrency}`;
  return `${load}, duration ${scenario.durationMs}ms, signing ${scenario.signing}`;
}
