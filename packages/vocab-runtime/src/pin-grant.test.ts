import { test } from "@fedify/fixture";
import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import type { LookupAddress } from "node:dns";
import {
  issuePinGrant,
  type PinGrant,
  redeemPinGrant,
  revokePinGrant,
} from "./pin-grant.ts";

const addresses: readonly LookupAddress[] = [
  { address: "8.8.8.8", family: 4 },
  { address: "2001:4860:4860::8888", family: 6 },
];

test("redeemPinGrant() returns what the grant was issued for", () => {
  const url = new URL("https://pinned-host.invalid:8443/path?query");
  const input = addresses.map((address) => ({ ...address }));
  const grant = issuePinGrant(url, input);
  const record = redeemPinGrant(grant, url);
  deepStrictEqual(record.origin, "https://pinned-host.invalid:8443");
  deepStrictEqual(record.hostname, "pinned-host.invalid");
  deepStrictEqual(record.addresses, addresses);

  // The record holds a frozen copy of the addresses:
  input[0].address = "127.0.0.1";
  input.push({ address: "10.0.0.1", family: 4 });
  deepStrictEqual(redeemPinGrant(grant, url).addresses, addresses);
  ok(Object.isFrozen(record));
  ok(Object.isFrozen(record.addresses));
  ok(Object.isFrozen(record.addresses[0]));

  // Other paths and queries of the same origin are accepted:
  strictEqual(
    redeemPinGrant(grant, new URL("https://pinned-host.invalid:8443/other")),
    record,
  );
});

test("redeemPinGrant() strips brackets from IPv6 hostnames", () => {
  const url = new URL("http://[2001:4860:4860::8888]/");
  const grant = issuePinGrant(url, [addresses[1]]);
  const record = redeemPinGrant(grant, url);
  deepStrictEqual(record.hostname, "2001:4860:4860::8888");
  deepStrictEqual(record.origin, "http://[2001:4860:4860::8888]");
});

test("redeemPinGrant() rejects grants not issued by issuePinGrant()", () => {
  const url = new URL("https://pinned-host.invalid/");
  const issued = issuePinGrant(url, addresses);
  const forgeries: Record<string, unknown> = {
    "object literal": {},
    "null-prototype object": Object.create(null),
    "frozen null-prototype object": Object.freeze(Object.create(null)),
    "copy of a grant": { ...issued },
    "structured clone of a grant": structuredClone(issued),
    "object inheriting from a grant": Object.create(issued),
    "null": null,
    "undefined": undefined,
    "string": "grant",
  };
  for (const [name, forgery] of Object.entries(forgeries)) {
    throws(
      () => redeemPinGrant(forgery as PinGrant, url),
      TypeError,
      name,
    );
  }
  // The issued grant itself still works:
  ok(redeemPinGrant(issued, url));
});

test("redeemPinGrant() rejects URLs of other origins", () => {
  const grant = issuePinGrant(
    new URL("https://pinned-host.invalid/"),
    addresses,
  );
  for (
    const url of [
      "http://pinned-host.invalid/",
      "https://other-host.invalid/",
      "https://sub.pinned-host.invalid/",
      "https://pinned-host.invalid:8443/",
      "https://8.8.8.8/",
    ]
  ) {
    throws(() => redeemPinGrant(grant, new URL(url)), TypeError, url);
  }
  // The default port is the same origin:
  ok(redeemPinGrant(grant, new URL("https://pinned-host.invalid:443/")));
});

test("redeemPinGrant() rejects revoked grants", () => {
  const url = new URL("https://pinned-host.invalid/");
  const grant = issuePinGrant(url, addresses);
  const other = issuePinGrant(url, addresses);
  revokePinGrant(grant);
  throws(() => redeemPinGrant(grant, url), TypeError);
  // Revoking is idempotent, and does not affect other grants:
  revokePinGrant(grant);
  throws(() => redeemPinGrant(grant, url), TypeError);
  ok(redeemPinGrant(other, url));
});

test("revokePinGrant() ignores unknown objects", () => {
  revokePinGrant({} as PinGrant);
  revokePinGrant(Object.create(null) as PinGrant);
});

test("issuePinGrant() returns a distinct frozen object every time", () => {
  const url = new URL("https://pinned-host.invalid/");
  const a = issuePinGrant(url, addresses);
  const b = issuePinGrant(url, addresses);
  ok(a !== b);
  ok(Object.isFrozen(a));
  strictEqual(Object.getPrototypeOf(a), null);
  deepStrictEqual(Reflect.ownKeys(a), []);
});
