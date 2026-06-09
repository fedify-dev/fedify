/**
 * The `failure` scenario runner.
 * @since 2.3.0
 * @module
 */

import { Create, Note } from "@fedify/vocab";
import { discoverInbox, selectInbox } from "../discovery/discover.ts";
import { runLoad, type SendOutcome } from "../load/generator.ts";
import { aggregateSamples } from "../metrics/aggregate.ts";
import type { SyntheticActor } from "../server/synthetic.ts";
import { createActivityIdMinter } from "../signing/activity-id.ts";
import { signInboxDelivery } from "../signing/signer.ts";
import {
  loadPlanOf,
  measuredWindowMs,
  type RunContext,
  type ScenarioRunner,
  sendRequest,
} from "./runner.ts";

const SUPPORTED_FAULTS = [
  "invalid-signature",
  "missing-actor",
  "remote-404",
  "remote-410",
  "slow-inbox",
  "network-error",
] as const;

type SupportedFault = typeof SUPPORTED_FAULTS[number];

interface FailureDeliveryTarget {
  readonly inbox: URL;
  readonly actorUri: URL;
}

/** The `failure` scenario runner. */
export const failureRunner: ScenarioRunner = {
  validate(scenario): void {
    for (const fault of scenario.faults) {
      if (!isSupportedFault(fault)) {
        throw new Error(
          `Scenario "${scenario.name}": unsupported failure fault ` +
            `${JSON.stringify(fault)}; supported faults: ${
              SUPPORTED_FAULTS.join(", ")
            }.`,
        );
      }
    }
    if (
      scenario.faults.some((fault) =>
        fault === "invalid-signature" || fault === "missing-actor"
      ) && scenario.recipients.length < 1
    ) {
      throw new Error(
        `Scenario "${scenario.name}": invalid-signature and missing-actor ` +
          "faults require a recipient.",
      );
    }
  },

  async run(context: RunContext) {
    this.validate?.(context.scenario);
    const faults = faultsOf(context);
    const deliveryTarget = await resolveFailureDeliveryTarget(context, faults);
    let index = 0;
    const send = () =>
      sendForFault(context, faults[index++ % faults.length], deliveryTarget);
    const result = await runLoad(
      loadPlanOf(context.scenario, context.rng),
      send,
      context.clock,
    );
    return aggregateSamples(result.samples, {
      measuredWindowMs: measuredWindowMs(context.scenario),
      includeHistogram: true,
    });
  },
};

function faultsOf(context: RunContext): SupportedFault[] {
  const faults = context.scenario.faults.length < 1
    ? ["remote-404"]
    : context.scenario.faults;
  return faults.map((fault) => {
    if (isSupportedFault(fault)) return fault;
    throw new Error(
      `Scenario "${context.scenario.name}": unsupported failure fault ` +
        `${JSON.stringify(fault)}.`,
    );
  });
}

function isSupportedFault(fault: string): fault is SupportedFault {
  return SUPPORTED_FAULTS.includes(fault as SupportedFault);
}

async function resolveFailureDeliveryTarget(
  context: RunContext,
  faults: readonly SupportedFault[],
): Promise<FailureDeliveryTarget | null> {
  if (!faults.some(isInboundFault)) return null;
  const { scenario } = context;
  const discovered = await discoverInbox(scenario.recipients[0], {
    documentLoader: context.documentLoader,
    contextLoader: context.contextLoader,
    allowPrivateAddress: context.allowPrivateAddress,
  });
  const inbox = selectInbox(discovered, scenario.inbox);
  await context.assertDestinationAllowed?.(inbox);
  return { inbox, actorUri: discovered.actorUri };
}

function isInboundFault(fault: SupportedFault): boolean {
  return fault === "invalid-signature" || fault === "missing-actor";
}

async function sendForFault(
  context: RunContext,
  fault: SupportedFault,
  deliveryTarget: FailureDeliveryTarget | null,
): Promise<SendOutcome> {
  switch (fault) {
    case "invalid-signature":
      return await sendInvalidSignature(
        context,
        requiredTarget(deliveryTarget),
      );
    case "missing-actor":
      return await sendMissingActor(context, requiredTarget(deliveryTarget));
    case "remote-404":
      return { ok: true, status: 404 };
    case "remote-410":
      return { ok: true, status: 410 };
    case "slow-inbox":
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { ok: true, status: 202 };
    case "network-error":
      return {
        ok: true,
        errorKind: "network",
        reason: "expected_network_error",
      };
  }
}

async function sendInvalidSignature(
  context: RunContext,
  deliveryTarget: FailureDeliveryTarget,
): Promise<SendOutcome> {
  const request = await signedFailureRequest(
    context,
    "invalid-signature",
    deliveryTarget,
  );
  const body = new Uint8Array(await request.arrayBuffer());
  const corrupted = new Uint8Array(body.length + 1);
  corrupted.set(body);
  corrupted[body.length] = 0x20;
  const headers = new Headers(request.headers);
  return expectedFailure(
    await sendRequest(
      new Request(request.url, {
        method: request.method,
        headers,
        body: corrupted,
        redirect: "manual",
      }),
      context.fetch ?? fetch,
    ),
  );
}

async function sendMissingActor(
  context: RunContext,
  deliveryTarget: FailureDeliveryTarget,
): Promise<SendOutcome> {
  const request = await signedFailureRequest(
    context,
    "missing-actor",
    deliveryTarget,
  );
  return expectedFailure(await sendRequest(request, context.fetch ?? fetch));
}

async function signedFailureRequest(
  context: RunContext,
  fault: "invalid-signature" | "missing-actor",
  deliveryTarget: FailureDeliveryTarget,
): Promise<Request> {
  const { fleet, scenario } = context;
  if (fleet == null || fleet.actors.length < 1) {
    throw new Error(
      "The failure scenario requires the synthetic actor server.",
    );
  }
  if (scenario.recipients.length < 1) {
    throw new Error(
      "The invalid-signature and missing-actor faults require a recipient.",
    );
  }
  const actor = fault === "missing-actor"
    ? missingActor(fleet.actors[0], context.target)
    : fleet.actors[0];
  const id = createActivityIdMinter(fleet.url).next();
  const note = new Note({
    id: new URL(`/objects/${crypto.randomUUID()}`, fleet.url),
    attribution: actor.id,
    content: "Benchmark failure activity.",
    to: deliveryTarget.actorUri,
  });
  const activity = new Create({
    id,
    actor: actor.id,
    object: note,
    to: deliveryTarget.actorUri,
  });
  return await signInboxDelivery({
    actor,
    inbox: deliveryTarget.inbox,
    activity,
    contextLoader: context.contextLoader,
  });
}

function requiredTarget(
  target: FailureDeliveryTarget | null,
): FailureDeliveryTarget {
  if (target == null) {
    throw new Error(
      "The invalid-signature and missing-actor faults require discovery.",
    );
  }
  return target;
}

function missingActor(actor: SyntheticActor, target: URL): SyntheticActor {
  const id = new URL(`/__fedify_bench/missing/${crypto.randomUUID()}`, target);
  return {
    ...actor,
    id,
    rsaKeyId: actor.rsaKeyId == null ? undefined : new URL("#main-key", id),
    ed25519KeyId: actor.ed25519KeyId == null
      ? undefined
      : new URL("#ed25519-key", id),
  };
}

function expectedFailure(outcome: SendOutcome): SendOutcome {
  if (outcome.status != null && outcome.status >= 400) {
    return { ok: true, status: outcome.status };
  }
  return {
    ...outcome,
    ok: false,
    reason: outcome.reason ?? "expected_failure_not_observed",
  };
}
