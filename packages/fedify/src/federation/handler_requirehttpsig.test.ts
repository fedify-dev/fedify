import { assertEquals } from "@std/assert";
import { signRequest } from "../sig/http.ts";
import {
  createInboxContext,
  createRequestContext,
} from "../testing/context.ts";
import { mockDocumentLoader } from "../testing/docloader.ts";
import { rsaPrivateKey3, rsaPublicKey3 } from "../testing/keys.ts";
import { test } from "../testing/mod.ts";
import { Create, Note, Person } from "../vocab/vocab.ts";
import type { ActorDispatcher } from "./callback.ts";
import { handleInbox } from "./handler.ts";
import { MemoryKvStore } from "./kv.ts";
import { createFederation } from "./middleware.ts";

test("handleInbox() with requireHttpSignature option", async () => {
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/person2"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      attribution: new URL("https://example.com/person2"),
      content: "Hello, world!",
    }),
  });

  const unsignedRequest = new Request("https://example.com/inbox", {
    method: "POST",
    headers: { "Content-Type": "application/activity+json" },
    body: JSON.stringify(await activity.toJsonLd()),
  });

  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const unsignedContext = createRequestContext({
    federation,
    request: unsignedRequest,
    url: new URL(unsignedRequest.url),
    data: undefined,
  });

  const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
    if (identifier !== "testuser") return null;
    return new Person({ name: "Test User" });
  };

  const onNotFound = () => new Response("Not found", { status: 404 });

  const baseInboxOptions = {
    kv: new MemoryKvStore(),
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"] as const,
      publicKey: ["_fedify", "publicKey"] as const,
    },
    actorDispatcher,
    onNotFound,
    signatureTimeWindow: { minutes: 5 } as const,
    skipSignatureVerification: false,
  };

  let response = await handleInbox(unsignedRequest, {
    recipient: null,
    context: unsignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...unsignedContext, clone: undefined });
    },
    ...baseInboxOptions,
    requireHttpSignature: false,
  });
  assertEquals(
    response.status,
    401,
    "Without HTTP Sig and no LD Sig/OIP, should return 401",
  );

  response = await handleInbox(unsignedRequest.clone() as Request, {
    recipient: null,
    context: unsignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...unsignedContext, clone: undefined });
    },
    ...baseInboxOptions,
    requireHttpSignature: true,
  });
  assertEquals(
    response.status,
    401,
    "With requireHttpSignature: true and no HTTP Sig, should return 401",
  );

  const signedRequest = await signRequest(
    unsignedRequest.clone() as Request,
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const signedContext = createRequestContext({
    federation,
    request: signedRequest,
    url: new URL(signedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
  });

  response = await handleInbox(signedRequest, {
    recipient: null,
    context: signedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...signedContext, clone: undefined });
    },
    ...baseInboxOptions,
    requireHttpSignature: true,
  });
  assertEquals(
    response.status,
    202,
    "With requireHttpSignature: true and valid HTTP Sig, should succeed",
  );

  // `skipSignatureVerification` takes precedence over `requireHttpSignature`
  response = await handleInbox(unsignedRequest.clone() as Request, {
    recipient: null,
    context: unsignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...unsignedContext, clone: undefined });
    },
    ...baseInboxOptions,
    skipSignatureVerification: true,
    requireHttpSignature: true,
  });
  assertEquals(
    response.status,
    202,
    "With skipSignatureVerification: true, should succeed even if requireHttpSignature: true",
  );
});
