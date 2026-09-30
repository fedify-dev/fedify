import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create } from "@fedify/vocab";
import { decodeMultibase, importDidKey } from "@fedify/vocab-runtime";
import { assert, assertEquals } from "@std/assert";
import { encodeHex } from "byte-encodings/hex";
import serialize from "json-canon";
import actor from "../../test-vectors/fep-ef61/tootik-v0.25.4/send/actor.json" with {
  type: "json",
};
import captured from "../../test-vectors/fep-ef61/tootik-v0.25.4/send/request.json" with {
  type: "json",
};
import firstResponse from "../../test-vectors/fep-ef61/tootik-v0.25.4/send/first-response.json" with {
  type: "json",
};
import metadata from "../../test-vectors/fep-ef61/tootik-v0.25.4/send/metadata.json" with {
  type: "json",
};
import processed from "../../test-vectors/fep-ef61/tootik-v0.25.4/send/processed-note.json" with {
  type: "json",
};
import raw from "../../test-vectors/fep-ef61/tootik-v0.25.4/send/raw-bodies.json" with {
  type: "json",
};
import response from "../../test-vectors/fep-ef61/tootik-v0.25.4/send/response.json" with {
  type: "json",
};
import tamperedResponse from "../../test-vectors/fep-ef61/tootik-v0.25.4/send/tampered-response.json" with {
  type: "json",
};
import { verifyRequestDetailed } from "./http.ts";
import { doesActorOwnKey } from "./owner.ts";
import { verifyPortableObjectProof } from "./proof.ts";

const activity = JSON.parse(raw.requestBody);
const tampered = JSON.parse(raw.tamperedBody);

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

const options = {
  contextLoader: mockDocumentLoader,
  documentLoader(url: string) {
    assertEquals(url.split("#")[0], actor.id);
    return Promise.resolve({
      document: structuredClone(actor),
      documentUrl: actor.id,
      contextUrl: null,
    });
  },
  currentTime: Temporal.Instant.from(captured.capturedAt),
};

function request(): Request {
  return new Request(captured.url, {
    method: captured.method,
    headers: captured.headers as [string, string][],
    body: raw.requestBody,
  });
}

test("Fedify to tootik v0.25.4 captured actor and compound proofs verify raw JCS", async () => {
  for (const [name, value] of Object.entries(raw)) {
    assertEquals(
      encodeHex(await digest(value)),
      metadata.sha256[name as keyof typeof metadata.sha256],
    );
  }
  assertEquals(JSON.parse(raw.actorBody), actor);
  assert(await verifyRawJcs(actor));
  assert(await verifyRawJcs(activity));
  assert(await verifyRawJcs(activity.object));
  assert((await verifyPortableObjectProof(actor, options)).verified);
  assert((await verifyPortableObjectProof(activity, options)).verified);
  assert((await verifyPortableObjectProof(activity.object, options)).verified);
});

test("Fedify to tootik v0.25.4 captured HTTP signature belongs to its portable actor", async () => {
  // This is independent local verification: tootik preferred the object proof.
  const verified = await verifyRequestDetailed(request(), options);
  assert(verified.verified);
  assertEquals(verified.key.id?.href, actor.publicKey.id);
  assert(
    await doesActorOwnKey(
      await Create.fromJsonLd(activity, options),
      verified.key,
      options,
    ),
  );
});

test("Fedify to tootik v0.25.4 captured result records native Note processing", () => {
  assertEquals(firstResponse.status, 401);
  assertEquals(JSON.parse(firstResponse.body).error, "actor is too young");
  assertEquals(response.status, 202);
  assertEquals(processed.rows.length, 1);
  assertEquals(processed.rows[0].id, activity.object.id);
  assertEquals(processed.rows[0].author, actor.id);
  assertEquals(processed.rows[0].object.content, activity.object.content);
  assertEquals(
    processed.rows[0].object.proof.proofValue,
    activity.object.proof.proofValue,
  );
});

test("Fedify to tootik v0.25.4 captured nested tampering invalidates both proofs", async () => {
  assertEquals(tamperedResponse.status, 401);
  assertEquals(tampered.id, activity.id);
  assert(tampered.object.content !== activity.object.content);
  assertEquals(await verifyRawJcs(tampered), false);
  assertEquals(await verifyRawJcs(tampered.object), false);
});
