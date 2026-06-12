/**
 * The `failure` scenario runner.
 * @since 2.3.0
 * @module
 */

import { Create, Note } from "@fedify/vocab";
import { discoverInbox, selectInbox } from "../discovery/discover.ts";
import { runLoad, type SendOutcome } from "../load/generator.ts";
import { aggregateSamples } from "../metrics/aggregate.ts";
import {
  diffSnapshots,
  fetchServerSnapshot,
  queueTaskRemaining,
} from "../metrics/stats-client.ts";
import type { SyntheticActor } from "../server/synthetic.ts";
import { createActivityIdMinter } from "../signing/activity-id.ts";
import { signInboxDelivery } from "../signing/signer.ts";
import { resolveSinkBase, spawnSinkServer } from "./fanout.ts";
import {
  loadPlanOf,
  measuredWindowMs,
  type RunContext,
  type ScenarioRunner,
  sendRequest,
  validateInboxSelector,
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
type RemoteFailureFault = Exclude<
  SupportedFault,
  "invalid-signature" | "missing-actor"
>;

interface FailureDeliveryTarget {
  readonly inbox: URL;
  readonly actorUri: URL;
}

interface RemoteFailureTarget {
  readonly recipient: Record<string, unknown>;
  readonly close: () => Promise<void>;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 60_000;
const DRAIN_POLL_MS = 25;

/** The `failure` scenario runner. */
export const failureRunner: ScenarioRunner = {
  validate(scenario): void {
    const faults = scenario.faults.length < 1
      ? ["remote-404"]
      : scenario.faults;
    const remoteFaults = [...new Set(faults.filter(isRemoteFault))];
    for (const fault of faults) {
      if (!isSupportedFault(fault)) {
        throw new Error(
          `Scenario "${scenario.name}": unsupported failure fault ` +
            `${JSON.stringify(fault)}; supported faults: ${
              SUPPORTED_FAULTS.join(", ")
            }.`,
        );
      }
    }
    if (faults.some(isInboundFault)) {
      validateInboxSelector(scenario.name, scenario.inbox);
    }
    if (faults.some(isInboundFault) && scenario.recipients.length < 1) {
      throw new Error(
        `Scenario "${scenario.name}": invalid-signature and missing-actor ` +
          "faults require a recipient.",
      );
    }
    if (faults.some(isRemoteFault) && scenario.sender == null) {
      throw new Error(
        `Scenario "${scenario.name}": remote failure faults require a ` +
          "sender.",
      );
    }
    if (faults.some(isRemoteFault)) {
      resolveSinkBase(scenario.name, scenario.raw.sinkBase);
    }
    if (
      scenario.raw.sinkBase != null &&
      remoteFaults.includes("network-error") &&
      remoteFaults.some((fault) => fault !== "network-error")
    ) {
      throw new Error(
        `Scenario "${scenario.name}": sinkBase cannot combine ` +
          "network-error with other remote failure faults because the same " +
          "port cannot be both open and unreachable.",
      );
    }
  },

  async run(context: RunContext) {
    this.validate?.(context.scenario);
    const faults = faultsOf(context);
    const deliveryTarget = await resolveFailureDeliveryTarget(context, faults);
    const remoteTargets = await resolveRemoteFailureTargets(context, faults);
    const remoteActivityIds = createActivityIdMinter(context.target);
    try {
      let index = 0;
      const sendOne = () =>
        sendForFault(
          context,
          faults[index++ % faults.length],
          deliveryTarget,
          remoteTargets,
          remoteActivityIds,
        );
      let send = sendOne;
      if (faults.some(isRemoteFault)) {
        let previous = Promise.resolve();
        send = () => {
          const current = previous.then(sendOne);
          previous = current.then(
            () => {},
            () => {},
          );
          return current;
        };
      }
      const result = await runLoad(
        loadPlanOf(context.scenario, context.rng),
        send,
        context.clock,
      );
      return aggregateSamples(result.samples, {
        measuredWindowMs: measuredWindowMs(context.scenario),
        includeHistogram: true,
      });
    } finally {
      await Promise.all(
        [...remoteTargets.values()].map((target) => target.close()),
      );
    }
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
  if (faults.every((fault) => fault === "missing-actor")) {
    await context.assertActorlessDestinationAllowed?.(inbox);
  } else {
    await context.assertDestinationAllowed?.(inbox);
  }
  return { inbox, actorUri: discovered.actorUri };
}

function isInboundFault(
  fault: string,
): fault is Extract<SupportedFault, "invalid-signature" | "missing-actor"> {
  return fault === "invalid-signature" || fault === "missing-actor";
}

function isRemoteFault(fault: string): fault is RemoteFailureFault {
  return fault === "remote-404" || fault === "remote-410" ||
    fault === "slow-inbox" || fault === "network-error";
}

async function resolveRemoteFailureTargets(
  context: RunContext,
  faults: readonly SupportedFault[],
): Promise<Map<RemoteFailureFault, RemoteFailureTarget>> {
  const targets = new Map<RemoteFailureFault, RemoteFailureTarget>();
  try {
    const remoteFaults = [...new Set(faults.filter(isRemoteFault))];
    const liveFaults = remoteFaults.filter((fault) =>
      fault !== "network-error"
    );
    if (liveFaults.length > 0) {
      const sink = await spawnSinkServer({
        followers: liveFaults.length,
        rawBehavior: null,
        rawBehaviors: liveFaults.map(remoteSinkBehavior),
        advertiseHost: context.advertiseHost,
        sinkBase: context.scenario.raw.sinkBase,
      });
      const close = once(sink.close);
      for (const [index, fault] of liveFaults.entries()) {
        targets.set(fault, { recipient: sink.recipients[index], close });
      }
    }
    if (remoteFaults.includes("network-error")) {
      const sink = await spawnSinkServer({
        followers: 1,
        rawBehavior: remoteSinkBehavior("network-error"),
        advertiseHost: context.advertiseHost,
        sinkBase: context.scenario.raw.sinkBase,
      });
      const recipient = sink.recipients[0];
      try {
        await sink.close();
        targets.set("network-error", {
          recipient,
          close: () => Promise.resolve(),
        });
      } catch (error) {
        await sink.close().catch(() => {});
        throw error;
      }
    }
    return targets;
  } catch (error) {
    await Promise.all([...targets.values()].map((target) => target.close()));
    throw error;
  }
}

function once(close: () => Promise<void>): () => Promise<void> {
  let closed: Promise<void> | null = null;
  return () => {
    closed ??= close();
    return closed;
  };
}

function remoteSinkBehavior(
  fault: RemoteFailureFault,
): Record<string, unknown> {
  switch (fault) {
    case "remote-404":
      return { status: 404 };
    case "remote-410":
      return { status: 410 };
    case "slow-inbox":
      return { status: 202, latency: "25ms" };
    case "network-error":
      return { status: 202 };
  }
}

async function sendForFault(
  context: RunContext,
  fault: SupportedFault,
  deliveryTarget: FailureDeliveryTarget | null,
  remoteTargets: ReadonlyMap<RemoteFailureFault, RemoteFailureTarget>,
  remoteActivityIds: ReturnType<typeof createActivityIdMinter>,
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
    case "remote-410":
    case "slow-inbox":
    case "network-error":
      return await sendRemoteFailure(
        context,
        fault,
        requiredRemoteTarget(fault, remoteTargets),
        remoteActivityIds,
      );
  }
}

async function sendRemoteFailure(
  context: RunContext,
  fault: RemoteFailureFault,
  target: RemoteFailureTarget,
  remoteActivityIds: ReturnType<typeof createActivityIdMinter>,
): Promise<SendOutcome> {
  const fetchImpl = context.fetch ?? fetch;
  const baseline = await fetchServerSnapshot(context.target, fetchImpl);
  const response = await fetchImpl(
    new URL("/.well-known/fedify/bench/trigger", context.target),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      redirect: "manual",
      body: JSON.stringify({
        sender: { identifier: requiredSender(context) },
        recipients: [target.recipient],
        activity: buildRemoteFailureActivity(context, remoteActivityIds.next()),
      }),
    },
  );
  await response.arrayBuffer().catch(() => {});
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: `status_${response.status}`,
    };
  }
  const observation = await waitForRemoteFault({
    target: context.target,
    fetch: fetchImpl,
    baseline,
    fault,
    timeoutMs: context.scenario.queueDrainTimeoutMs ??
      DEFAULT_DRAIN_TIMEOUT_MS,
  });
  if (observation == null) {
    return {
      ok: false,
      errorKind: "server",
      reason: "stats_unavailable",
    };
  }
  if (observation.timedOut) {
    return {
      ok: false,
      errorKind: "server",
      reason: "expected_remote_failure_not_observed",
    };
  }
  return expectedRemoteFailure(fault);
}

function buildRemoteFailureActivity(
  context: RunContext,
  id: URL,
): Record<string, unknown> {
  const objectId = new URL(`/objects/${crypto.randomUUID()}`, context.target);
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    id: id.href,
    actor: new URL(`/users/${requiredSender(context)}`, context.target).href,
    object: {
      type: "Note",
      id: objectId.href,
      content: "Benchmark failure activity.",
    },
  };
}

interface RemoteFaultObservation {
  readonly timedOut: boolean;
}

async function waitForRemoteFault(options: {
  readonly target: URL;
  readonly fetch: typeof fetch;
  readonly baseline: Awaited<ReturnType<typeof fetchServerSnapshot>>;
  readonly fault: RemoteFailureFault;
  readonly timeoutMs: number;
}): Promise<RemoteFaultObservation | null> {
  if (options.baseline == null) return null;
  const baselineRemaining = queueTaskRemaining(options.baseline) ?? 0;
  const deadline = Date.now() + options.timeoutMs;
  do {
    const snapshot = await fetchServerSnapshot(options.target, options.fetch);
    if (snapshot != null) {
      const diff = diffSnapshots(options.baseline, snapshot);
      const queueTasks = diff.queueTasks;
      if (options.fault === "remote-404" || options.fault === "remote-410") {
        if ((diff.deliveryPermanentFailures ?? 0) > 0) {
          return { timedOut: false };
        }
      } else if (queueTasks != null) {
        const remaining = queueTaskRemaining(diff, baselineRemaining);
        if (remaining != null) {
          if (options.fault === "slow-inbox") {
            if (queueTasks.completed > 0 && remaining === 0) {
              return { timedOut: false };
            }
          } else if (options.fault === "network-error") {
            if (
              queueTasks.failed > 0 ||
              (queueTasks.completed > 0 && remaining > 0)
            ) {
              return { timedOut: false };
            }
          }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
  } while (Date.now() < deadline);
  return { timedOut: true };
}

function expectedRemoteFailure(fault: RemoteFailureFault): SendOutcome {
  switch (fault) {
    case "remote-404":
      return { ok: true, status: 404 };
    case "remote-410":
      return { ok: true, status: 410 };
    case "slow-inbox":
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
  const body = await request.arrayBuffer();
  const headers = new Headers(request.headers);
  corruptSignatureHeaders(headers);
  return expectedFailure(
    await sendRequest(
      new Request(request.url, {
        method: request.method,
        headers,
        body,
        redirect: "manual",
      }),
      context.fetch ?? fetch,
    ),
  );
}

function corruptSignatureHeaders(headers: Headers): void {
  const signature = headers.get("signature");
  if (signature != null) headers.set("signature", `${signature}0`);
  const authorization = headers.get("authorization");
  if (authorization != null) {
    headers.set("authorization", `${authorization}0`);
  }
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

function requiredRemoteTarget(
  fault: RemoteFailureFault,
  targets: ReadonlyMap<RemoteFailureFault, RemoteFailureTarget>,
): RemoteFailureTarget {
  const target = targets.get(fault);
  if (target == null) {
    throw new Error(`The ${fault} fault requires a benchmark sink.`);
  }
  return target;
}

function requiredSender(context: RunContext): string {
  const sender = context.scenario.sender;
  if (sender == null) {
    throw new Error("Remote failure faults require a sender.");
  }
  return sender;
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
  if (outcome.status != null && outcome.status >= 400 && outcome.status < 500) {
    return { ok: true, status: outcome.status };
  }
  return {
    ...outcome,
    ok: false,
    reason: outcome.reason ?? "expected_failure_not_observed",
  };
}
