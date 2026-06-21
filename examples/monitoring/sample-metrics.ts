import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("fedify.monitoring.example", "1.0.0");

const createType = "https://www.w3.org/ns/activitystreams#Create";
const followType = "https://www.w3.org/ns/activitystreams#Follow";
const noteType = "https://www.w3.org/ns/activitystreams#Note";

const httpRequestCount = meter.createCounter(
  "fedify.http.server.request.count",
  { unit: "{request}" },
);
const httpRequestDuration = meter.createHistogram(
  "fedify.http.server.request.duration",
  { unit: "ms" },
);
const queueTaskEnqueued = meter.createCounter(
  "fedify.queue.task.enqueued",
  { unit: "{task}" },
);
const queueTaskStarted = meter.createCounter(
  "fedify.queue.task.started",
  { unit: "{task}" },
);
const queueTaskCompleted = meter.createCounter(
  "fedify.queue.task.completed",
  { unit: "{task}" },
);
const queueTaskFailed = meter.createCounter(
  "fedify.queue.task.failed",
  { unit: "{task}" },
);
const queueTaskDuration = meter.createHistogram(
  "fedify.queue.task.duration",
  { unit: "ms" },
);
const queueTaskInFlight = meter.createUpDownCounter(
  "fedify.queue.task.in_flight",
  { unit: "{task}" },
);
const queueDepth = meter.createObservableGauge(
  "fedify.queue.depth",
  { unit: "{message}" },
);
const deliverySent = meter.createCounter(
  "activitypub.delivery.sent",
  { unit: "{attempt}" },
);
const deliveryPermanentFailure = meter.createCounter(
  "activitypub.delivery.permanent_failure",
  { unit: "{failure}" },
);
const deliveryDuration = meter.createHistogram(
  "activitypub.delivery.duration",
  { unit: "ms" },
);
const inboxActivity = meter.createCounter(
  "activitypub.inbox.activity",
  { unit: "{activity}" },
);
const inboxProcessingDuration = meter.createHistogram(
  "activitypub.inbox.processing_duration",
  { unit: "ms" },
);
const outboxActivity = meter.createCounter(
  "activitypub.outbox.activity",
  { unit: "{activity}" },
);
const fanoutRecipients = meter.createHistogram(
  "activitypub.fanout.recipients",
  { unit: "{recipient}" },
);
const circuitBreakerStateChange = meter.createCounter(
  "activitypub.circuit_breaker.state_change",
  { unit: "{change}" },
);
const signatureVerificationFailure = meter.createCounter(
  "activitypub.signature.verification_failure",
  { unit: "{failure}" },
);
const signatureVerificationDuration = meter.createHistogram(
  "activitypub.signature.verification.duration",
  { unit: "ms" },
);
const signatureKeyFetchDuration = meter.createHistogram(
  "activitypub.signature.key_fetch.duration",
  { unit: "ms" },
);
const keyLookup = meter.createCounter(
  "activitypub.key.lookup",
  { unit: "{lookup}" },
);
const keyLookupDuration = meter.createHistogram(
  "activitypub.key.lookup.duration",
  { unit: "ms" },
);
const documentFetch = meter.createCounter(
  "activitypub.document.fetch",
  { unit: "{fetch}" },
);
const documentFetchDuration = meter.createHistogram(
  "activitypub.document.fetch.duration",
  { unit: "ms" },
);
const objectLookup = meter.createCounter(
  "activitypub.object.lookup",
  { unit: "{lookup}" },
);
const actorDiscovery = meter.createCounter(
  "activitypub.actor.discovery",
  { unit: "{discovery}" },
);
const actorDiscoveryDuration = meter.createHistogram(
  "activitypub.actor.discovery.duration",
  { unit: "ms" },
);
const webFingerLookup = meter.createCounter(
  "webfinger.lookup",
  { unit: "{lookup}" },
);
const webFingerLookupDuration = meter.createHistogram(
  "webfinger.lookup.duration",
  { unit: "ms" },
);
const webFingerHandle = meter.createCounter(
  "webfinger.handle",
  { unit: "{request}" },
);
const webFingerHandleDuration = meter.createHistogram(
  "webfinger.handle.duration",
  { unit: "ms" },
);
const processMemoryUsage = meter.createObservableGauge(
  "process.memory.usage",
  { unit: "By" },
);
const processCpuTime = meter.createCounter(
  "process.cpu.time",
  { unit: "s" },
);

type QueueRole = "inbox" | "outbox" | "fanout";
type QueueState = "queued" | "ready" | "delayed";

const queueRoles: QueueRole[] = ["inbox", "outbox", "fanout"];
const queueStates: QueueState[] = ["queued", "ready", "delayed"];
const queueDepthValues = new Map<string, number>();
const inFlightValues = new Map<QueueRole, number>(
  queueRoles.map((role) => [role, 0]),
);

queueDepth.addCallback((observableResult) => {
  for (const role of queueRoles) {
    for (const state of queueStates) {
      observableResult.observe(
        queueDepthValues.get(`${role}:${state}`) ?? 0,
        {
          "fedify.queue.role": role,
          "fedify.queue.backend": "InProcessMessageQueue",
          "fedify.queue.depth.state": state,
          "fedify.federation.instance_id": "sample",
        },
      );
    }
  }
});

processMemoryUsage.addCallback((observableResult) => {
  const usage = Deno.memoryUsage();
  observableResult.observe(usage.rss, { "process.memory.type": "rss" });
  observableResult.observe(
    usage.heapUsed,
    { "process.memory.type": "heap_used" },
  );
  observableResult.observe(
    usage.heapTotal,
    { "process.memory.type": "heap_total" },
  );
});

let tick = 0;

function wave(base: number, amplitude: number, divisor: number): number {
  return Math.max(0, Math.round(base + Math.sin(tick / divisor) * amplitude));
}

function recordQueueDepths(): void {
  for (const role of queueRoles) {
    const roleOffset = role === "inbox" ? 0 : role === "outbox" ? 8 : 3;
    queueDepthValues.set(`${role}:queued`, wave(24 + roleOffset, 10, 5));
    queueDepthValues.set(`${role}:ready`, wave(6 + roleOffset / 2, 3, 4));
    queueDepthValues.set(`${role}:delayed`, wave(3 + roleOffset / 4, 2, 7));

    const nextInFlight = wave(role === "outbox" ? 5 : 2, 2, 3);
    const previousInFlight = inFlightValues.get(role) ?? 0;
    queueTaskInFlight.add(nextInFlight - previousInFlight, {
      "fedify.queue.role": role,
      "fedify.queue.backend": "InProcessMessageQueue",
    });
    inFlightValues.set(role, nextInFlight);
  }
}

function recordHttpMetrics(): void {
  const requests = [
    { method: "GET", endpoint: "actor", route: "/users/{identifier}", ms: 18 },
    {
      method: "POST",
      endpoint: "inbox",
      route: "/users/{identifier}/inbox",
      ms: 85,
    },
    {
      method: "GET",
      endpoint: "webfinger",
      route: "/.well-known/webfinger",
      ms: 12,
    },
    {
      method: "GET",
      endpoint: "outbox",
      route: "/users/{identifier}/outbox",
      ms: 34,
    },
  ];
  for (const request of requests) {
    const statusCode = tick % 31 === 0 && request.endpoint === "inbox"
      ? 500
      : 200;
    const attrs = {
      "http.request.method": request.method,
      "fedify.endpoint": request.endpoint,
      "fedify.route.template": request.route,
      "http.response.status_code": statusCode,
    };
    httpRequestCount.add(1, attrs);
    httpRequestDuration.record(request.ms + wave(0, 8, 3), attrs);
  }
}

function recordQueueMetrics(): void {
  for (const role of queueRoles) {
    const attrs = {
      "fedify.queue.role": role,
      "fedify.queue.backend": "InProcessMessageQueue",
      "activitypub.activity.type": role === "inbox" ? followType : createType,
    };
    queueTaskEnqueued.add(role === "outbox" ? 3 : 1, {
      ...attrs,
      "fedify.queue.task.attempt": tick % 17 === 0 ? 1 : 0,
    });
    queueTaskStarted.add(role === "outbox" ? 2 : 1, attrs);
    queueTaskCompleted.add(role === "outbox" ? 2 : 1, {
      ...attrs,
      "fedify.queue.task.result": "completed",
    });
    queueTaskDuration.record(role === "outbox" ? 140 + wave(0, 35, 4) : 45, {
      ...attrs,
      "fedify.queue.task.result": "completed",
    });
  }

  if (tick % 23 === 0) {
    queueTaskFailed.add(1, {
      "fedify.queue.role": "outbox",
      "fedify.queue.backend": "InProcessMessageQueue",
      "activitypub.activity.type": createType,
      "fedify.queue.task.result": "failed",
    });
  }
}

function recordActivityMetrics(): void {
  inboxActivity.add(2, {
    "activitypub.processing.result": "processed",
    "activitypub.activity.type": followType,
  });
  inboxProcessingDuration.record(55 + wave(0, 25, 4), {
    "activitypub.activity.type": followType,
  });
  if (tick % 19 === 0) {
    inboxActivity.add(1, {
      "activitypub.processing.result": "rejected",
      "activitypub.activity.type": noteType,
    });
  }

  outboxActivity.add(3, {
    "activitypub.processing.result": "queued",
    "activitypub.activity.type": createType,
  });
  if (tick % 13 === 0) {
    outboxActivity.add(1, {
      "activitypub.processing.result": "retried",
      "activitypub.activity.type": createType,
    });
  }
  fanoutRecipients.record(4 + (tick % 8), {
    "activitypub.activity.type": createType,
  });
}

function recordDeliveryMetrics(): void {
  const hosts = ["mastodon.example", "pixelfed.example", "misskey.example"];
  for (const host of hosts) {
    const success = !(tick % 11 === 0 && host === "misskey.example");
    const attrs = {
      "activitypub.remote.host": host,
      "activitypub.delivery.success": success,
      "activitypub.activity.type": createType,
    };
    deliverySent.add(host === "mastodon.example" ? 4 : 1, attrs);
    deliveryDuration.record(success ? 130 + wave(0, 40, 6) : 950, attrs);
  }

  if (tick % 29 === 0) {
    deliveryPermanentFailure.add(1, {
      "activitypub.remote.host": "gone.example",
      "http.response.status_code": 410,
    });
  }
  if (tick % 31 === 0) {
    circuitBreakerStateChange.add(1, {
      "activitypub.remote.host": "slow.example",
      "activitypub.circuit_breaker.state": "open",
    });
  }
}

function recordSignatureAndLookupMetrics(): void {
  signatureVerificationDuration.record(4 + wave(0, 3, 3), {
    "activitypub.signature.kind": "http",
    "activitypub.signature.result": "verified",
    "http_signatures.algorithm": "rsa-sha256",
  });
  signatureKeyFetchDuration.record(18 + wave(0, 7, 5), {
    "activitypub.signature.kind": "http",
    "activitypub.signature.key_fetch.result": tick % 5 === 0
      ? "fetched"
      : "hit",
  });
  if (tick % 37 === 0) {
    signatureVerificationFailure.add(1, {
      "activitypub.verification.failure_reason": "keyFetchError",
      "activitypub.remote.host": "keys.example",
    });
    signatureVerificationDuration.record(260, {
      "activitypub.signature.kind": "http",
      "activitypub.signature.result": "rejected",
      "http_signatures.failure_reason": "keyFetchError",
    });
  }

  keyLookup.add(1, {
    "activitypub.lookup.kind": "public_key",
    "activitypub.lookup.result": "fetched",
    "activitypub.remote.host": "keys.example",
    "activitypub.cache.enabled": true,
    "http.response.status_code": 200,
  });
  keyLookupDuration.record(24 + wave(0, 9, 4), {
    "activitypub.lookup.kind": "public_key",
    "activitypub.lookup.result": "fetched",
    "activitypub.remote.host": "keys.example",
    "activitypub.cache.enabled": true,
    "http.response.status_code": 200,
  });

  documentFetch.add(1, {
    "activitypub.lookup.kind": "object",
    "activitypub.lookup.result": "fetched",
    "activitypub.remote.host": "objects.example",
    "activitypub.cache.enabled": true,
    "http.response.status_code": 200,
  });
  documentFetchDuration.record(42 + wave(0, 12, 6), {
    "activitypub.lookup.kind": "object",
    "activitypub.lookup.result": "fetched",
    "activitypub.remote.host": "objects.example",
    "activitypub.cache.enabled": true,
    "http.response.status_code": 200,
  });
  objectLookup.add(1, {
    "activitypub.lookup.kind": tick % 4 === 0 ? "actor" : "object",
    "activitypub.remote.host": "objects.example",
  });
}

function recordDiscoveryMetrics(): void {
  actorDiscovery.add(1, {
    "activitypub.actor.discovery.result": "resolved",
    "activitypub.remote.host": "mastodon.example",
  });
  actorDiscoveryDuration.record(60 + wave(0, 20, 5), {
    "activitypub.actor.discovery.result": "resolved",
    "activitypub.remote.host": "mastodon.example",
  });
  webFingerLookup.add(1, {
    "webfinger.lookup.result": "found",
    "webfinger.resource.scheme": "acct",
    "activitypub.remote.host": "mastodon.example",
    "http.response.status_code": 200,
  });
  webFingerLookupDuration.record(38 + wave(0, 14, 5), {
    "webfinger.lookup.result": "found",
    "webfinger.resource.scheme": "acct",
    "activitypub.remote.host": "mastodon.example",
    "http.response.status_code": 200,
  });
  webFingerHandle.add(1, {
    "webfinger.handle.result": "resolved",
    "webfinger.resource.scheme": "acct",
    "http.response.status_code": 200,
  });
  webFingerHandleDuration.record(10 + wave(0, 4, 4), {
    "webfinger.handle.result": "resolved",
    "webfinger.resource.scheme": "acct",
    "http.response.status_code": 200,
  });

  if (tick % 41 === 0) {
    actorDiscovery.add(1, {
      "activitypub.actor.discovery.result": "not_found",
      "activitypub.remote.host": "missing.example",
    });
    webFingerLookup.add(1, {
      "webfinger.lookup.result": "not_found",
      "webfinger.resource.scheme": "acct",
      "activitypub.remote.host": "missing.example",
      "http.response.status_code": 404,
    });
  }
}

function recordResourceMetrics(): void {
  processCpuTime.add(0.02 + (tick % 5) / 100, {
    "process.cpu.state": "user",
  });
  processCpuTime.add(0.01, { "process.cpu.state": "system" });
}

function recordAll(): void {
  tick++;
  recordQueueDepths();
  recordHttpMetrics();
  recordQueueMetrics();
  recordActivityMetrics();
  recordDeliveryMetrics();
  recordSignatureAndLookupMetrics();
  recordDiscoveryMetrics();
  recordResourceMetrics();
}

recordAll();
const interval = setInterval(recordAll, 1000);

if (Deno.build.os !== "windows") {
  Deno.addSignalListener("SIGTERM", () => {
    clearInterval(interval);
    Deno.exit(0);
  });
}

console.log("Fedify monitoring sample metrics are being exported over OTLP.");
await new Promise(() => {});
