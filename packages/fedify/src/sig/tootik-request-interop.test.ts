import { mockDocumentLoader, test } from "@fedify/fixture";
import { Follow, Person } from "@fedify/vocab";
import { assert, assertEquals } from "@std/assert";
import { encodeHex } from "byte-encodings/hex";
import { createFederation } from "../federation/middleware.ts";
import { MemoryKvStore } from "../federation/kv.ts";
import actor from "../../test-vectors/fep-ef61/tootik-v0.25.4/follow/actor.json" with {
  type: "json",
};
import captured from "../../test-vectors/fep-ef61/tootik-v0.25.4/follow/request.json" with {
  type: "json",
};
import metadata from "../../test-vectors/fep-ef61/tootik-v0.25.4/follow/metadata.json" with {
  type: "json",
};
import rawBodies from "../../test-vectors/fep-ef61/tootik-v0.25.4/follow/raw-bodies.json" with {
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

function loader(document: unknown = actor) {
  return (url: string) => {
    assertEquals(url.split("#")[0], actor.id);
    return Promise.resolve({
      document: structuredClone(document),
      documentUrl: actor.id,
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
  const received: Follow[] = [];
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Follow, (_ctx, follow) => {
      received.push(follow);
    });
  const response = await federation.fetch(request(requestBody), {
    contextData: undefined,
  });
  return { response, received };
}

test("tootik v0.25.4 captured Follow verifies its proof and HTTP signature", async () => {
  const actorBody = rawBodies.actorBody;
  assertEquals(
    await sha256(body),
    metadata.requestBodySha256,
  );
  assertEquals(
    await sha256(actorBody),
    metadata.actorBodySha256,
  );
  assertEquals(JSON.parse(actorBody), actor);
  assertEquals(activity.type, "Follow");
  assertEquals(actor.type, "Person");
  assertEquals(activity.actor, actor.id);
  assert((await verifyPortableObjectProof(activity, options)).verified);
  const verified = await verifyRequestDetailed(request(), options);
  assert(verified.verified);
  assertEquals(verified.key.id?.href, actor.publicKey.id);
  const parsed = await Follow.fromJsonLd(activity, options);
  assert(await doesActorOwnKey(parsed, verified.key, options));
  assertEquals(captured.capturedAt, metadata.capturedAt);
});

test("tootik v0.25.4 captured Follow reaches the Fedify inbox listener", async () => {
  const { response, received } = await deliver(body);
  assertEquals(response.status, 202);
  assertEquals(received.length, 1);
  assertEquals(received[0].id?.href, activity.id);
  assertEquals(received[0].actorId?.href, actor.id);
});

test("tootik v0.25.4 captured Follow rejects body tampering", async () => {
  const tampered = {
    ...activity,
    object: "https://fedify.example:18444/users/mallory",
  };
  assertEquals(
    (await verifyPortableObjectProof(tampered, options)).verified,
    false,
  );
  const changedBody = JSON.stringify(tampered);
  assertEquals(
    (await verifyRequestDetailed(request(changedBody), options)).verified,
    false,
  );
  const { response, received } = await deliver(changedBody);
  assertEquals(response.status, 401);
  assertEquals(received.length, 0);
});

test("tootik v0.25.4 captured Follow rejects signed header and path tampering", async () => {
  const headers = new Headers(captured.headers as [string, string][]);
  headers.set("Content-Type", "application/json");
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

test("tootik v0.25.4 captured Follow rejects a tampered actor proof", async () => {
  const tampered = { ...actor, preferredUsername: "mallory" };
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
