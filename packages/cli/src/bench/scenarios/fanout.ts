/**
 * The `fanout` scenario runner.
 * @since 2.3.0
 * @module
 */

import { serve } from "srvx";
import { runLoad, type SendOutcome } from "../load/generator.ts";
import { aggregateSamples } from "../metrics/aggregate.ts";
import { LogLinearHistogram } from "../metrics/histogram.ts";
import {
  diffSnapshots,
  fetchServerSnapshot,
  queueTaskRemaining,
} from "../metrics/stats-client.ts";
import type { PartialLatencyMs, ServerMetrics } from "../result/model.ts";
import { parseDuration } from "../scenario/units.ts";
import { resolveAdvertiseHost } from "../server/synthetic.ts";
import { createActivityIdMinter } from "../signing/activity-id.ts";
import {
  loadPlanOf,
  measuredWindowMs,
  type RunContext,
  type ScenarioRunner,
} from "./runner.ts";

const DEFAULT_FOLLOWERS = 5;
const DEFAULT_DRAIN_TIMEOUT_MS = 60_000;
const DRAIN_POLL_MS = 25;

/** The `fanout` scenario runner. */
export const fanoutRunner: ScenarioRunner = {
  validate(scenario): void {
    const kind = triggerKind(scenario.raw.trigger);
    if (kind !== "benchmark-hook") {
      throw new Error(
        `Scenario "${scenario.name}": fanout currently supports only ` +
          `trigger.kind: "benchmark-hook".`,
      );
    }
    if ((scenario.followers ?? DEFAULT_FOLLOWERS) < 5) {
      throw new Error(
        `Scenario "${scenario.name}": fanout needs at least 5 followers to ` +
          "exercise Fedify's fanout queue.",
      );
    }
    resolveSinkBase(scenario.name, scenario.raw.sinkBase);
  },

  async run(context: RunContext) {
    if (context.scenario.sender == null) {
      throw new Error("The fanout scenario requires a sender.");
    }
    this.validate?.(context.scenario);
    const fetchImpl = context.fetch ?? fetch;
    const followers = context.scenario.followers ?? DEFAULT_FOLLOWERS;
    const sink = await spawnSinkServer({
      followers,
      rawBehavior: context.scenario.raw.sinkBehavior,
      advertiseHost: context.advertiseHost,
      sinkBase: context.scenario.raw.sinkBase,
    });
    const minter = createActivityIdMinter(context.target);
    const drainHistogram = new LogLinearHistogram();
    let delivered = 0;
    try {
      await assertSinkRecipientsAllowed(sink.recipients, context);
      const sendOne = async (scheduledAtMs: number): Promise<SendOutcome> => {
        const baseline = await fetchServerSnapshot(context.target, fetchImpl);
        const started = Date.now();
        const response = await fetchImpl(
          new URL(
            "/.well-known/fedify/bench/trigger",
            context.target,
          ),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            redirect: "manual",
            body: JSON.stringify({
              sender: { identifier: context.scenario.sender },
              recipients: sink.recipients,
              activity: buildActivity(context, minter.next()),
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
        const drain = await waitForDrain({
          target: context.target,
          fetch: fetchImpl,
          baseline,
          timeoutMs: context.scenario.queueDrainTimeoutMs ??
            DEFAULT_DRAIN_TIMEOUT_MS,
        });
        if (drain == null) {
          return {
            ok: false,
            errorKind: "server",
            reason: "stats_unavailable",
          };
        }
        if (drain.timedOut) {
          return {
            ok: false,
            errorKind: "server",
            reason: "queue_drain_timeout",
          };
        }
        if (drain.failed > 0) {
          return {
            ok: false,
            errorKind: "server",
            reason: "queue_delivery_failed",
          };
        }
        if (scheduledAtMs >= context.scenario.warmupMs) {
          drainHistogram.record(Date.now() - started);
          delivered += sink.recipients.length;
        }
        return { ok: true, status: response.status };
      };
      let previous = Promise.resolve();
      const send = (scheduledAtMs: number): Promise<SendOutcome> => {
        const current = previous.then(() => sendOne(scheduledAtMs));
        previous = current.then(
          () => {},
          () => {},
        );
        return current;
      };
      const result = await runLoad(
        loadPlanOf(context.scenario, context.rng),
        send,
        context.clock,
      );
      const measurement = aggregateSamples(result.samples, {
        measuredWindowMs: measuredWindowMs(context.scenario),
        includeHistogram: true,
      });
      const server = addQueueDrain(measurement.server, drainHistogram);
      const deliveryThroughputPerSec = delivered /
        (Math.max(measuredWindowMs(context.scenario), 1) / 1000);
      return {
        ...measurement,
        deliveryThroughputPerSec,
        server,
      };
    } finally {
      await sink.close();
    }
  },
};

function triggerKind(trigger: unknown): string {
  if (trigger == null) return "benchmark-hook";
  if (typeof trigger !== "object" || Array.isArray(trigger)) return "";
  const kind = (trigger as Record<string, unknown>).kind;
  return typeof kind === "string" ? kind : "benchmark-hook";
}

function buildActivity(context: RunContext, id: URL): Record<string, unknown> {
  const objectId = new URL(`/objects/${crypto.randomUUID()}`, context.target);
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    id: id.href,
    actor: new URL(`/users/${context.scenario.sender}`, context.target).href,
    object: {
      type: "Note",
      id: objectId.href,
      content: "Benchmark fanout activity.",
    },
  };
}

export async function assertSinkRecipientsAllowed(
  recipients: readonly Record<string, unknown>[],
  context: RunContext,
): Promise<void> {
  for (const recipient of recipients) {
    if (typeof recipient.inbox !== "string") continue;
    await context.assertActorlessDestinationAllowed?.(
      new URL(recipient.inbox),
      context.scenario,
    );
  }
}

export async function spawnSinkServer(options: {
  readonly followers: number;
  readonly rawBehavior: unknown;
  readonly rawBehaviors?: readonly unknown[];
  readonly advertiseHost?: string;
  readonly sinkBase?: string;
}): Promise<{
  readonly recipients: readonly Record<string, unknown>[];
  readonly close: () => Promise<void>;
}> {
  const sinkBase = resolveSinkBase("benchmark sink", options.sinkBase);
  const advertised = options.advertiseHost == null
    ? null
    : resolveAdvertiseHost(options.advertiseHost);
  const behaviors = Array.from(
    { length: options.followers },
    (_, i) =>
      parseSinkBehavior(options.rawBehaviors?.[i] ?? options.rawBehavior),
  );
  const server = serve({
    port: sinkBase?.port ?? 0,
    hostname: sinkBase?.bindHost ?? advertised?.bindHost ?? "127.0.0.1",
    silent: true,
    async fetch(request: Request): Promise<Response> {
      const match = /^\/inbox\/(\d+)(?:\/|$)/.exec(
        new URL(request.url).pathname,
      );
      if (match != null) {
        const behavior = behaviors[Number(match[1])] ??
          parseSinkBehavior(options.rawBehavior);
        await request.arrayBuffer().catch(() => {});
        if (behavior.latencyMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, behavior.latencyMs)
          );
        }
        return new Response("accepted", { status: behavior.status });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  await server.ready();
  const bound = new URL(server.url!);
  const base = sinkBase?.base ??
    (advertised == null
      ? bound
      : new URL(`http://${advertised.urlHost}:${bound.port}/`));
  const recipients = Array.from({ length: options.followers }, (_, i) => ({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Service",
    id: new URL(`/actors/${i}`, base).href,
    inbox: new URL(`/inbox/${i}`, base).href,
  }));
  return {
    recipients,
    close: () => server.close(true),
  };
}

interface SinkBase {
  readonly base: URL;
  readonly bindHost: string;
  readonly port: number;
}

export function resolveSinkBase(
  scenarioName: string,
  value: string | undefined,
): SinkBase | null {
  if (value == null) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `Scenario "${scenarioName}": sinkBase must be an http URL with an ` +
        `explicit port; got ${JSON.stringify(value)}.`,
    );
  }
  const port = Number(url.port);
  if (
    url.protocol !== "http:" ||
    url.hostname === "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port === "" ||
    !Number.isInteger(port) ||
    port < 1 ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      `Scenario "${scenarioName}": sinkBase must be an http URL with a ` +
        "host, an explicit non-zero port, no credentials, and no path, " +
        `query, or fragment; got ${JSON.stringify(value)}.`,
    );
  }
  const advertised = resolveAdvertiseHost(url.hostname);
  return {
    base: new URL(`http://${advertised.urlHost}:${url.port}/`),
    bindHost: advertised.bindHost,
    port,
  };
}

function parseSinkBehavior(
  raw: unknown,
): { latencyMs: number; status: number } {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { latencyMs: 0, status: 202 };
  }
  const record = raw as Record<string, unknown>;
  const latency = record.latency;
  const status = record.status;
  let latencyMs = 0;
  if (typeof latency === "string") {
    try {
      latencyMs = parseDuration(latency);
    } catch {
      latencyMs = 0;
    }
  }
  return {
    latencyMs,
    status: typeof status === "number" && Number.isInteger(status)
      ? status
      : 202,
  };
}

interface DrainResult {
  readonly timedOut: boolean;
  readonly failed: number;
}

async function waitForDrain(options: {
  readonly target: URL;
  readonly fetch: typeof fetch;
  readonly baseline: Awaited<ReturnType<typeof fetchServerSnapshot>>;
  readonly timeoutMs: number;
}): Promise<DrainResult | null> {
  if (options.baseline == null) return null;
  const baselineRemaining = queueTaskRemaining(options.baseline) ?? 0;
  const deadline = Date.now() + options.timeoutMs;
  do {
    const snapshot = await fetchServerSnapshot(options.target, options.fetch);
    if (snapshot != null) {
      const diff = diffSnapshots(options.baseline, snapshot);
      const queueTasks = diff.queueTasks;
      const remaining = queueTaskRemaining(diff, baselineRemaining);
      if (
        queueTasks != null &&
        queueTasks.enqueued > 0 &&
        remaining != null &&
        remaining === 0
      ) {
        return { timedOut: false, failed: queueTasks.failed };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
  } while (Date.now() < deadline);
  return { timedOut: true, failed: 0 };
}

function addQueueDrain(
  server: ServerMetrics | null,
  histogram: LogLinearHistogram,
): ServerMetrics | null {
  if (histogram.count < 1) return server;
  const queue = {
    ...(server?.queue ?? {}),
    drainMs: partialFromHistogram(histogram),
  };
  return { ...(server ?? {}), queue };
}

function partialFromHistogram(histogram: LogLinearHistogram): PartialLatencyMs {
  return {
    p50: histogram.percentile(50),
    p95: histogram.percentile(95),
    p99: histogram.percentile(99),
  };
}
