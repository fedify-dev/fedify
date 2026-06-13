import { writeFile } from "node:fs/promises";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import process from "node:process";
import { getContextLoader, getDocumentLoader } from "../docloader.ts";
import { describeError } from "../utils.ts";
import { buildFleet } from "./actor/fleet.ts";
import type { BenchRunCommand } from "./command.ts";
import {
  type DiscoveredInbox,
  discoverInbox,
  selectInbox,
} from "./discovery/discover.ts";
import {
  actorUrlsFromRecipients,
  objectUrlsFromSource,
} from "./scenarios/object-discovery.ts";
import {
  buildReport,
  buildScenarioResult,
  configHash,
  detectEnvironment,
  type ScenarioMeasurement,
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
import type { LoadConfig, Suite, SuiteDefaults } from "./scenario/types.ts";
import { validateSuite } from "./scenario/validate.ts";
import {
  assertInboxDestinationAllowed,
  assertTargetAllowed,
  assertUnsafeOverrideAllowed,
  UnsafeTargetError,
} from "./safety/gate.ts";
import {
  classifyResolvedTarget,
  type ResolveTargetAddresses,
  type TargetTier,
} from "./safety/tiers.ts";
import { runnerFor } from "./scenarios/registry.ts";
import {
  resolveAdvertiseHost,
  spawnSyntheticServer,
  type SyntheticServer,
} from "./server/synthetic.ts";
import { convertUrlIfHandle } from "../webfinger/lib.ts";

type BenchRunRuntimeCommand = BenchRunCommand & {
  readonly explicitCliTarget?: boolean;
};

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
  /** Hostname resolver used for target risk classification. */
  readonly resolveTargetAddresses?: ResolveTargetAddresses;
}

/**
 * Runs the `fedify bench` command: load and validate the suite, gate the
 * target, run each scenario, and render the report.  The process exits 0 when
 * every `expect` gate passes and 1 otherwise; configuration and safety errors
 * exit 2.
 * @param command The parsed `bench` command options.
 * @param deps Injectable dependencies for testing.
 */
export default async function runBench(
  command: BenchRunRuntimeCommand,
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
  // Apply the configured User-Agent to all benchmark traffic — the probe, the
  // stats reads, and the runners' inbox/WebFinger requests — not just the
  // document loader, so a target that inspects the UA sees it on every request.
  const fetchImpl = withUserAgent(deps.fetch ?? fetch, command.userAgent);
  const explicitCliTarget = command.explicitCliTarget ?? command.target != null;

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
    log(describeError(error));
    return void exit(2);
  }

  // Preflight every runner so an unsupported scenario type, an option the
  // runner cannot honor, or a malformed `expect` assertion fails fast, before
  // any probe or load.
  let runners: ReturnType<typeof runnerFor>[];
  try {
    runners = suite.scenarios.map((scenario) => {
      const runner = runnerFor(scenario.type);
      runner.validate?.(scenario, { scenarios: suite.scenarios });
      validateExpectBlock(scenario.expect);
      return runner;
    });
    if (command.advertiseHost != null) {
      resolveAdvertiseHost(command.advertiseHost);
    }
  } catch (error) {
    log(describeError(error));
    return void exit(2);
  }

  const tier = await classifyResolvedTarget(
    suite.target,
    deps.resolveTargetAddresses,
  );
  const probe = await probeBenchmarkMode(suite.target, fetchImpl);
  try {
    if (!command.dryRun) {
      assertUnsafeOverrideAllowed({
        tier,
        benchmarkMode: probe.benchmarkMode,
        allowUnsafe: command.allowUnsafeTarget,
        explicitCliTarget,
        scenarios: unsafeOverrideScenarios(validated),
      });
    }
    assertTargetAllowed({
      tier,
      benchmarkMode: probe.benchmarkMode,
      allowUnsafe: command.allowUnsafeTarget,
      dryRun: command.dryRun,
    });
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      log(error.message);
      return void exit(2);
    }
    throw error;
  }

  // The target dereferences the synthetic actor server while verifying
  // signatures.  By default that server is loopback-only, reachable just by a
  // same-machine (loopback) target; a non-loopback target needs an advertised,
  // reachable host (--advertise-host).  Without one, refuse signed scenarios
  // rather than let every signed delivery fail key lookup.
  const allowPrivateAddress = tier !== "public";
  const documentLoader = await getDocumentLoader({
    allowPrivateAddress,
    userAgent: command.userAgent,
  });
  const contextLoader = await getContextLoader({
    allowPrivateAddress,
    userAgent: command.userAgent,
  });

  // Gates each resolved inbox destination (which can differ from the suite
  // target) before the runner sends load to it.
  const assertDestinationAllowed = async (
    url: URL,
    scenario: ResolvedScenario,
  ): Promise<void> => {
    const destinationTier = url.origin === suite.target.origin
      ? tier
      : await classifyResolvedTarget(url, deps.resolveTargetAddresses);
    assertInboxDestinationAllowed(url, {
      targetOrigin: suite.target.origin,
      targetTier: tier,
      destinationTier,
      targetBenchmarkMode: probe.benchmarkMode,
      allowUnsafe: command.allowUnsafeTarget,
      advertised: command.advertiseHost != null,
    });
    assertPublicDestinationOverrideAllowed(url, scenario, {
      targetOrigin: suite.target.origin,
      targetBenchmarkMode: probe.benchmarkMode,
      allowUnsafe: command.allowUnsafeTarget,
      explicitCliTarget,
      destinationTier,
      defaults: validated.defaults,
    });
  };
  const assertDestinationWithoutSyntheticServerAllowed = async (
    url: URL,
    scenario: ResolvedScenario,
    loadDescription: string,
  ): Promise<void> => {
    const sameOrigin = url.origin === suite.target.origin;
    const destinationTier = sameOrigin
      ? tier
      : await classifyResolvedTarget(url, deps.resolveTargetAddresses);
    const inheritsTargetGate = sameOrigin && probe.benchmarkMode;
    if (
      destinationTier === "public" && !inheritsTargetGate &&
      !command.allowUnsafeTarget
    ) {
      throw new UnsafeTargetError(
        `Refusing to send ${loadDescription} to ${url.href}: it is public ` +
          "and not part of the benchmarked target.  Pass " +
          "--allow-unsafe-target to override.",
      );
    }
    assertPublicDestinationOverrideAllowed(url, scenario, {
      targetOrigin: suite.target.origin,
      targetBenchmarkMode: probe.benchmarkMode,
      allowUnsafe: command.allowUnsafeTarget,
      explicitCliTarget,
      destinationTier,
      defaults: validated.defaults,
    });
  };
  const assertReadDestinationAllowed = (
    url: URL,
    scenario: ResolvedScenario,
  ): Promise<void> =>
    assertDestinationWithoutSyntheticServerAllowed(
      url,
      scenario,
      "benchmark read load",
    );
  const assertActorlessDestinationAllowed = (
    url: URL,
    scenario: ResolvedScenario,
  ): Promise<void> =>
    assertDestinationWithoutSyntheticServerAllowed(
      url,
      scenario,
      "benchmark load",
    );

  if (command.dryRun) {
    try {
      await writeOutput(
        await renderPlan(suite, {
          documentLoader,
          contextLoader,
          allowPrivateAddress,
          fetch: fetchImpl,
          assertDestinationAllowed,
          assertReadDestinationAllowed,
        }),
        command.output,
      );
      return void exit(0);
    } catch (error) {
      log(describeError(error));
      return void exit(2);
    }
  }

  // The target dereferences the synthetic actor server while verifying
  // signatures.  By default that server is loopback-only, reachable just by a
  // same-machine (loopback) target; a non-loopback target needs an advertised,
  // reachable host (--advertise-host).  Without one, refuse signed scenarios
  // rather than let every signed delivery fail key lookup.
  if (
    tier !== "loopback" && command.advertiseHost == null &&
    suite.scenarios.some((scenario) =>
      scenarioNeedsReachableLocalServer(scenario, suite.scenarios)
    )
  ) {
    log(
      "Some scenarios need benchmark-owned local servers to be reachable from " +
        "the target.  A loopback target reaches them automatically; for a " +
        "non-loopback target, pass --advertise-host with an address the target " +
        "can reach, or use a scenario that does not need local benchmark " +
        "servers such as webfinger.",
    );
    return void exit(2);
  }

  let fleet: SyntheticServer | undefined;
  const startedAt = new Date().toISOString();
  try {
    if (
      suite.scenarios.some((scenario) =>
        scenarioNeedsSyntheticServer(scenario, suite.scenarios)
      )
    ) {
      fleet = await spawnSyntheticServer(await buildFleet(suite.actors), {
        advertiseHost: command.advertiseHost,
      });
    }
    const results = [];
    for (let i = 0; i < suite.scenarios.length; i++) {
      const scenario = suite.scenarios[i];
      const measurements: ScenarioMeasurement[] = [];
      for (let run = 1; run <= scenario.runs; run++) {
        const suffix = scenario.runs === 1
          ? ""
          : ` run ${run}/${scenario.runs}`;
        log(`Running scenario "${scenario.name}" (${scenario.type})${suffix}…`);
        measurements.push(
          await runners[i].run({
            scenario,
            scenarios: suite.scenarios,
            target: suite.target,
            documentLoader,
            contextLoader,
            allowPrivateAddress,
            fleet: fleet ?? null,
            advertiseHost: command.advertiseHost,
            fetch: fetchImpl,
            assertDestinationAllowed: (url, gateScenario) =>
              assertDestinationAllowed(url, gateScenario ?? scenario),
            assertReadDestinationAllowed: (url, gateScenario) =>
              assertReadDestinationAllowed(url, gateScenario ?? scenario),
            assertActorlessDestinationAllowed: (url, gateScenario) =>
              assertActorlessDestinationAllowed(url, gateScenario ?? scenario),
          }),
        );
      }
      results.push(buildScenarioResult(scenario, measurements));
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
  } catch (error) {
    // A refused inbox destination (gated inside the runner, once resolved) is a
    // safety error, like the target gate above: report it and exit 2.
    if (error instanceof UnsafeTargetError) {
      log(error.message);
      return void exit(2);
    }
    throw error;
  } finally {
    await fleet?.close();
  }
}

/**
 * Wraps a fetch implementation so every request carries the given User-Agent,
 * unless the caller already set one.  A prebuilt {@link Request} (the signed
 * inbox delivery, a WebFinger GET) is mutated in place rather than recloned, so
 * an already-signed body and its digest are left untouched; the User-Agent is
 * not part of the signed header set, so adding it does not affect verification.
 * @param fetchImpl The underlying fetch implementation.
 * @param userAgent The User-Agent header value to apply.
 * @returns A fetch implementation that injects the User-Agent.
 */
export function withUserAgent(
  fetchImpl: typeof fetch,
  userAgent: string,
): typeof fetch {
  // Cast the wrapper to `typeof fetch`: the standard contract it implements is a
  // subset of the runtime's overloaded fetch type (which carries extra non-
  // standard overloads), so the assignment is sound but not structurally
  // inferable.
  return ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (input instanceof Request && init === undefined) {
      if (input.headers.has("user-agent")) return fetchImpl(input);
      try {
        input.headers.set("user-agent", userAgent);
        return fetchImpl(input);
      } catch {
        // Some Request objects have immutable headers; fall back to a clone.
        const headers = new Headers(input.headers);
        headers.set("user-agent", userAgent);
        return fetchImpl(new Request(input, { headers }));
      }
    }
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has("user-agent")) headers.set("user-agent", userAgent);
    return fetchImpl(input, { ...init, headers });
  }) as typeof fetch;
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

interface DryRunPlanContext {
  readonly documentLoader: DocumentLoader;
  readonly contextLoader: DocumentLoader;
  readonly allowPrivateAddress: boolean;
  readonly fetch: typeof fetch;
  readonly assertDestinationAllowed: (
    url: URL,
    scenario: ResolvedScenario,
  ) => Promise<void>;
  readonly assertReadDestinationAllowed: (
    url: URL,
    scenario: ResolvedScenario,
  ) => Promise<void>;
}

async function renderPlan(
  suite: ResolvedSuite,
  context: DryRunPlanContext,
): Promise<string> {
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
    lines.push(...await describeDiscoveryPlan(scenario, suite, context));
  }
  lines.push(
    "",
    "No benchmark load was sent.  Discovery and stats probe requests may " +
      "have been sent.",
  );
  return `${lines.join("\n")}\n`;
}

function describePlan(scenario: ResolvedScenario): string {
  const load = scenario.load.kind === "open"
    ? `open-loop ${scenario.load.ratePerSec}/s ${scenario.load.arrival}`
    : `closed-loop concurrency ${scenario.load.concurrency}`;
  const totalDurationMs = scenario.durationMs * scenario.runs;
  const volume = describePlannedRequestVolume(scenario);
  return [
    load,
    `duration ${scenario.durationMs}ms`,
    `runs ${scenario.runs}`,
    `total duration ${totalDurationMs}ms`,
    ...(volume == null ? [] : [volume]),
    `signing ${scenario.signing}`,
  ].join(", ");
}

function describePlannedRequestVolume(
  scenario: ResolvedScenario,
): string | null {
  if (scenario.load.kind !== "open") return null;
  const estimatedRequests = scenario.load.ratePerSec *
    (scenario.durationMs / 1000) * scenario.runs;
  return `estimated scheduled requests ${formatPlanNumber(estimatedRequests)}`;
}

function formatPlanNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const formatted = value.toFixed(2).replace(/\.?0+$/, "");
  return formatted === "" ? "0" : formatted;
}

async function describeDiscoveryPlan(
  scenario: ResolvedScenario,
  suite: ResolvedSuite,
  context: DryRunPlanContext,
): Promise<string[]> {
  switch (scenario.type) {
    case "inbox":
      return await describeInboxDiscoveryPlan(scenario, context);
    case "webfinger":
      return describeWebFingerPlan(scenario, suite.target);
    case "actor":
      return await describeActorPlan(scenario, suite, context);
    case "object":
      return await describeObjectPlan(scenario, suite, context);
    case "mixed":
      return describeMixedPlan(scenario);
    default:
      return ["  discovery: not available for this scenario type"];
  }
}

async function describeInboxDiscoveryPlan(
  scenario: ResolvedScenario,
  context: DryRunPlanContext,
): Promise<string[]> {
  const lines: string[] = [];
  for (const recipient of scenario.recipients) {
    let discovered: DiscoveredInbox;
    try {
      discovered = await discoverInbox(recipient, {
        documentLoader: context.documentLoader,
        contextLoader: context.contextLoader,
        allowPrivateAddress: context.allowPrivateAddress,
      });
    } catch (error) {
      lines.push(
        `  recipient ${recipient}: discovery failed (${describeError(error)})`,
      );
      continue;
    }
    const inbox = selectInbox(discovered, scenario.inbox);
    lines.push(
      `  recipient ${recipient}: actor ${discovered.actorUri.href}, ` +
        `inbox ${inbox.href}`,
    );
    lines.push(
      `  destination safety: ${await describeDestinationSafety(
        inbox,
        scenario,
        context,
      )}`,
    );
  }
  return lines;
}

function describeWebFingerPlan(
  scenario: ResolvedScenario,
  target: URL,
): string[] {
  const recipients = scenario.recipients.length > 0
    ? scenario.recipients
    : [target.href];
  return recipients.map((recipient) => {
    const resource = convertUrlIfHandle(recipient).href;
    const url = new URL("/.well-known/webfinger", target);
    url.searchParams.set("resource", resource);
    return `  webfinger ${resource}: GET ${url.href}`;
  });
}

async function describeActorPlan(
  scenario: ResolvedScenario,
  suite: ResolvedSuite,
  context: DryRunPlanContext,
): Promise<string[]> {
  try {
    const urls = await actorUrlsFromRecipients(scenario.recipients, {
      target: suite.target,
      fetch: context.fetch,
    });
    const lines: string[] = [];
    for (const url of urls) {
      lines.push(`  actor: GET ${url.href}`);
      lines.push(
        `  destination safety: ${await describeDestinationSafety(
          url,
          scenario,
          context,
        )}`,
      );
    }
    return lines;
  } catch (error) {
    return [`  actor discovery failed (${describeError(error)})`];
  }
}

async function describeObjectPlan(
  scenario: ResolvedScenario,
  suite: ResolvedSuite,
  context: DryRunPlanContext,
): Promise<string[]> {
  try {
    const urls = await objectUrlsFromSource({
      source: scenario.source,
      target: suite.target,
      fetch: context.fetch,
      assertReadDestinationAllowed: (url) =>
        context.assertReadDestinationAllowed(url, scenario),
    });
    const lines = [`  objects: ${urls.length} URL(s) resolved`];
    for (const url of urls.slice(0, 10)) {
      lines.push(`  object: GET ${url.href}`);
      lines.push(
        `  destination safety: ${await describeDestinationSafety(
          url,
          scenario,
          context,
        )}`,
      );
    }
    if (urls.length > 10) lines.push(`  ... ${urls.length - 10} more`);
    return lines;
  } catch (error) {
    return [`  object discovery failed (${describeError(error)})`];
  }
}

function describeMixedPlan(scenario: ResolvedScenario): string[] {
  const entries = scenario.raw.mix ?? [];
  if (entries.length < 1) return ["  mix: no child scenarios"];
  return entries.map((entry) =>
    `  mix: ${entry.scenario} weight ${entry.weight}`
  );
}

async function describeDestinationSafety(
  url: URL,
  scenario: ResolvedScenario,
  context: DryRunPlanContext,
): Promise<string> {
  try {
    if (usesReadDestinationGate(scenario)) {
      await context.assertReadDestinationAllowed(url, scenario);
    } else {
      await context.assertDestinationAllowed(url, scenario);
    }
    return "allowed";
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      return `would be refused: ${error.message}`;
    }
    throw error;
  }
}

function usesReadDestinationGate(scenario: ResolvedScenario): boolean {
  return (scenario.type === "actor" || scenario.type === "object") &&
    !scenario.authenticated;
}

interface PublicDestinationOverrideContext {
  readonly targetOrigin: string;
  readonly targetBenchmarkMode: boolean;
  readonly allowUnsafe: boolean;
  readonly explicitCliTarget: boolean;
  readonly destinationTier: TargetTier;
  readonly defaults?: SuiteDefaults;
}

function assertPublicDestinationOverrideAllowed(
  url: URL,
  scenario: ResolvedScenario,
  context: PublicDestinationOverrideContext,
): void {
  const inheritsTargetGate = url.origin === context.targetOrigin &&
    context.targetBenchmarkMode;
  if (
    context.destinationTier !== "public" || inheritsTargetGate ||
    !context.allowUnsafe
  ) {
    return;
  }
  assertUnsafeOverrideAllowed({
    tier: "public",
    benchmarkMode: false,
    allowUnsafe: true,
    explicitCliTarget: context.explicitCliTarget,
    scenarios: [unsafeOverrideScenario(scenario, context.defaults)],
  });
}

function unsafeOverrideScenarios(
  suite: Suite,
): Parameters<typeof assertUnsafeOverrideAllowed>[0]["scenarios"] {
  return suite.scenarios.map((scenario) =>
    unsafeOverrideScenario(scenario, suite.defaults)
  );
}

function unsafeOverrideScenario(
  scenario: ResolvedScenario | Suite["scenarios"][number],
  defaults?: SuiteDefaults,
): Parameters<typeof assertUnsafeOverrideAllowed>[0]["scenarios"][number] {
  const defaultDuration = defaults?.duration != null;
  const defaultLoad = hasExplicitLoad(defaults?.load);
  const defaultRuns = defaults?.runs != null;
  const raw = "raw" in scenario ? scenario.raw : scenario;
  return {
    name: scenario.name,
    explicitDuration: raw.duration != null || defaultDuration,
    explicitLoad: hasExplicitLoad(raw.load) || defaultLoad,
    explicitRuns: raw.runs != null || defaultRuns,
  };
}

function hasExplicitLoad(load: LoadConfig | undefined): boolean {
  return load != null &&
    typeof load === "object" &&
    (("rate" in load && load.rate != null) ||
      ("concurrency" in load && load.concurrency != null));
}

function scenarioNeedsSyntheticServer(
  scenario: ResolvedScenario,
  scenarios: readonly ResolvedScenario[],
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (seen.has(scenario.name)) return false;
  const nextSeen = new Set(seen).add(scenario.name);
  switch (scenario.type) {
    case "inbox":
      return true;
    case "actor":
    case "object":
      return scenario.authenticated;
    case "failure":
      return failureFaultsOf(scenario).some(isInboundFailureFault);
    case "mixed":
      return mixedChildrenOf(scenario, scenarios).some((child) =>
        scenarioNeedsSyntheticServer(child, scenarios, nextSeen)
      );
    default:
      return false;
  }
}

function scenarioNeedsReachableLocalServer(
  scenario: ResolvedScenario,
  scenarios: readonly ResolvedScenario[],
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (scenario.type === "fanout") return scenario.raw.sinkBase == null;
  if (scenario.type === "failure") {
    const faults = failureFaultsOf(scenario);
    return faults.includes("invalid-signature") ||
      (scenario.raw.sinkBase == null &&
        faults.some(isRemoteFailureFault));
  }
  if (scenario.type === "mixed") {
    if (seen.has(scenario.name)) return false;
    const nextSeen = new Set(seen).add(scenario.name);
    return mixedChildrenOf(scenario, scenarios).some((child) =>
      scenarioNeedsReachableLocalServer(child, scenarios, nextSeen)
    );
  }
  return scenarioNeedsSyntheticServer(scenario, scenarios, seen);
}

function failureFaultsOf(scenario: ResolvedScenario): readonly string[] {
  return scenario.faults.length < 1 ? ["remote-404"] : scenario.faults;
}

function mixedChildrenOf(
  scenario: ResolvedScenario,
  scenarios: readonly ResolvedScenario[],
): readonly ResolvedScenario[] {
  return (scenario.raw.mix ?? []).flatMap((entry) => {
    const child = scenarios.find((candidate) =>
      candidate.name === entry.scenario
    );
    return child == null ? [] : [child];
  });
}

function isInboundFailureFault(fault: string): boolean {
  return fault === "invalid-signature" || fault === "missing-actor";
}

function isRemoteFailureFault(fault: string): boolean {
  return fault === "remote-404" || fault === "remote-410" ||
    fault === "slow-inbox" || fault === "network-error";
}
