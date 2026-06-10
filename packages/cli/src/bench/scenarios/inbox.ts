/**
 * The `inbox` scenario runner: the end-to-end signed-delivery benchmark.
 *
 * It discovers the recipient's inbox the way a real peer does, then drives
 * signed activity deliveries through the signing pipeline, aggregates the
 * client-measured results, and reads the target's server-side metrics.
 * @since 2.3.0
 * @module
 */

import { Create, Note } from "@fedify/vocab";
import type { Activity } from "@fedify/vocab";
import { discoverInbox, selectInbox } from "../discovery/discover.ts";
import { runLoad } from "../load/generator.ts";
import { aggregateSamples } from "../metrics/aggregate.ts";
import {
  diffSnapshots,
  fetchServerSnapshot,
  type ServerSnapshot,
  snapshotToMetrics,
} from "../metrics/stats-client.ts";
import { asList } from "../scenario/coerce.ts";
import type { ResolvedScenario } from "../scenario/normalize.ts";
import type { ActivitySpec } from "../scenario/types.ts";
import type { SyntheticActor } from "../server/synthetic.ts";
import { createActivityIdMinter } from "../signing/activity-id.ts";
import { createSigningPipeline } from "../signing/pipeline.ts";
import { signInboxDelivery } from "../signing/signer.ts";
import {
  type GenerateDirective,
  isGenerateDirective,
  resolveGenerate,
} from "../template/generate.ts";
import {
  estimateTotal,
  loadPlanOf,
  measuredWindowMs,
  type RunContext,
  type ScenarioRunner,
  sendRequest,
  validateInboxSelector,
  withMeasuredWindowStart,
} from "./runner.ts";

/** One discovered delivery target: an inbox and the actor it belongs to. */
interface InboxTarget {
  readonly inbox: URL;
  readonly actorUri: URL;
}

/** The `inbox` scenario runner. */
export const inboxRunner: ScenarioRunner = {
  validate(scenario: ResolvedScenario): void {
    validateActivity(scenario);
    validateInbox(scenario);
  },

  async run(context: RunContext) {
    const { scenario, fleet } = context;
    if (fleet == null || fleet.actors.length < 1) {
      throw new Error(
        "The inbox scenario requires the synthetic actor server.",
      );
    }
    if (scenario.recipients.length < 1) {
      throw new Error("The inbox scenario requires a recipient.");
    }
    // `validate()` is optional in the runner contract, so re-check here too,
    // keeping a direct `run()` call (as in tests) safe.
    validateActivity(scenario);
    validateInbox(scenario);
    const fetchImpl = context.fetch ?? fetch;
    // Discover every recipient's inbox the way a real peer would, then rotate
    // across them so multi-recipient suites spread load over each inbox.
    const targets: InboxTarget[] = [];
    for (const recipient of scenario.recipients) {
      const discovered = await discoverInbox(recipient, {
        documentLoader: context.documentLoader,
        contextLoader: context.contextLoader,
        allowPrivateAddress: context.allowPrivateAddress,
      });
      const inbox = selectInbox(discovered, scenario.inbox);
      // Gate the actual load destination before sending anything to it: it can
      // differ from the gated target (a public recipient, or an explicit inbox).
      await context.assertDestinationAllowed?.(inbox);
      targets.push({ inbox, actorUri: discovered.actorUri });
    }

    const actors = fleet.actors;
    const minter = createActivityIdMinter(fleet.url);
    let index = 0;
    const factory = () => {
      const i = index++;
      const actor = actors[i % actors.length];
      const target = targets[i % targets.length];
      const activity = buildActivity(
        scenario.activity,
        actor,
        minter.next(),
        fleet.url,
        target.actorUri,
      );
      return signInboxDelivery({
        actor,
        inbox: target.inbox,
        activity,
        contextLoader: context.contextLoader,
      });
    };
    const pipeline = createSigningPipeline(scenario.signing, factory, {
      total: estimateTotal(scenario),
    });

    const rawSend = async () => {
      let request: Request;
      try {
        request = await pipeline.next();
      } catch (error) {
        return { ok: false, errorKind: "client", reason: String(error) };
      }
      return sendRequest(request, fetchImpl);
    };
    // Snapshot the server's cumulative metrics at the measured-window boundary
    // so warm-up and earlier scenarios are diffed out of the reported numbers.
    // A few warm-up requests still in flight when the baseline is taken may be
    // attributed to the window; that residue is bounded by the in-flight count.
    let baseline: ServerSnapshot | null = null;
    let baselineTaken = false;
    const send = withMeasuredWindowStart(scenario.warmupMs, async () => {
      baseline = await fetchServerSnapshot(context.target, fetchImpl);
      baselineTaken = true;
    }, rawSend);

    try {
      await pipeline.prime();
      const result = await runLoad(
        loadPlanOf(scenario, context.rng),
        send,
        context.clock,
      );
      const measurement = aggregateSamples(result.samples, {
        measuredWindowMs: measuredWindowMs(scenario),
        includeHistogram: true,
      });
      const end = await fetchServerSnapshot(context.target, fetchImpl);
      // Only report server metrics when both ends of the window were captured;
      // a missing baseline cannot be diffed (and falling back to the cumulative
      // snapshot would silently reintroduce warm-up and earlier-scenario load).
      const server = baselineTaken && baseline != null && end != null
        ? snapshotToMetrics(diffSnapshots(baseline, end))
        : null;
      return { ...measurement, server };
    } finally {
      await pipeline.close();
    }
  },
};

/**
 * Validates the scenario's `inbox` mode.  `"shared"` and `"personal"` select a
 * discovered inbox; any other value is an explicit inbox URL the run will POST
 * to, so it must be a usable bare http(s) URL.  Without this preflight check, a
 * typo like `inbox: shraed` would crash `selectInbox` with an uncaught error
 * mid-run, and a non-http URL would slip through to the send path.
 */
function validateInbox(scenario: ResolvedScenario): void {
  validateInboxSelector(scenario.name, scenario.inbox);
}

/**
 * Rejects the activity options the inbox runner cannot yet honor: it always
 * delivers a `Create` carrying an embedded `Note`, so a different activity or
 * object type, or `embedObject: false`, is refused with a clear message.
 */
function validateActivity(scenario: ResolvedScenario): void {
  const spec = scenario.activity;
  if (spec == null) return;
  // `type` and `object.type` are scalar-or-list, so check every supplied value:
  // a list such as `[Create, Announce]` is just as unsupported as `Announce`.
  const badType = asList(spec.type).find((type) => type !== "Create");
  if (badType != null) {
    throw new Error(
      `Scenario "${scenario.name}": the inbox runner currently supports only ` +
        `Create activities; got ${JSON.stringify(badType)}.`,
    );
  }
  if (spec.embedObject === false) {
    throw new Error(
      `Scenario "${scenario.name}": the inbox runner always embeds the ` +
        "activity's object; embedObject: false is not yet supported.",
    );
  }
  const badObjectType = asList(spec.object?.type).find((type) =>
    type !== "Note"
  );
  if (badObjectType != null) {
    throw new Error(
      `Scenario "${scenario.name}": the inbox runner currently supports only ` +
        `Note objects; got ${JSON.stringify(badObjectType)}.`,
    );
  }
}

function buildActivity(
  spec: ActivitySpec | undefined,
  actor: SyntheticActor,
  id: URL,
  base: URL,
  recipient: URL,
): Activity {
  // `validateActivity` has already rejected anything but a Create/Note here.
  const note = new Note({
    id: new URL(`/objects/${crypto.randomUUID()}`, base),
    attribution: actor.id,
    content: resolveContent(spec?.object?.content),
    to: recipient,
  });
  return new Create({ id, actor: actor.id, object: note, to: recipient });
}

function resolveContent(
  content: string | GenerateDirective | undefined,
): string {
  if (content == null) return "Benchmark activity.";
  if (typeof content === "string") return content;
  if (isGenerateDirective(content)) return resolveGenerate(content);
  return String(content);
}
