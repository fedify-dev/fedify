import { test } from "@fedify/fixture";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import {
  type AcceptSignatureMember,
  formatAcceptSignature,
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
