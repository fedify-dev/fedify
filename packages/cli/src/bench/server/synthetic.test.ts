import { isActor, Object as APObject } from "@fedify/vocab";
import assert from "node:assert/strict";
import test from "node:test";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { buildFleet } from "../actor/fleet.ts";
import { spawnSyntheticServer } from "./synthetic.ts";

test("spawnSyntheticServer - serves a verifiable actor document", async () => {
  const fleet = await buildFleet([{
    count: 1,
    signatureStandards: ["draft-cavage-http-signatures-12", "fep8b32"],
  }]);
  const server = await spawnSyntheticServer(fleet);
  try {
    const actor = server.actors[0];
    assert.strictEqual(actor.id.hostname, "127.0.0.1");
    assert.ok(actor.rsaKeyId?.href.endsWith("#main-key"));
    assert.ok(actor.ed25519KeyId?.href.endsWith("#ed25519-key"));

    const response = await fetch(actor.id);
    assert.strictEqual(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /activity\+json/,
    );
    const json = await response.text();
    assert.match(json, /publicKeyPem/);
    assert.match(json, /BEGIN PUBLIC KEY/);
    assert.match(json, /publicKeyMultibase/);

    // The served document parses back into a verifiable actor with its keys.
    const documentLoader = await getDocumentLoader({
      allowPrivateAddress: true,
    });
    const contextLoader = await getContextLoader({ allowPrivateAddress: true });
    const parsed = await APObject.fromJsonLd(JSON.parse(json), {
      documentLoader,
      contextLoader,
    });
    assert.ok(isActor(parsed));
    const publicKeys = await Array.fromAsync(
      parsed.getPublicKeys({ documentLoader, contextLoader }),
    );
    assert.strictEqual(publicKeys.length, 1);
    assert.ok(publicKeys[0].publicKey != null);
    const multikeys = await Array.fromAsync(
      parsed.getAssertionMethods({ documentLoader, contextLoader }),
    );
    assert.strictEqual(multikeys.length, 1);
    assert.ok(multikeys[0].publicKey != null);
  } finally {
    await server.close();
  }
});

test("spawnSyntheticServer - unknown paths 404", async () => {
  const fleet = await buildFleet([{
    signatureStandards: ["rfc9421"],
  }]);
  const server = await spawnSyntheticServer(fleet);
  try {
    const response = await fetch(new URL("/nope", server.url));
    assert.strictEqual(response.status, 404);
    // An rfc9421-only actor has an RSA key but no Ed25519 key.
    assert.ok(server.actors[0].rsaKeyId != null);
    assert.ok(server.actors[0].ed25519KeyId == null);
  } finally {
    await server.close();
  }
});
