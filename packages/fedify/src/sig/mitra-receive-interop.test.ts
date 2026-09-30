// Mitra authenticates transport with its gateway HTTP key; the portable actor,
// Create, and Note proofs are produced by the Fedify C2S client before Mitra
// forwards them.  This fixture does not claim Mitra generated those DID proofs.
import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, Person } from "@fedify/vocab";
import {
  canonicalizePortableUri,
  decodeMultibase,
  importDidKey,
} from "@fedify/vocab-runtime";
import serialize from "json-canon";
import { assert, assertEquals } from "@std/assert";
import { encodeHex } from "byte-encodings/hex";
import { createFederation } from "../federation/middleware.ts";
import { MemoryKvStore } from "../federation/kv.ts";
import actor from "../../test-vectors/fep-ef61/mitra-v5.10.0/receive/actor.json" with {
  type: "json",
};
import captured from "../../test-vectors/fep-ef61/mitra-v5.10.0/receive/request.json" with {
  type: "json",
};
import metadata from "../../test-vectors/fep-ef61/mitra-v5.10.0/receive/metadata.json" with {
  type: "json",
};
import rawBodies from "../../test-vectors/fep-ef61/mitra-v5.10.0/receive/raw-bodies.json" with {
  type: "json",
};
import liveResponse from "../../test-vectors/fep-ef61/mitra-v5.10.0/receive/response.json" with {
  type: "json",
};
import liveListener from "../../test-vectors/fep-ef61/mitra-v5.10.0/receive/listener.json" with {
  type: "json",
};
import liveVerification from "../../test-vectors/fep-ef61/mitra-v5.10.0/receive/verification.json" with {
  type: "json",
};
import actorResponse from "../../test-vectors/fep-ef61/mitra-v5.10.0/receive/actor-response.json" with {
  type: "json",
};
import { verifyRequestDetailed } from "./http.ts";
import { doesActorOwnKey } from "./owner.ts";
import { verifyPortableObjectProof } from "./proof.ts";

const body = rawBodies.requestBody;
const activity = JSON.parse(body);

async function sha256(value: string): Promise<string> {
  return encodeHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

// Verifies the exact JSON maps without Fedify's outgoing-normalization fallback.
async function verifyRawJcs(
  document: Record<string, unknown>,
): Promise<boolean> {
  const { proof, ...unsecured } = document;
  assert(proof != null && typeof proof === "object" && !Array.isArray(proof));
  const { proofValue, ...configuration } = proof as Record<string, unknown>;
  assertEquals(configuration.cryptosuite, "eddsa-jcs-2022");
  configuration["@context"] ??= document["@context"];
  assert(typeof configuration.verificationMethod === "string");
  assert(typeof proofValue === "string");
  const key = await importDidKey(
    configuration.verificationMethod.split("#")[0],
  );
  const combined = new Uint8Array(64);
  combined.set(await digest(serialize(configuration)), 0);
  combined.set(await digest(serialize(unsecured)), 32);
  return await crypto.subtle.verify(
    "Ed25519",
    key,
    new Uint8Array(decodeMultibase(proofValue)),
    combined,
  );
}

function loader(document: unknown = actor) {
  return (url: string) => {
    assertEquals(url.split("#")[0], metadata.httpKeyId.split("#")[0]);
    return Promise.resolve({
      document: structuredClone(document),
      documentUrl: metadata.httpKeyId.split("#")[0],
      contextUrl: null,
    });
  };
}

const options = {
  documentLoader: loader(),
  contextLoader: mockDocumentLoader,
  currentTime: Temporal.Instant.from(captured.capturedAt),
};

function request(
  requestBody = body,
  url = captured.url,
  headers = new Headers(captured.headers as [string, string][]),
): Request {
  return new Request(url, {
    method: captured.method,
    headers,
    body: requestBody,
  });
}

async function deliver(requestBody: string) {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => loader(),
    contextLoaderFactory: () => mockDocumentLoader,
    // HTTP time validation is tested separately at the capture time.
    signatureTimeWindow: false,
  });
  federation.setActorDispatcher(
    "/users/{identifier}",
    (ctx, identifier) =>
      identifier === "alice"
        ? new Person({
          id: ctx.getActorUri(identifier),
          inbox: ctx.getInboxUri(identifier),
        })
        : null,
  ).setKeyPairsDispatcher(() => []);
  const received: Create[] = [];
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Create, (_ctx, create) => {
      received.push(create);
    });
  const response = await federation.fetch(request(requestBody), {
    contextData: undefined,
  });
  return { response, received };
}

test("Mitra v5.10.0 forwarded client-proved Create verifies its proof and HTTP signature", async () => {
  const actorBody = rawBodies.actorBody;
  assertEquals(
    await sha256(body),
    metadata.sha256.requestBody,
  );
  assertEquals(
    await sha256(actorBody),
    metadata.sha256.actorBody,
  );
  assertEquals(JSON.parse(actorBody), actor);
  assertEquals(actorResponse.status, 200);
  assertEquals(actorResponse.url, metadata.httpKeyId);
  assertEquals(liveVerification.verified, true);
  assertEquals(liveVerification.key, metadata.httpKeyId);
  assertEquals(activity.type, "Create");
  assertEquals(actor.type, "Person");
  assert((await verifyPortableObjectProof(activity.object, options)).verified);
  assertEquals(activity.actor, actor.id);
  assert(await verifyRawJcs(actor));
  assert(await verifyRawJcs(activity));
  assert(await verifyRawJcs(activity.object));
  assert((await verifyPortableObjectProof(actor, options)).verified);
  assert((await verifyPortableObjectProof(activity, options)).verified);
  const verified = await verifyRequestDetailed(request(), options);
  assert(verified.verified);
  assertEquals(verified.key.id?.href, metadata.httpKeyId);
  assert(verified.key.id?.href !== actor.publicKey.id);
  const parsed = await Create.fromJsonLd(activity, options);
  assert(await doesActorOwnKey(parsed, verified.key, options));
  assertEquals(captured.capturedAt, metadata.capturedAt);
});

test("Mitra v5.10.0 forwarded client-proved Create reaches the Fedify inbox listener", async () => {
  assertEquals(liveResponse.status, 202);
  assertEquals(liveListener.type, "Create");
  assertEquals(
    canonicalizePortableUri(liveListener.id),
    canonicalizePortableUri(activity.id),
  );
  assertEquals(
    canonicalizePortableUri(liveListener.actor),
    canonicalizePortableUri(activity.actor),
  );
  const { response, received } = await deliver(body);
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assert(received[0].id != null);
  assertEquals(
    canonicalizePortableUri(received[0].id.href),
    canonicalizePortableUri(activity.id),
  );
  assert(received[0].actorId != null);
  assertEquals(
    canonicalizePortableUri(received[0].actorId.href),
    canonicalizePortableUri(actor.id),
  );
});

test("Mitra v5.10.0 forwarded client-proved Create rejects body tampering", async () => {
  const tampered = {
    ...activity,
    object: { ...activity.object, content: "Tampered received Note" },
  };
  assertEquals(
    (await verifyPortableObjectProof(tampered, options)).verified,
    false,
  );
  assertEquals(await verifyRawJcs(tampered), false);
  assertEquals(await verifyRawJcs(tampered.object), false);
  const changedBody = JSON.stringify(tampered);
  assertEquals(
    (await verifyRequestDetailed(request(changedBody), options)).verified,
    false,
  );
  const { response, received } = await deliver(changedBody);
  assertEquals(response.status, 401);
  assertEquals(received.length, 0);
});

test("Mitra v5.10.0 forwarded client-proved Create rejects signed header and path tampering", async () => {
  const headers = new Headers(captured.headers as [string, string][]);
  headers.set(
    "Date",
    new Date(
      Date.parse(
        new Headers(captured.headers as [string, string][]).get("Date")!,
      ) + 1000,
    ).toUTCString(),
  );
  assertEquals(
    (await verifyRequestDetailed(request(body, captured.url, headers), options))
      .verified,
    false,
  );
  assertEquals(
    (await verifyRequestDetailed(
      request(body, `${captured.url}/tampered`),
      options,
    )).verified,
    false,
  );
});

test("Mitra v5.10.0 forwarded client-proved Create rejects a tampered actor proof", async () => {
  const tampered = { ...actor, preferredUsername: "mallory" };
  assertEquals(await verifyRawJcs(tampered), false);
  assertEquals(
    (await verifyPortableObjectProof(tampered, options)).verified,
    false,
  );
  assertEquals(
    (await verifyRequestDetailed(request(), {
      ...options,
      documentLoader: loader(tampered),
    })).verified,
    false,
  );
});
