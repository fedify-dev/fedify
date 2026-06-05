import { isActor, Object as APObject } from "@fedify/vocab";
import assert from "node:assert/strict";
import test from "node:test";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { buildFleet } from "../actor/fleet.ts";
import {
  AdvertiseHostError,
  resolveAdvertiseHost,
  spawnSyntheticServer,
} from "./synthetic.ts";

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

test("spawnSyntheticServer - advertises a reachable host in actor URLs", async () => {
  const fleet = await buildFleet([{
    count: 1,
    signatureStandards: ["draft-cavage-http-signatures-12"],
  }]);
  // 192.0.2.0/24 is TEST-NET-1: a non-loopback host that is never actually
  // routed, so this checks the advertised URLs without needing a remote peer.
  const server = await spawnSyntheticServer(fleet, {
    advertiseHost: "192.0.2.10",
  });
  try {
    const actor = server.actors[0];
    assert.strictEqual(actor.id.hostname, "192.0.2.10");
    assert.strictEqual(server.url.hostname, "192.0.2.10");
    assert.strictEqual(actor.rsaKeyId?.hostname, "192.0.2.10");
    // The advertised port matches the bound port, and the document is still
    // served (the server binds all interfaces, so loopback reaches it).
    const local = new URL(
      actor.id.pathname,
      `http://127.0.0.1:${actor.id.port}`,
    );
    const response = await fetch(local);
    assert.strictEqual(response.status, 200);
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

test("resolveAdvertiseHost - IPv4 literal binds the IPv4 wildcard", () => {
  assert.deepEqual(resolveAdvertiseHost("192.168.1.10"), {
    bindHost: "0.0.0.0",
    urlHost: "192.168.1.10",
  });
  // Surrounding whitespace is trimmed.
  assert.deepEqual(resolveAdvertiseHost("  10.0.0.5  "), {
    bindHost: "0.0.0.0",
    urlHost: "10.0.0.5",
  });
});

test("resolveAdvertiseHost - a hostname binds dual-stack", () => {
  // A hostname can resolve to an A or AAAA record, so bind every interface of
  // both families rather than assuming IPv4.
  assert.deepEqual(resolveAdvertiseHost("bench.local"), {
    bindHost: "::",
    urlHost: "bench.local",
  });
});

test("resolveAdvertiseHost - IPv6 binds all IPv6 interfaces and is bracketed", () => {
  assert.deepEqual(resolveAdvertiseHost("2001:db8::1"), {
    bindHost: "::",
    urlHost: "[2001:db8::1]",
  });
  // An already-bracketed literal is accepted as-is.
  assert.deepEqual(resolveAdvertiseHost("[2001:db8::1]"), {
    bindHost: "::",
    urlHost: "[2001:db8::1]",
  });
});

test("resolveAdvertiseHost - rejects ports, schemes, paths, and junk", () => {
  for (
    const bad of [
      "",
      "  ",
      "10.0.0.5:8080",
      "http://10.0.0.5",
      "10.0.0.5/path",
      "user@host",
      "[2001:db8::1",
      "2001:db8:::",
    ]
  ) {
    assert.throws(
      () => resolveAdvertiseHost(bad),
      AdvertiseHostError,
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
});
