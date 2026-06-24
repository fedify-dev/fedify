import { verifyRequest } from "@fedify/fedify";
import { Create, Note } from "@fedify/vocab";
import assert from "node:assert/strict";
import test from "node:test";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { buildFleet } from "../actor/fleet.ts";
import { spawnSyntheticServer } from "../server/synthetic.ts";
import { signInboxDelivery } from "./signer.ts";

async function signOne(
  standards: Parameters<typeof buildFleet>[0][number]["signatureStandards"],
) {
  const fleet = await buildFleet([{ count: 1, signatureStandards: standards }]);
  const server = await spawnSyntheticServer(fleet);
  const documentLoader = await getDocumentLoader({ allowPrivateAddress: true });
  const contextLoader = await getContextLoader({ allowPrivateAddress: true });
  const actor = server.actors[0];
  const activity = new Create({
    id: new URL("/activities/1", server.url),
    actor: actor.id,
    object: new Note({
      id: new URL("/notes/1", server.url),
      content: "benchmark",
      attribution: actor.id,
    }),
  });
  const request = await signInboxDelivery({
    actor,
    inbox: new URL("/inbox", server.url),
    activity,
    contextLoader,
  });
  return { server, request, actor, documentLoader, contextLoader };
}

test("signInboxDelivery - draft-cavage signature verifies", async () => {
  const { server, request, documentLoader, contextLoader } = await signOne([
    "draft-cavage-http-signatures-12",
  ]);
  try {
    const key = await verifyRequest(request, {
      documentLoader,
      contextLoader,
    });
    assert.ok(key != null, "the draft-cavage HTTP signature should verify");
  } finally {
    await server.close();
  }
});

test("signInboxDelivery - rfc9421 signature verifies", async () => {
  const { server, request, documentLoader, contextLoader } = await signOne([
    "rfc9421",
  ]);
  try {
    const key = await verifyRequest(request, {
      documentLoader,
      contextLoader,
    });
    assert.ok(key != null, "the rfc9421 HTTP signature should verify");
  } finally {
    await server.close();
  }
});

test("signInboxDelivery - embeds a FEP-8b32 proof in the body", async () => {
  const { server, request } = await signOne([
    "draft-cavage-http-signatures-12",
    "fep8b32",
  ]);
  try {
    const body = await request.clone().text();
    assert.match(body, /"proof"/);
    assert.match(body, /eddsa-jcs-2022/);
  } finally {
    await server.close();
  }
});

test("signInboxDelivery - embeds an LD signature in the body", async () => {
  const { server, request } = await signOne([
    "draft-cavage-http-signatures-12",
    "ld-signatures",
  ]);
  try {
    const body = await request.clone().text();
    assert.match(body, /"signature"/);
    assert.match(body, /RsaSignature2017/);
  } finally {
    await server.close();
  }
});
