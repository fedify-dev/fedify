import {
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import { Create, Person } from "@fedify/vocab";
import { exportDidKey, parseIri } from "@fedify/vocab-runtime";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import { createFederationBuilder } from "./builder.ts";
import type { InboxRequestReport } from "./inbox-report.ts";
import { MemoryKvStore } from "./kv.ts";
import { ContextImpl, createFederation } from "./middleware.ts";
import type { Message } from "./queue.ts";
import { signRequest } from "../sig/http.ts";
import { signJsonLd } from "../sig/ld.ts";
import { signObject } from "../sig/proof.ts";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  rsaPrivateKey2,
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";

const loaders = {
  documentLoader: mockDocumentLoader,
  contextLoader: mockDocumentLoader,
};
function setup(skipSignatureVerification = false) {
  const reports: InboxRequestReport[] = [];
  const [tracerProvider, spanExporter] = createTestTracerProvider();
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    skipSignatureVerification,
    tracerProvider,
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, id) => id === "missing" ? null : new Person({}),
  ).setKeyPairsDispatcher(() => []);
  const setters = federation.setInboxListeners(
    "/users/{identifier}/inbox",
    "/inbox",
  ).onRequestFinished((_ctx, report) => {
    reports.push(report);
  });
  return { federation, setters, reports, spanExporter };
}
async function payload(
  id = "https://example.com/create",
  actor = "https://example.com/person2",
) {
  return await new Create({ id: new URL(id), actor: new URL(actor) }).toJsonLd(
    loaders,
  );
}
function request(body: unknown, path = "/inbox") {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/activity+json" },
  });
}

test("onRequestFinished classifies early rejection, JSON null, and excluded routes", async () => {
  const { federation, reports } = setup(true);
  strictEqual(
    (await federation.fetch(request({}, "/users/missing/inbox"), {
      contextData: undefined,
    })).status,
    404,
  );
  deepStrictEqual(reports[0].inbox, { kind: "personal", recipient: "missing" });
  deepStrictEqual(reports[0].payload, { status: "unavailable" });
  deepStrictEqual(reports[0].authentication, { status: "notDetermined" });
  deepStrictEqual(reports[0].outcome, {
    type: "response",
    status: 404,
    disposition: "rejected",
    reason: "recipientNotFound",
  });
  strictEqual(
    (await federation.fetch(request(null), { contextData: undefined })).status,
    400,
  );
  deepStrictEqual(reports[1].payload, { status: "parsed", value: null });
  deepStrictEqual(reports[1].authentication, { status: "notDetermined" });
  await federation.fetch(new Request("https://example.com/users/alice/inbox"), {
    contextData: undefined,
  });
  await federation.fetch(request({}, "/unmatched"), { contextData: undefined });
  strictEqual(reports.length, 2);
  await federation.fetch(
    new Request("https://example.com/inbox", { method: "POST", body: "{" }),
    { contextData: undefined },
  );
  deepStrictEqual(reports[2].outcome, {
    type: "response",
    status: 400,
    disposition: "rejected",
    reason: "invalidJson",
  });
});

test("onRequestFinished leaves deferred policy errors undetermined", async () => {
  const did = await exportDidKey(ed25519Multikey.publicKey!);
  const keyId = parseIri(`${did}#${did.substring("did:key:".length)}`);
  const otherPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const otherDid = await exportDidKey(otherPair.publicKey);
  for (const withProof of [false, true]) {
    const contextUrl = `https://example.com/context/deferred-${withProof}`;
    const remote = {
      contextUrl: null,
      documentUrl: contextUrl,
      document: { "@context": { ext: "https://example.com/ext" } },
    };
    const contextLoader = (url: string) =>
      url === contextUrl ? Promise.resolve(remote) : mockDocumentLoader(url);
    const activity = new Create({
      id: parseIri(
        `ap+ef61://${
          withProof ? otherDid : did
        }/activities/deferred-${withProof}`,
      ),
      actor: parseIri(`ap+ef61://${did}/users/bob`),
    });
    const context = [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      contextUrl,
    ];
    const body = withProof
      ? await (await signObject(activity, ed25519PrivateKey, keyId, {
        context,
        contextLoader,
      })).toJsonLd({ format: "compact", context, contextLoader })
      : await activity.toJsonLd({ format: "compact", context, contextLoader });
    (body as Record<string, unknown>).signature = {
      type: "RsaSignature2017",
      creator: rsaPublicKey3.id!.href,
      created: "2024-01-01T00:00:00Z",
      signatureValue: "bogus",
    };
    let failOnce = true;
    const reports: InboxRequestReport[] = [];
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      documentLoaderFactory: () => mockDocumentLoader,
      contextLoaderFactory: () => async (url) => {
        if (url === contextUrl && failOnce) {
          failOnce = false;
          throw new Error("Temporary context outage");
        }
        return await contextLoader(url);
      },
    });
    federation.setActorDispatcher("/users/{identifier}", () => new Person({}))
      .setKeyPairsDispatcher(() => []);
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(Create, () => {})
      .onRequestFinished((_ctx, report) => {
        reports.push(report);
      });
    const signed = await signRequest(
      request(body),
      rsaPrivateKey3,
      rsaPublicKey3.id!,
    );
    await rejects(
      federation.fetch(signed, { contextData: undefined }),
      (error) => {
        strictEqual(reports.length, 1);
        deepStrictEqual(reports[0].authentication, { status: "notDetermined" });
        ok(reports[0].outcome.type === "exception");
        strictEqual(reports[0].outcome.stage, "policy");
        strictEqual(reports[0].outcome.error, error);
        return true;
      },
    );
    strictEqual(
      reports[0].attempts.some((attempt) =>
        attempt.mechanism === "objectIntegrity" && attempt.status === "verified"
      ),
      withProof,
    );
  }
});

test("onRequestFinished awaits once and isolates observer failures", async () => {
  const { federation, setters } = setup(true);
  setters.on(Create, () => {});
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  setters.onRequestFinished(async (_ctx, report) => {
    calls++;
    deepStrictEqual(report.authentication, { status: "skipped" });
    strictEqual(
      report.outcome.type === "response" && report.outcome.disposition,
      "processed",
    );
    entered();
    await gate;
    throw new Error("observer failed");
  });
  let finished = false;
  const response = federation.fetch(request(await payload()), {
    contextData: undefined,
  }).then((response) => {
    finished = true;
    return response;
  });
  await started;
  strictEqual(finished, false);
  release();
  strictEqual((await response).status, 202);
  strictEqual(calls, 1);
});

test("onRequestFinished preserves preparation exceptions and callback replacement", async () => {
  const { federation, setters, reports } = setup();
  const error = new Error("preparation failed");
  setters.setSharedKeyDispatcher(() => {
    throw error;
  });
  setters.onRequestFinished((_ctx, report) => {
    reports.push(report);
    throw new Error("secondary failure");
  });
  await rejects(
    federation.fetch(request(await payload()), { contextData: undefined }),
    (value) => value === error,
  );
  strictEqual(reports.length, 1);
  deepStrictEqual(reports[0].outcome, {
    type: "exception",
    stage: "prepare",
    error,
  });
  deepStrictEqual(reports[0].authentication, { status: "notDetermined" });
});

test("onRequestFinished distinguishes custom responses from authentication", async () => {
  const { federation, setters, reports } = setup();
  setters.onUnverifiedActivity(() => new Response(null, { status: 202 }));
  const body = await payload();
  strictEqual(
    (await federation.fetch(request(body), { contextData: undefined })).status,
    202,
  );
  deepStrictEqual(reports[0].authentication, {
    status: "rejected",
    reason: { type: "verificationFailed" },
  });
  deepStrictEqual(reports[0].outcome, {
    type: "response",
    status: 202,
    disposition: "customResponse",
  });
  strictEqual(reports[0].attempts.at(-1)?.mechanism, "http");
  setters.onUnverifiedActivity(() => {});
  strictEqual(
    (await federation.fetch(request(body), { contextData: undefined })).status,
    401,
  );
  strictEqual(
    reports[1].outcome.type === "response" && reports[1].outcome.disposition,
    "rejected",
  );
});

test("onRequestFinished retains HTTP keys and separates ownership rejection", async () => {
  const { federation, setters, reports } = setup();
  setters.on(Create, () => {});
  const body = await payload();
  const signed = await signRequest(
    request(body),
    rsaPrivateKey3,
    new URL("https://example.com/person2#key3"),
  );
  strictEqual(
    (await federation.fetch(signed, { contextData: undefined })).status,
    202,
  );
  const report = reports[0];
  strictEqual(report.authentication.status, "verified");
  const attempt = report.attempts.find((attempt) =>
    attempt.mechanism === "http"
  );
  ok(attempt?.status === "verified");
  strictEqual(attempt.subject.id?.href, "https://example.com/create");
  const check = attempt.checks[0];
  ok(check.status === "verified" && check.key.type === "cryptographicKey");
  strictEqual(check.key.publicKey.algorithm.name, "RSASSA-PKCS1-v1_5");
  strictEqual(check.key.ownerId?.href, "https://example.com/person2");
  strictEqual(check.key, check.triedKeys.at(-1));
  strictEqual(attempt.signatures[0], check);
  strictEqual(report.authentication.attempts[0], attempt);
  // Same request ID produces a duplicate without losing authentication.
  await federation.fetch(signed, { contextData: undefined });
  deepStrictEqual(reports[1].outcome, {
    type: "response",
    status: 202,
    disposition: "duplicate",
  });
  const mismatched = await signRequest(
    request(
      await payload("https://example.com/other", "https://example.com/person"),
    ),
    rsaPrivateKey3,
    new URL("https://example.com/person2#key3"),
  );
  strictEqual(
    (await federation.fetch(mismatched, { contextData: undefined })).status,
    401,
  );
  strictEqual(reports[2].authentication.status, "rejected");
  ok(reports[2].authentication.status === "rejected");
  strictEqual(reports[2].authentication.reason.type, "actorKeyMismatch");
  strictEqual(reports[2].attempts.at(-1)?.status, "verified");
});

test("onRequestFinished reports an activity ID on another origin than its actor", async () => {
  const { federation, setters, reports, spanExporter } = setup();
  let dispatched = false;
  setters.on(Create, () => {
    dispatched = true;
  });
  const signed = await signRequest(
    request(await payload("https://other.example/create")),
    rsaPrivateKey3,
    new URL("https://example.com/person2#key3"),
  );
  strictEqual(
    (await federation.fetch(signed, { contextData: undefined })).status,
    401,
  );
  strictEqual(dispatched, false);
  deepStrictEqual(reports[0].authentication, {
    status: "rejected",
    reason: {
      type: "activity-origin-mismatch",
      activityId: new URL("https://other.example/create"),
      actorIds: [new URL("https://example.com/person2")],
    },
  });
  deepStrictEqual(reports[0].outcome, {
    type: "response",
    status: 401,
    disposition: "rejected",
    reason: "authentication",
  });
  strictEqual(reports[0].attempts.at(-1)?.status, "verified");
  strictEqual(
    spanExporter.getSpans("activitypub.inbox")[0]
      .attributes["activitypub.verification.failure_reason"],
    "activity-origin-mismatch",
  );
});

test("onRequestFinished retains LDS crypto success before HTTP fallback", async () => {
  const { federation, reports } = setup();
  const body = await signJsonLd(
    await payload("https://example.com/lds", "https://example.com/person"),
    rsaPrivateKey3,
    new URL("https://example.com/person2#key3"),
    loaders,
  );
  const signed = await signRequest(
    request(body),
    rsaPrivateKey2,
    new URL("https://example.com/key2"),
  );
  strictEqual(
    (await federation.fetch(signed, { contextData: undefined })).status,
    202,
  );
  const ld = reports[0].attempts.find((attempt) =>
    attempt.mechanism === "linkedData"
  );
  ok(ld?.status === "rejected");
  strictEqual(ld.reason.type, "uncoveredAttribution");
  strictEqual(ld.checks[0].status, "verified");
  strictEqual(reports[0].authentication.status, "verified");
});

test("onRequestFinished keeps valid OIP checks when attributions are uncovered", async () => {
  const { federation, reports } = setup();
  const activity = new Create({
    id: new URL("https://example.com/proof"),
    actor: new URL("https://example.com/person"),
  });
  const signed = await signObject(
    activity,
    ed25519PrivateKey,
    ed25519Multikey.id!,
    loaders,
  );
  strictEqual(
    (await federation.fetch(request(await signed.toJsonLd(loaders)), {
      contextData: undefined,
    })).status,
    401,
  );
  const proof = reports[0].attempts.find((attempt) =>
    attempt.mechanism === "objectIntegrity"
  );
  ok(proof?.status === "rejected");
  strictEqual(proof.reason.type, "uncoveredAttribution");
  const check = proof.checks[0];
  ok(check.status === "verified" && check.key.type === "multikey");
  strictEqual(check.key.controllerId?.href, "https://example.com/person2");
  strictEqual(reports[0].activity?.id?.href, activity.id?.href);
});

test("onRequestFinished reports listener failures with original values", async () => {
  const { federation, setters, reports } = setup(true);
  const error = new Error("listener failed");
  setters.on(Create, () => {
    throw error;
  });
  strictEqual(
    (await federation.fetch(request(await payload()), {
      contextData: undefined,
    })).status,
    500,
  );
  deepStrictEqual(reports[0].outcome, {
    type: "response",
    status: 500,
    disposition: "failed",
    reason: "listenerError",
    error,
  });
});

test("onRequestFinished builder snapshots callbacks", async () => {
  const builder = createFederationBuilder<void>();
  builder.setActorDispatcher("/users/{identifier}", () => new Person({}));
  const reports: InboxRequestReport[] = [];
  const setters = builder.setInboxListeners(
    "/users/{identifier}/inbox",
    "/inbox",
  ).onRequestFinished((_ctx, report) => {
    reports.push(report);
  });
  const federation = await builder.build({
    kv: new MemoryKvStore(),
    skipSignatureVerification: true,
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  setters.onRequestFinished(() => {
    throw new Error("new callback must not run");
  });
  await federation.fetch(request(await payload()), { contextData: undefined });
  strictEqual(reports.length, 1);
});

// The imported key objects stay intact when observers mutate their URL copies.
test("onRequestFinished key snapshots do not alias vocabulary metadata", async () => {
  const { snapshotKey } = await import("../sig/verification.ts");
  const snapshot = snapshotKey(rsaPublicKey2);
  snapshot.id!.pathname = "/changed";
  strictEqual(rsaPublicKey2.id!.href, "https://example.com/key2");
  const other = snapshotKey(rsaPublicKey3);
  strictEqual(other.publicKey, rsaPublicKey3.publicKey);
});

test("onRequestFinished reports enqueue acceptance without adding queue fields", async () => {
  const messages: unknown[] = [];
  const reports: InboxRequestReport[] = [];
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    skipSignatureVerification: true,
    manuallyStartQueue: true,
    queue: {
      inbox: {
        enqueue: (message) => {
          messages.push(message);
          return Promise.resolve();
        },
        listen: () => Promise.resolve(),
      },
    },
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  federation.setActorDispatcher("/users/{identifier}", () => new Person({}));
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .onRequestFinished((_ctx, report) => {
      reports.push(report);
    });
  strictEqual(
    (await federation.fetch(request(await payload()), {
      contextData: undefined,
    })).status,
    202,
  );
  deepStrictEqual(reports[0].outcome, {
    type: "response",
    status: 202,
    disposition: "enqueued",
  });
  strictEqual(messages.length, 1);
  ok(!("report" in (messages[0] as Record<string, unknown>)));
  ok(!("attempts" in (messages[0] as Record<string, unknown>)));
});

test("onRequestFinished preserves a non-Error value thrown during enqueue", async () => {
  const reports: InboxRequestReport[] = [];
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    skipSignatureVerification: true,
    manuallyStartQueue: true,
    queue: {
      inbox: {
        enqueue: () => Promise.reject(undefined),
        listen: () => Promise.resolve(),
      },
    },
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  federation.setActorDispatcher("/users/{identifier}", () => new Person({}));
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .onRequestFinished((_ctx, report) => {
      reports.push(report);
      throw new Error("observer failure");
    });
  let threw = false;
  try {
    await federation.fetch(request(await payload()), {
      contextData: undefined,
    });
  } catch (error) {
    threw = true;
    strictEqual(error, undefined);
  }
  strictEqual(threw, true);
  strictEqual(reports.length, 1);
  deepStrictEqual(reports[0].outcome, {
    type: "exception",
    stage: "dispatch",
    error: undefined,
  });
});

test("onRequestFinished runs with tracing disabled", async () => {
  const { AlwaysOffSampler, BasicTracerProvider } = await import(
    "@opentelemetry/sdk-trace-base"
  );
  const provider = new BasicTracerProvider({ sampler: new AlwaysOffSampler() });
  const reports: InboxRequestReport[] = [];
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    tracerProvider: provider,
    skipSignatureVerification: true,
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  federation.setActorDispatcher("/users/{identifier}", () => new Person({}));
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .onRequestFinished((_ctx, report) => {
      reports.push(report);
    });
  await federation.fetch(request(await payload()), { contextData: undefined });
  strictEqual(reports.length, 1);
  await provider.shutdown();
});

test("onRequestFinished preserves non-POST shared inbox behavior without reports", async () => {
  const { federation, reports } = setup(true);
  strictEqual(
    (await federation.fetch(
      new Request("https://example.com/inbox", {
        headers: { Accept: "application/activity+json" },
      }),
      { contextData: undefined },
    )).status,
    400,
  );
  strictEqual(reports.length, 0);
  strictEqual(
    (await federation.fetch(
      new Request("https://example.com/inbox", {
        method: "PUT",
        body: JSON.stringify(await payload()),
        headers: { Accept: "application/activity+json" },
      }),
      { contextData: undefined },
    )).status,
    202,
  );
  strictEqual(reports.length, 0);
});

test("onRequestFinished covers errors constructing the initial request context", async () => {
  const reports: InboxRequestReport[] = [];
  const error = new Error("loader factory failed");
  const federation = createFederation<string>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => {
      throw error;
    },
    contextLoaderFactory: () => mockDocumentLoader,
  });
  federation.setActorDispatcher("/users/{identifier}", () => new Person({}));
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .onRequestFinished((ctx, report) => {
      strictEqual(ctx.data, "data");
      strictEqual(ctx.request.url, "https://example.com/inbox");
      reports.push(report);
    });
  await rejects(
    federation.fetch(request({}), { contextData: "data" }),
    (value) => value === error,
  );
  strictEqual(reports.length, 1);
  deepStrictEqual(reports[0].outcome, {
    type: "exception",
    stage: "prepare",
    error,
  });
});

test("onRequestFinished observes the final response decoration result", async () => {
  const { federation, setters, reports } = setup();
  const redirect = Response.redirect("https://example.com/redirect", 302);
  // Bun permits mutations here; Deno and Node.js use immutable headers.
  let immutable = false;
  try {
    redirect.headers.set("X-Header-Probe", "probe");
  } catch {
    immutable = true;
  }
  setters.onUnverifiedActivity(() => redirect);
  const delivery = request(await payload());
  delivery.headers.set("Accept", "application/activity+json");
  let thrown: unknown;
  let response: Response | undefined;
  try {
    response = await federation.fetch(delivery, { contextData: undefined });
  } catch (error) {
    thrown = error;
  }
  strictEqual(reports.length, 1);
  if (immutable) {
    ok(thrown instanceof TypeError);
    deepStrictEqual(reports[0].outcome, {
      type: "exception",
      stage: "respond",
      error: thrown,
    });
  } else {
    strictEqual(thrown, undefined);
    strictEqual(response?.status, 302);
    deepStrictEqual(reports[0].outcome, {
      type: "response",
      status: 302,
      disposition: "customResponse",
    });
  }
});

test("inbox request cancellation snapshots preserve exact reasons without stopping processing", async (t) => {
  for (
    const [label, reason] of [
      ["live", undefined],
      ["object", { kind: "client disconnect" }],
      ["zero", 0],
      ["nan", NaN],
      ["symbol", Symbol("client")],
    ] as const
  ) {
    await t.step(label, async () => {
      const { federation, setters, reports } = setup(true);
      let processed = 0;
      setters.on(Create, () => {
        processed++;
      });
      const controller = new AbortController();
      const input = new Request(request(await payload()), {
        signal: controller.signal,
      });
      input.headers.set("X-Request-Id", "cancellation-case");
      if (label !== "live") controller.abort(reason);
      const response = await federation.fetch(input, {
        contextData: undefined,
      });
      strictEqual(response.status, 202);
      strictEqual(processed, 1);
      strictEqual(reports.length, 1);
      const report = reports[0];
      deepStrictEqual(report.outcome, {
        type: "response",
        status: 202,
        disposition: "processed",
      });
      deepStrictEqual(report.authentication, { status: "skipped" });
      strictEqual(report.payload.status, "parsed");
      strictEqual(report.requestId, "cancellation-case");
      ok(report.inboxRequestId);
      deepStrictEqual(report.local, {
        origin: "https://example.com",
        host: "example.com",
        hostname: "example.com",
        canonicalOrigin: "https://example.com",
      });
      ok(Object.isFrozen(report.local));
      ok(Object.isFrozen(report.requestCancellation));
      strictEqual(
        report.requestCancellation.type,
        label === "live" ? "not-aborted" : "aborted",
      );
      if (report.requestCancellation.type === "aborted") {
        ok(Object.is(report.requestCancellation.reason, reason));
        strictEqual(report.requestCancellation.reason, input.signal.reason);
      }
    });
  }
});

test("inbox request cancellation waits for processing and preserves original local facts", async () => {
  const { federation, setters, reports } = setup(true);
  let entered!: () => void;
  const listening = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  setters.on(Create, async (ctx) => {
    ok(ctx instanceof ContextImpl);
    ctx.url.hostname = "changed.example";
    entered();
    await gate;
  });
  const controller = new AbortController();
  const reason = Symbol("mid-processing disconnect");
  const input = new Request(request(await payload()), {
    signal: controller.signal,
  });
  const processing = federation.fetch(input, { contextData: undefined });
  try {
    await listening;
    controller.abort(reason);
    strictEqual(reports.length, 0);
    release();
    strictEqual((await processing).status, 202);
    strictEqual(reports.length, 1);
    deepStrictEqual(reports[0].outcome, {
      type: "response",
      status: 202,
      disposition: "processed",
    });
    deepStrictEqual(reports[0].requestCancellation, {
      type: "aborted",
      reason,
    });
    strictEqual(reports[0].local?.hostname, "example.com");
    controller.abort("later reason");
    await Promise.resolve();
    strictEqual(reports.length, 1);
    strictEqual(reports[0].local?.origin, "https://example.com");
  } finally {
    release();
    await processing;
  }
});

test("inbox request cancellation after report construction does not rewrite its snapshot", async () => {
  const { federation, setters, reports } = setup(true);
  setters.on(Create, () => {});
  let entered!: () => void;
  const observing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  setters.onRequestFinished(async (_ctx, report) => {
    reports.push(report);
    entered();
    await gate;
    throw new Error("recording failure");
  });
  const controller = new AbortController();
  const input = new Request(request(await payload()), {
    signal: controller.signal,
  });
  const processing = federation.fetch(input, { contextData: undefined });
  try {
    await observing;
    controller.abort({ kind: "late disconnect" });
    deepStrictEqual(reports[0].requestCancellation, { type: "not-aborted" });
    release();
    strictEqual((await processing).status, 202);
    await Promise.resolve();
    strictEqual(reports.length, 1);
    deepStrictEqual(reports[0].requestCancellation, { type: "not-aborted" });
    deepStrictEqual(reports[0].outcome, {
      type: "response",
      status: 202,
      disposition: "processed",
    });
  } finally {
    release();
    await processing;
  }
});

test("inbox request cancellation retains accepted queue work and its separate lifetime", async () => {
  const controller = new AbortController();
  const reason = Symbol("disconnect after acceptance");
  const messages: Message[] = [];
  const reports: InboxRequestReport[] = [];
  let processed = 0;
  let workerSignal: AbortSignal | undefined;
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    skipSignatureVerification: true,
    manuallyStartQueue: true,
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
    queue: {
      inbox: {
        enqueue(message) {
          messages.push(message);
          controller.abort(reason);
          return Promise.resolve();
        },
        listen: () => Promise.resolve(),
      },
    },
  });
  federation.setActorDispatcher("/users/{identifier}", () => new Person({}));
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Create, (ctx) => {
      processed++;
      workerSignal = Reflect.get(ctx, "signal");
    })
    .onRequestFinished((_ctx, report) => {
      reports.push(report);
    });
  const input = new Request(request(await payload()), {
    signal: controller.signal,
  });
  strictEqual(
    (await federation.fetch(input, { contextData: undefined })).status,
    202,
  );
  strictEqual(messages.length, 1);
  strictEqual(processed, 0);
  strictEqual(reports.length, 1);
  deepStrictEqual(reports[0].outcome, {
    type: "response",
    status: 202,
    disposition: "enqueued",
  });
  deepStrictEqual(reports[0].requestCancellation, { type: "aborted", reason });
  strictEqual(Object.hasOwn(messages[0], "signal"), false);
  strictEqual(Object.hasOwn(messages[0], "requestCancellation"), false);
  await federation.processQueuedTask(undefined, messages[0]);
  strictEqual(processed, 1);
  strictEqual(workerSignal?.aborted === true, false);
  strictEqual(reports.length, 1);
});

test("inbox request cancellation preserves early preparation failures and canonical source", async () => {
  const error = new Error("initial loader factory failed");
  const reason = { kind: "client disconnected" };
  const controller = new AbortController();
  const reports: InboxRequestReport[] = [];
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    origin: "https://canonical.example",
    documentLoaderFactory: () => {
      throw error;
    },
    contextLoaderFactory: () => mockDocumentLoader,
  });
  federation.setActorDispatcher("/users/{identifier}", () => new Person({}));
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .onRequestFinished((_ctx, report) => {
      reports.push(report);
    });
  const input = new Request(request({}), { signal: controller.signal });
  controller.abort(reason);
  await rejects(
    federation.fetch(input, { contextData: undefined }),
    (value: unknown) => value === error,
  );
  strictEqual(reports.length, 1);
  deepStrictEqual(reports[0].outcome, {
    type: "exception",
    stage: "prepare",
    error,
  });
  deepStrictEqual(reports[0].authentication, { status: "notDetermined" });
  deepStrictEqual(reports[0].payload, { status: "unavailable" });
  deepStrictEqual(reports[0].requestCancellation, { type: "aborted", reason });
  strictEqual(reports[0].local?.origin, "https://example.com");
  strictEqual(reports[0].local?.canonicalOrigin, "https://canonical.example");
});
