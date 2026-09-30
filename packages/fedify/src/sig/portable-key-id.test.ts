import { test } from "@fedify/fixture";
import { exportDidKey, parseIri } from "@fedify/vocab-runtime";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { ed25519PublicKey } from "../testing/keys.ts";
import { getAuthenticationOrigin, isSameObjectId } from "./portable-key-id.ts";

const did = await exportDidKey(ed25519PublicKey.publicKey);
const otherKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]) as CryptoKeyPair;
const otherDid = await exportDidKey(otherKeyPair.publicKey);

test("getAuthenticationOrigin()", () => {
  // Portable IDs in any form have their DIDs as their origins:
  for (
    const id of [
      parseIri(`ap://${did}/actor`),
      parseIri(`ap+ef61://${did}/actor`),
      parseIri(`ap+ef61://${encodeURIComponent(did)}/actor#main-key`),
      parseIri(`ap://${did}/actor?@gateway=https%3A%2F%2Fgw.example`),
      new URL(`https://gw.example/.well-known/apgateway/${did}/actor`),
      new URL(`https://gw2.example/.well-known/apgateway/${did}/objects/1`),
      new URL(`${did}#${did.slice("did:key:".length)}`),
    ]
  ) {
    assertEquals(getAuthenticationOrigin(id), did, id.href);
  }
  assertEquals(
    getAuthenticationOrigin(parseIri(`ap+ef61://${otherDid}/actor`)),
    otherDid,
  );

  // Other HTTP(S) IDs have their web origins:
  assertEquals(
    getAuthenticationOrigin(new URL("https://example.com:443/users/alice")),
    "https://example.com",
  );
  assertEquals(
    getAuthenticationOrigin(new URL("http://example.com:8080/users/alice")),
    "http://example.com:8080",
  );

  // Malformed portable IDs, and IDs of unsupported schemes, have none:
  for (
    const id of [
      new URL(
        `https://gw.example/.well-known/apgateway/${did}/actor` +
          "?@gateway=https%3A%2F%2Fgw.example",
      ),
      new URL("https://gw.example/.well-known/apgateway/did:key:invalid!/a"),
      new URL(`https://gw.example/.well-known/apgateway/${did}`),
      new URL(`https://gw.example/.well-known/apgateway/${did}/actor%ZZ`),
      new URL("urn:uuid:3d6f4c1e-2f8b-4d1a-9c6e-7b8a9d0e1f2a"),
      new URL("tag:example.com,2026:actor"),
    ]
  ) {
    assertEquals(getAuthenticationOrigin(id), null, id.href);
  }
});

test("isSameObjectId()", () => {
  const portable = parseIri(`ap+ef61://${did}/activities/1`);
  // The same portable object in different forms:
  for (
    const id of [
      parseIri(`ap://${did}/activities/1`),
      parseIri(`ap+ef61://${encodeURIComponent(did)}/activities/1`),
      parseIri(`ap://${did}/activities/1?@gateway=https%3A%2F%2Fgw.example`),
      new URL(`https://gw.example/.well-known/apgateway/${did}/activities/1`),
      new URL(`https://gw2.example/.well-known/apgateway/${did}/activities/1`),
    ]
  ) {
    assert(isSameObjectId(portable, id), id.href);
    assert(isSameObjectId(id, portable), id.href);
  }
  // Other portable objects:
  for (
    const id of [
      parseIri(`ap+ef61://${otherDid}/activities/1`),
      parseIri(`ap+ef61://${did}/activities/2`),
      parseIri(`ap+ef61://${did}/activities/1#fragment`),
      new URL(
        `https://gw.example/.well-known/apgateway/${did}/activities/1%ZZ`,
      ),
      new URL("https://gw.example/activities/1"),
    ]
  ) {
    assertFalse(isSameObjectId(portable, id), id.href);
    assertFalse(isSameObjectId(id, portable), id.href);
  }
  // Malformed compatible identifiers match nothing, not even themselves:
  const malformed = new URL(
    `https://gw.example/.well-known/apgateway/${did}/activities/1%ZZ`,
  );
  assertFalse(isSameObjectId(malformed, malformed));
  // Other IDs have to be equal as they are:
  const http = new URL("https://example.com/activities/1");
  assert(isSameObjectId(http, new URL("https://example.com/activities/1")));
  assertFalse(
    isSameObjectId(http, new URL("https://example.com/activities/1#a")),
  );
  assertFalse(
    isSameObjectId(http, new URL("https://example.com/activities/1?a")),
  );
});
