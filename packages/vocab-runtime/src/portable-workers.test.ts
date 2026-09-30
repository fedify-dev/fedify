import { test, testDefinitions } from "@fedify/fixture";
import { deepStrictEqual, equal } from "node:assert/strict";
import {
  computeDigestMultibase,
  createHashlink,
  verifyHashlink,
} from "./digest.ts";
import { exportDidKey, importDidKey } from "./key.ts";
import { getPortableGatewayCandidates } from "./internal/portable-dereference.ts";
import {
  canonicalizePortableUri,
  formatIri,
  fromCompatibleEf61Id,
  parseIri,
  toCompatibleEf61Id,
} from "./url.ts";

const portableId = "ap://did:key:z6Mkabc/actor";

export { testDefinitions };

test("vocab-runtime portable URI formats on Workers", () => {
  equal(formatIri(parseIri(portableId)), "ap+ef61://did:key:z6Mkabc/actor");
  equal(
    canonicalizePortableUri(`${portableId}?@gateway=https%3A%2F%2Fa.example`),
    "ap+ef61://did:key:z6Mkabc/actor",
  );
});

test("vocab-runtime compatible IDs on Workers", () => {
  const compatible = toCompatibleEf61Id(portableId, "https://gw.example");
  equal(
    compatible.href,
    "https://gw.example/.well-known/apgateway/did:key:z6Mkabc/actor",
  );
  equal(
    formatIri(fromCompatibleEf61Id(compatible)!),
    "ap+ef61://did:key:z6Mkabc/actor",
  );
});

test("vocab-runtime did:key on Workers", async () => {
  const keys = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const did = await exportDidKey(keys.publicKey);
  const imported = await importDidKey(did);
  deepStrictEqual(
    new Uint8Array(await crypto.subtle.exportKey("raw", imported)),
    new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)),
  );
});

test("vocab-runtime hashlink on Workers", async () => {
  const bytes = new TextEncoder().encode("portable media");
  const digest = await computeDigestMultibase(bytes);
  equal(await verifyHashlink(bytes, createHashlink(digest)), true);
  equal(
    await verifyHashlink(
      new TextEncoder().encode("tampered"),
      createHashlink(digest),
    ),
    false,
  );
});

test("vocab-runtime gateway candidates on Workers", () => {
  const hinted = parseIri(
    `${portableId}?@gateway=https%3A%2F%2Fhint.example`,
  );
  deepStrictEqual(
    getPortableGatewayCandidates(hinted, ["https://first.example"])
      .map((url) => url.href),
    ["https://first.example/"],
  );
  deepStrictEqual(
    getPortableGatewayCandidates(hinted).map((url) => url.href),
    ["https://hint.example/"],
  );
});
