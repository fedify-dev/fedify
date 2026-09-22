import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create } from "@fedify/vocab";
import { encodeMultibase } from "@fedify/vocab-runtime";
import { assertEquals } from "@std/assert";
import serialize from "json-canon";
import vector from "../../test-vectors/fep-8b32/map-local-create-note.json" with {
  type: "json",
};
import {
  createInboxContext,
  createRequestContext,
} from "../testing/context.ts";
import { rsaPrivateKey3, rsaPublicKey3 } from "../testing/keys.ts";
import { signRequest } from "../sig/http.ts";
import { signJsonLd } from "../sig/ld.ts";
import { ActivityListenerSet } from "./activity-listener.ts";
import type { InboxContext } from "./context.ts";
import { createFederation } from "./middleware.ts";
import { handleInbox } from "./handler.ts";
import { MemoryKvStore } from "./kv.ts";

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function secureDocument(
  unsecuredDocument: Record<string, unknown>,
  privateJwk: JsonWebKey,
  verificationMethod: string,
): Promise<Record<string, unknown>> {
  const proofConfiguration = {
    "@context": unsecuredDocument["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod,
    proofPurpose: "assertionMethod",
    created: "2023-02-24T23:36:38Z",
  };
  const proofHash = await sha256(serialize(proofConfiguration));
  const documentHash = await sha256(serialize(unsecuredDocument));
  const input = new Uint8Array(64);
  input.set(proofHash);
  input.set(documentHash, proofHash.length);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    "Ed25519",
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("Ed25519", privateKey, input),
  );
  return {
    ...unsecuredDocument,
    proof: {
      ...proofConfiguration,
      proofValue: new TextDecoder().decode(
        encodeMultibase("base58btc", signature),
      ),
    },
  };
}

function requestFor(body: Record<string, unknown>): Request {
  return new Request("https://example.com/inbox", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function handle(
  requestOrBody: Request | Record<string, unknown>,
  dispatched?: { count: number },
): Promise<Response> {
  const request = requestOrBody instanceof Request
    ? requestOrBody
    : requestFor(requestOrBody);
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const context = createRequestContext({
    federation,
    request,
    url: new URL(request.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const inboxListeners = new ActivityListenerSet<InboxContext<void>>();
  inboxListeners.add(Create, () => {
    if (dispatched != null) dispatched.count++;
  });
  return await handleInbox(request, {
    recipient: null,
    context,
    inboxContextFactory() {
      return createInboxContext({ ...context, clone: undefined });
    },
    kv: new MemoryKvStore(),
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
    },
    actorDispatcher() {
      return null;
    },
    inboxListeners,
    onNotFound() {
      return new Response("Not found", { status: 404 });
    },
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
  });
}

test("handleInbox() enforces portable compound proofs atomically", async () => {
  const valid = structuredClone(
    vector.documents.finalSecuredCompound,
  ) as Record<string, unknown>;
  assertEquals((await handle(valid)).status, 202);

  const unsignedInner = structuredClone(
    vector.documents.outerUnsecuredDocument,
  ) as Record<string, unknown>;
  delete (unsignedInner.object as Record<string, unknown>).proof;
  const validOuterOnly = await secureDocument(
    unsignedInner,
    vector.keys.outer.testPrivateKeyJwk,
    vector.keys.outer.verificationMethod,
  );
  const rejected = await handle(validOuterOnly);
  assertEquals(
    [rejected.status, await rejected.text()],
    [401, "Failed to verify compound portable Object Integrity Proofs."],
  );

  const tamperedInner = structuredClone(
    vector.documents.outerUnsecuredDocument,
  ) as Record<string, unknown>;
  (tamperedInner.object as Record<string, unknown>).content = "Tampered";
  const validOuterWithInvalidInner = await secureDocument(
    tamperedInner,
    vector.keys.outer.testPrivateKeyJwk,
    vector.keys.outer.verificationMethod,
  );
  assertEquals((await handle(validOuterWithInvalidInner)).status, 401);

  const changedAfterSigning = structuredClone(valid);
  changedAfterSigning.signature = {
    type: "RsaSignature2017",
    creator: "https://example.com/keys/1",
    created: "2023-02-24T23:36:38Z",
    signatureValue: "not-a-signature",
  };
  assertEquals((await handle(changedAfterSigning)).status, 401);
});

test("handleInbox() enforces compounds after alternate outer auth", async () => {
  const createBody = (object: Record<string, unknown>) => ({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: "https://example.com/activities/compound",
    type: "Create",
    actor: rsaPublicKey3.ownerId!.href,
    object,
  });
  const validInner = structuredClone(
    vector.documents.securedInner,
  ) as Record<string, unknown>;
  const unsignedInner = structuredClone(validInner);
  delete unsignedInner.proof;

  for (const authentication of ["http", "ld"] as const) {
    const sign = async (body: Record<string, unknown>): Promise<Request> => {
      if (authentication === "http") {
        return await signRequest(
          requestFor(body),
          rsaPrivateKey3,
          rsaPublicKey3.id!,
        );
      }
      const signed = await signJsonLd(
        body,
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      return requestFor(signed);
    };

    const acceptedDispatch = { count: 0 };
    const accepted = await handle(
      await sign(createBody(structuredClone(validInner))),
      acceptedDispatch,
    );
    assertEquals([accepted.status, acceptedDispatch.count], [202, 1]);

    const rejectedDispatch = { count: 0 };
    const rejected = await handle(
      await sign(createBody(structuredClone(unsignedInner))),
      rejectedDispatch,
    );
    assertEquals([rejected.status, rejectedDispatch.count], [401, 0]);
  }

  const proofSetInner = structuredClone(validInner);
  proofSetInner.proof = [proofSetInner.proof];
  const unsupportedDispatch = { count: 0 };
  const unsupported = await handle(
    await signRequest(
      requestFor(createBody(proofSetInner)),
      rsaPrivateKey3,
      rsaPublicKey3.id!,
    ),
    unsupportedDispatch,
  );
  assertEquals([unsupported.status, unsupportedDispatch.count], [401, 0]);
});

test("handleInbox() preserves ordinary top-level proof behavior", async () => {
  const activity = await secureDocument(
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "https://example.com/activities/ordinary",
      type: "Create",
      actor: vector.keys.outer.controller,
      object: {
        id: "https://example.com/notes/ordinary",
        type: "Note",
        attributedTo: vector.keys.outer.controller,
        content: "An ordinary note",
      },
    },
    vector.keys.outer.testPrivateKeyJwk,
    vector.keys.outer.verificationMethod,
  );
  assertEquals((await handle(activity)).status, 202);
});
