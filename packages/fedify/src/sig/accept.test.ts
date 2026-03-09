import { test } from "@fedify/fixture";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import {
  type AcceptSignatureMember,
  formatAcceptSignature,
  fulfillAcceptSignature,
  parseAcceptSignature,
  validateAcceptSignatureForRequest,
} from "./accept.ts";

// ---------------------------------------------------------------------------
// parseAcceptSignature()
// ---------------------------------------------------------------------------

test("parseAcceptSignature(): single entry", () => {
  const result = parseAcceptSignature(
    'sig1=("@method" "@target-uri")',
  );
  strictEqual(result.length, 1);
  strictEqual(result[0].label, "sig1");
  deepStrictEqual(result[0].components, ["@method", "@target-uri"]);
  deepStrictEqual(result[0].parameters, {});
});

test("parseAcceptSignature(): multiple entries", () => {
  const result = parseAcceptSignature(
    'sig1=("@method"), sig2=("@authority")',
  );
  strictEqual(result.length, 2);
  strictEqual(result[0].label, "sig1");
  deepStrictEqual(result[0].components, ["@method"]);
  strictEqual(result[1].label, "sig2");
  deepStrictEqual(result[1].components, ["@authority"]);
});

test("parseAcceptSignature(): all six parameters", () => {
  const result = parseAcceptSignature(
    'sig1=("@method");keyid="k1";alg="rsa-v1_5-sha256"' +
      ';created;expires;nonce="abc";tag="t1"',
  );
  strictEqual(result.length, 1);
  deepStrictEqual(result[0].parameters, {
    keyid: "k1",
    alg: "rsa-v1_5-sha256",
    created: true,
    expires: true,
    nonce: "abc",
    tag: "t1",
  });
});

test("parseAcceptSignature(): no parameters", () => {
  const result = parseAcceptSignature(
    'sig1=("@method" "@target-uri")',
  );
  deepStrictEqual(result[0].parameters, {});
});

test("parseAcceptSignature(): malformed header", () => {
  deepStrictEqual(parseAcceptSignature("not a valid structured field"), []);
});

test("parseAcceptSignature(): empty string", () => {
  deepStrictEqual(parseAcceptSignature(""), []);
});

// ---------------------------------------------------------------------------
// formatAcceptSignature()
// ---------------------------------------------------------------------------

test("formatAcceptSignature(): single entry with created", () => {
  const members: AcceptSignatureMember[] = [{
    label: "sig1",
    components: ["@method", "@target-uri", "@authority"],
    parameters: { created: true },
  }];
  const header = formatAcceptSignature(members);
  // Output must be a valid structured field that can be round-tripped.
  const parsed = parseAcceptSignature(header);
  strictEqual(parsed.length, 1);
  strictEqual(parsed[0].label, "sig1");
  deepStrictEqual(parsed[0].components, [
    "@method",
    "@target-uri",
    "@authority",
  ]);
  strictEqual(parsed[0].parameters.created, true);
});

test("formatAcceptSignature(): created + nonce", () => {
  const members: AcceptSignatureMember[] = [{
    label: "sig1",
    components: ["@method"],
    parameters: {
      created: true,
      nonce: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    },
  }];
  const header = formatAcceptSignature(members);
  const parsed = parseAcceptSignature(header);
  strictEqual(
    parsed[0].parameters.nonce,
    "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  );
  strictEqual(parsed[0].parameters.created, true);
});

test("formatAcceptSignature(): multiple entries", () => {
  const members: AcceptSignatureMember[] = [
    {
      label: "sig1",
      components: ["@method"],
      parameters: {},
    },
    {
      label: "sig2",
      components: ["@authority", "content-digest"],
      parameters: { tag: "app-123" },
    },
  ];
  const header = formatAcceptSignature(members);
  const parsed = parseAcceptSignature(header);
  strictEqual(parsed.length, 2);
  strictEqual(parsed[0].label, "sig1");
  strictEqual(parsed[1].label, "sig2");
  strictEqual(parsed[1].parameters.tag, "app-123");
});

test("formatAcceptSignature(): round-trip with all parameters", () => {
  const input: AcceptSignatureMember[] = [{
    label: "sig1",
    components: [
      "@method",
      "@target-uri",
      "@authority",
      "content-digest",
    ],
    parameters: {
      keyid: "test-key-rsa-pss",
      alg: "rsa-pss-sha512",
      created: true,
      expires: true,
      nonce: "abc123",
      tag: "app-123",
    },
  }];
  const roundTripped = parseAcceptSignature(
    formatAcceptSignature(input),
  );
  deepStrictEqual(roundTripped, input);
});

// ---------------------------------------------------------------------------
// validateAcceptSignatureForRequest()
// ---------------------------------------------------------------------------

test("validateAcceptSignatureForRequest(): filters out @status", () => {
  const members: AcceptSignatureMember[] = [{
    label: "sig1",
    components: ["@method", "@status"],
    parameters: {},
  }];
  deepStrictEqual(validateAcceptSignatureForRequest(members), []);
});

test("validateAcceptSignatureForRequest(): passes valid entries", () => {
  const members: AcceptSignatureMember[] = [{
    label: "sig1",
    components: ["@method", "@target-uri"],
    parameters: {},
  }];
  deepStrictEqual(validateAcceptSignatureForRequest(members), members);
});

test(
  "validateAcceptSignatureForRequest(): mixed valid and invalid",
  () => {
    const valid: AcceptSignatureMember = {
      label: "sig1",
      components: ["@method", "@target-uri"],
      parameters: {},
    };
    const invalid: AcceptSignatureMember = {
      label: "sig2",
      components: ["@method", "@status"],
      parameters: {},
    };
    const result = validateAcceptSignatureForRequest([valid, invalid]);
    deepStrictEqual(result, [valid]);
  },
);

// ---------------------------------------------------------------------------
// fulfillAcceptSignature()
// ---------------------------------------------------------------------------

test("fulfillAcceptSignature(): compatible alg and keyid", () => {
  const entry: AcceptSignatureMember = {
    label: "sig1",
    components: ["@method", "@target-uri", "content-digest"],
    parameters: {
      alg: "rsa-v1_5-sha256",
      keyid: "https://example.com/key",
      nonce: "abc",
      tag: "t1",
    },
  };
  const result = fulfillAcceptSignature(
    entry,
    "https://example.com/key",
    "rsa-v1_5-sha256",
  );
  strictEqual(result != null, true);
  strictEqual(result!.label, "sig1");
  deepStrictEqual(result!.components, [
    "@method",
    "@target-uri",
    "content-digest",
    "@authority",
  ]);
  strictEqual(result!.nonce, "abc");
  strictEqual(result!.tag, "t1");
});

test("fulfillAcceptSignature(): incompatible alg", () => {
  const entry: AcceptSignatureMember = {
    label: "sig1",
    components: ["@method"],
    parameters: { alg: "ecdsa-p256-sha256" },
  };
  const result = fulfillAcceptSignature(
    entry,
    "https://example.com/key",
    "rsa-v1_5-sha256",
  );
  strictEqual(result, null);
});

test("fulfillAcceptSignature(): incompatible keyid", () => {
  const entry: AcceptSignatureMember = {
    label: "sig1",
    components: ["@method"],
    parameters: { keyid: "https://other.example/key" },
  };
  const result = fulfillAcceptSignature(
    entry,
    "https://example.com/key",
    "rsa-v1_5-sha256",
  );
  strictEqual(result, null);
});

test("fulfillAcceptSignature(): minimum component set preserved", () => {
  const entry: AcceptSignatureMember = {
    label: "sig1",
    components: ["content-digest"],
    parameters: {},
  };
  const result = fulfillAcceptSignature(
    entry,
    "https://example.com/key",
    "rsa-v1_5-sha256",
  );
  strictEqual(result != null, true);
  // Minimum set should be merged in
  strictEqual(result!.components.includes("@method"), true);
  strictEqual(result!.components.includes("@target-uri"), true);
  strictEqual(result!.components.includes("@authority"), true);
  strictEqual(result!.components.includes("content-digest"), true);
});

test("fulfillAcceptSignature(): no alg/keyid constraints", () => {
  const entry: AcceptSignatureMember = {
    label: "custom",
    components: ["@method", "@target-uri", "@authority"],
    parameters: {},
  };
  const result = fulfillAcceptSignature(
    entry,
    "https://example.com/key",
    "rsa-v1_5-sha256",
  );
  strictEqual(result != null, true);
  strictEqual(result!.label, "custom");
  deepStrictEqual(result!.components, [
    "@method",
    "@target-uri",
    "@authority",
  ]);
  strictEqual(result!.nonce, undefined);
  strictEqual(result!.tag, undefined);
});
