import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create } from "@fedify/vocab";
import {
  canonicalizePortableUri,
  decodeMultibase,
  fromCompatibleEf61Id,
  importDidKey,
} from "@fedify/vocab-runtime";
import { assert, assertEquals } from "@std/assert";
import { encodeHex } from "byte-encodings/hex";
import serialize from "json-canon";
import actor from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/actor.json" with {
  type: "json",
};
import captured from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/request.json" with {
  type: "json",
};
import registration from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/registration-response.json" with {
  type: "json",
};
import servedActor from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/served-actor.json" with {
  type: "json",
};
import baselineResponse from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/baseline-gateway-response.json" with {
  type: "json",
};
import tamperedRequest from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/tampered-request.json" with {
  type: "json",
};
import metadata from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/metadata.json" with {
  type: "json",
};
import processed from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/processed-collections.json" with {
  type: "json",
};
import processedNote from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/processed-note.json" with {
  type: "json",
};
import profiles from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/profiles.json" with {
  type: "json",
};
import raw from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/raw-bodies.json" with {
  type: "json",
};
import response from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/response.json" with {
  type: "json",
};
import tamperedResponse from "../../test-vectors/fep-ef61/mitra-v5.10.0/send/tampered-response.json" with {
  type: "json",
};
import { verifyRequestDetailed } from "./http.ts";
import { doesActorOwnKey } from "./owner.ts";
import { verifyPortableObjectProof } from "./proof.ts";

const activity = JSON.parse(raw.requestBody);
const baseline = JSON.parse(raw.baselineGatewayBody);

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
    assertEquals(url.split("#")[0], actor.publicKey.id.split("#")[0]);
    return Promise.resolve({
      document: structuredClone(actor),
      documentUrl: actor.publicKey.id.split("#")[0],
      contextUrl: null,
    });
  },
  currentTime: Temporal.Instant.from(metadata.capturedAt),
};

function request(headers = captured.headers as [string, string][]): Request {
  return new Request(captured.url, {
    method: captured.method,
    headers,
    body: raw.requestBody,
  });
}

test("Fedify to Mitra v5.10.0 captured actor and compound proofs verify raw JCS", async () => {
  for (const [name, value] of Object.entries(raw)) {
    assertEquals(
      encodeHex(await digest(value)),
      metadata.sha256[name as keyof typeof metadata.sha256],
    );
  }
  assertEquals(JSON.parse(raw.actorBody), actor);
  assertEquals(JSON.parse(raw.servedActorBody), servedActor);
  assert(metadata.senderDid !== metadata.recipientDid);
  for (const document of [actor, activity, activity.object]) {
    assertEquals(
      document.proof.verificationMethod.split("#")[0],
      metadata.senderDid,
    );
    const owner = document.actor ?? document.attributedTo ?? document.id;
    assert(owner.includes(metadata.senderDid));
  }
  assert(captured.url.includes(metadata.recipientDid));
  assert(servedActor.id.includes(metadata.recipientDid));
  assert(await verifyRawJcs(actor));
  assert(await verifyRawJcs(activity));
  assert(await verifyRawJcs(activity.object));
  assert((await verifyPortableObjectProof(actor, options)).verified);
  assert((await verifyPortableObjectProof(activity, options)).verified);
  assert((await verifyPortableObjectProof(activity.object, options)).verified);
});

test("Fedify to Mitra v5.10.0 captured HTTP signature belongs to its portable actor", async () => {
  // The live RFC 9421 request succeeded on the first attempt.
  assert(
    new Headers(captured.headers as [string, string][]).has("signature-input"),
  );
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

test("Fedify to Mitra v5.10.0 records native registration and worker processing", () => {
  assertEquals(registration.status, 201);
  assertEquals(response.status, 202);
  const portableId = fromCompatibleEf61Id(activity.id);
  assert(portableId != null);
  const expectedId = canonicalizePortableUri(portableId.href);
  const entries = processed.rows.filter((row) =>
    canonicalizePortableUri(row.object_id) === expectedId
  );
  assert(entries.some((row) => row.collection_id.endsWith("/actor/inbox")));
  assert(entries.every((row) => row.type === "Create"));
  assert(entries.every((row) => row.actor === actor.id));
  assert(
    entries.every((row) => row.collection_id.includes(metadata.recipientDid)),
  );
  const sender = profiles.rows.find((row) =>
    row.actor_id.includes(metadata.senderDid)
  );
  const recipient = profiles.rows.find((row) =>
    row.actor_id.includes(metadata.recipientDid)
  );
  assert(sender != null && recipient != null);
  assertEquals(sender.has_portable_account, false);
  assertEquals(recipient.has_portable_account, true);
  assertEquals(processedNote.rows.length, 1);
  assertEquals(processedNote.rows[0].has_processed_post, true);
  assertEquals(processedNote.rows[0].object_data, activity.object);
});

test("Fedify to Mitra v5.10.0 rejects a tampered RFC 9421 HTTP signature", async () => {
  assertEquals(tamperedResponse.status, 401);
  assertEquals(
    (await verifyRequestDetailed(
      request(tamperedRequest.headers as [string, string][]),
      options,
    )).verified,
    false,
  );
});

test("Fedify to Mitra v5.10.0 records signed trailing-slash gateway rejection", async () => {
  assertEquals(baselineResponse.status, 400);
  assertEquals(baselineResponse.body, "invalid gateway URL");
  assert(await verifyRawJcs(baseline));
  assert(baseline.gateways.some((gateway: string) => gateway.endsWith("/")));
  assert(actor.gateways.every((gateway) => !gateway.endsWith("/")));
});
