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
import { fetchServerMetrics } from "../metrics/stats-client.ts";
import { asList } from "../scenario/coerce.ts";
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
} from "./runner.ts";

/** The `inbox` scenario runner. */
export const inboxRunner: ScenarioRunner = {
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
    const fetchImpl = context.fetch ?? fetch;
    const discovered = await discoverInbox(scenario.recipients[0], {
      documentLoader: context.documentLoader,
      contextLoader: context.contextLoader,
      allowPrivateAddress: context.allowPrivateAddress,
    });
    const inbox = selectInbox(discovered, scenario.inbox);

    const actors = fleet.actors;
    const minter = createActivityIdMinter(fleet.url);
    let actorIndex = 0;
    const factory = () => {
      const actor = actors[actorIndex++ % actors.length];
      const activity = buildActivity(
        scenario.activity,
        actor,
        minter.next(),
        fleet.url,
        discovered.actorUri,
      );
      return signInboxDelivery({
        actor,
        inbox,
        activity,
        contextLoader: context.contextLoader,
      });
    };
    const pipeline = createSigningPipeline(scenario.signing, factory, {
      total: estimateTotal(scenario),
    });

    const send = async () => {
      let request: Request;
      try {
        request = await pipeline.next();
      } catch (error) {
        return { ok: false, errorKind: "client", reason: String(error) };
      }
      return sendRequest(request, fetchImpl);
    };

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
      const server = await fetchServerMetrics(context.target, fetchImpl);
      return { ...measurement, server };
    } finally {
      await pipeline.close();
    }
  },
};

function buildActivity(
  spec: ActivitySpec | undefined,
  actor: SyntheticActor,
  id: URL,
  base: URL,
  recipient: URL,
): Activity {
  const type = asList(spec?.type)[0] ?? "Create";
  if (type !== "Create") {
    throw new Error(
      `The inbox runner currently supports only Create activities; got ` +
        `${JSON.stringify(type)}.`,
    );
  }
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
