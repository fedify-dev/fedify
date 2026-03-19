import { test } from "@fedify/fixture";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import {
  type AcceptSignatureMember,
  formatAcceptSignature,
  fulfillAcceptSignature,
  parseAcceptSignature,
  validateAcceptSignature,
} from "./accept.ts";

// ---------------------------------------------------------------------------
// parseAcceptSignature()
// ---------------------------------------------------------------------------

test("parseAcceptSignature(): single entry", () => {
  const result = parseAcceptSignature(
    'sig1=("@method" "@target-uri")',
  );

  deepStrictEqual(result, [{
    label: "sig1",
    components: [
      { value: "@method", params: {} },
      { value: "@target-uri", params: {} },
    ],
    parameters: {},
  }]);
});

test("parseAcceptSignature(): multiple entries", () => {
  const result = parseAcceptSignature(
    'sig1=("@method"), sig2=("@authority")',
  );

  deepStrictEqual(result, [
    {
      label: "sig1",
      components: [{ value: "@method", params: {} }],
      parameters: {},
    },
    {
      label: "sig2",
      components: [{ value: "@authority", params: {} }],
      parameters: {},
    },
  ]);
});

test("parseAcceptSignature(): all six parameters", () => {
  const result = parseAcceptSignature(
    'sig1=("@method");keyid="k1";alg="rsa-v1_5-sha256"' +
      ';created;expires;nonce="abc";tag="t1"',
  );

  deepStrictEqual(result, [{
    label: "sig1",
    components: [{ value: "@method", params: {} }],
    parameters: {
      keyid: "k1",
      alg: "rsa-v1_5-sha256",
      created: true,
      expires: true,
      nonce: "abc",
      tag: "t1",
    },
  }]);
});

test("parseAcceptSignature(): preserves string component parameters", () => {
  const result = parseAcceptSignature(
    'sig1=("@query-param";name="foo" "@method")',
  );

  deepStrictEqual(result, [{
    label: "sig1",
    components: [
      { value: "@query-param", params: { name: "foo" } },
      { value: "@method", params: {} },
    ],
    parameters: {},
  }]);
});

test("parseAcceptSignature(): preserves boolean component parameters", () => {
  const result = parseAcceptSignature(
    'sig1=("content-type";sf "content-digest";bs)',
  );
  deepStrictEqual(result, [{
    label: "sig1",
    components: [
      { value: "content-type", params: { sf: true } },
      { value: "content-digest", params: { bs: true } },
    ],
    parameters: {},
  }]);
});

test(
  "parseAcceptSignature(): preserves multiple parameters on one component",
  () => {
    const result = parseAcceptSignature(
      'sig1=("@request-response";key="sig1";req)',
    );
    deepStrictEqual(result, [{
      label: "sig1",
      components: [{
        value: "@request-response",
        params: { key: "sig1", req: true },
      }],
      parameters: {},
    }]);
  },
);

test("parseAcceptSignature(): malformed header", () => {
  deepStrictEqual(parseAcceptSignature("not a valid structured field"), []);
  deepStrictEqual(parseAcceptSignature(""), []);
});

// ---------------------------------------------------------------------------
// formatAcceptSignature()
// ---------------------------------------------------------------------------

test("formatAcceptSignature(): single entry with created", () => {
  const members: AcceptSignatureMember[] = [{
    label: "sig1",
    components: [
      { value: "@method", params: {} },
      { value: "@target-uri", params: {} },
      { value: "@authority", params: {} },
    ],
    parameters: { created: true },
  }];
  const header = formatAcceptSignature(members);
  const parsed = parseAcceptSignature(header);

  deepStrictEqual(parsed, members);
});

test("formatAcceptSignature(): created + nonce", () => {
  const members: AcceptSignatureMember[] = [{
    label: "sig1",
    components: [{ value: "@method", params: {} }],
    parameters: {
      created: true,
      nonce: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    },
  }];
  const header = formatAcceptSignature(members);
  const parsed = parseAcceptSignature(header);

  deepStrictEqual(parsed, members);
});

test("formatAcceptSignature(): multiple entries", () => {
  const members: AcceptSignatureMember[] = [
    {
      label: "sig1",
      components: [{ value: "@method", params: {} }],
      parameters: {},
    },
    {
      label: "sig2",
      components: [
        { value: "@authority", params: {} },
        { value: "content-digest", params: {} },
      ],
      parameters: { tag: "app-123" },
    },
  ];
  const header = formatAcceptSignature(members);
  const parsed = parseAcceptSignature(header);

  deepStrictEqual(parsed, members);
});

test("formatAcceptSignature(): round-trip with all parameters", () => {
  const input: AcceptSignatureMember[] = [{
    label: "sig1",
    components: [
      { value: "@method", params: {} },
      { value: "@target-uri", params: {} },
      { value: "@authority", params: {} },
      { value: "content-digest", params: {} },
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
  const header = formatAcceptSignature(input);
  const members = parseAcceptSignature(header);

  deepStrictEqual(members, input);
});

test("formatAcceptSignature(): round-trip with parameterized components", () => {
  const input: AcceptSignatureMember[] = [{
    label: "sig1",
    components: [
      { value: "@query-param", params: { name: "foo" } },
      { value: "content-type", params: { sf: true } },
      { value: "@method", params: {} },
    ],
    parameters: { created: true },
  }];
  const header = formatAcceptSignature(input);
  const members = parseAcceptSignature(header);
  deepStrictEqual(members, input);
});

// ---------------------------------------------------------------------------
// validateAcceptSignature()
// ---------------------------------------------------------------------------

test("validateAcceptSignature(): filters out @status", () => {
  const valid: AcceptSignatureMember = {
    label: "sig1",
    components: [
      { value: "@method", params: {} },
      { value: "@target-uri", params: {} },
    ],
    parameters: {},
  };
  const invalid: AcceptSignatureMember = {
    label: "sig2",
    components: [
      { value: "@method", params: {} },
      { value: "@status", params: {} },
    ],
    parameters: {},
  };
  const validOnly = [valid];
  deepStrictEqual(validateAcceptSignature(validOnly), [valid]);
  const invalidOnly = [invalid];
  deepStrictEqual(validateAcceptSignature(invalidOnly), []);
  const mixed = [valid, invalid];
  deepStrictEqual(validateAcceptSignature(mixed), [valid]);
});

test(
  "validateAcceptSignature(): passes entries with parameterized components",
  () => {
    const members: AcceptSignatureMember[] = [{
      label: "sig1",
      components: [
        { value: "@query-param", params: { name: "foo" } },
        { value: "@method", params: {} },
      ],
      parameters: {},
    }];
    deepStrictEqual(validateAcceptSignature(members), members);
  },
);

// ---------------------------------------------------------------------------
// fulfillAcceptSignature()
// ---------------------------------------------------------------------------

test("fulfillAcceptSignature(): compatible alg and keyid", () => {
  const entry: AcceptSignatureMember = {
    label: "sig1",
    components: [
      { value: "@method", params: {} },
      { value: "@target-uri", params: {} },
      { value: "content-digest", params: {} },
    ],
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

  deepStrictEqual(result, {
    label: "sig1",
    components: [
      { value: "@method", params: {} },
      { value: "@target-uri", params: {} },
      { value: "@authority", params: {} },
      { value: "content-digest", params: {} },
    ],
    nonce: "abc",
    tag: "t1",
    expires: undefined,
  });
});

test("fulfillAcceptSignature(): incompatible alg", () => {
  const entry: AcceptSignatureMember = {
    label: "sig1",
    components: [{ value: "@method", params: {} }],
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
    components: [{ value: "@method", params: {} }],
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
    components: [{ value: "content-digest", params: {} }],
    parameters: {},
  };
  const result = fulfillAcceptSignature(
    entry,
    "https://example.com/key",
    "rsa-v1_5-sha256",
  );

  // Minimum set should be merged in
  const values = result!.components.map((c) => c.value).sort();
  deepStrictEqual(values, [
    "@authority",
    "@method",
    "@target-uri",
    "content-digest",
  ]);
});

test("fulfillAcceptSignature(): no alg/keyid constraints", () => {
  const entry: AcceptSignatureMember = {
    label: "custom",
    components: [
      { value: "@method", params: {} },
      { value: "@target-uri", params: {} },
      { value: "@authority", params: {} },
    ],
    parameters: {},
  };
  const result = fulfillAcceptSignature(
    entry,
    "https://example.com/key",
    "rsa-v1_5-sha256",
  );

  deepStrictEqual(result, {
    label: "custom",
    components: [
      { value: "@method", params: {} },
      { value: "@target-uri", params: {} },
      { value: "@authority", params: {} },
    ],
    nonce: undefined,
    tag: undefined,
    expires: undefined,
  });
});

test("fulfillAcceptSignature(): passes through expires when requested", () => {
  const entry: AcceptSignatureMember = {
    label: "sig1",
    components: [
      { value: "@method", params: {} },
      { value: "@target-uri", params: {} },
      { value: "@authority", params: {} },
    ],
    parameters: { expires: true },
  };
  const result = fulfillAcceptSignature(
    entry,
    "https://example.com/key",
    "rsa-v1_5-sha256",
  );

  strictEqual(result != null, true);
  strictEqual(result!.expires, true);
});

test(
  "fulfillAcceptSignature(): preserves component parameters in result",
  () => {
    const entry: AcceptSignatureMember = {
      label: "sig1",
      components: [
        { value: "@query-param", params: { name: "foo" } },
        { value: "@method", params: {} },
        { value: "@target-uri", params: {} },
        { value: "@authority", params: {} },
      ],
      parameters: {},
    };
    const result = fulfillAcceptSignature(
      entry,
      "https://example.com/key",
      "rsa-v1_5-sha256",
    );
    strictEqual(result != null, true);
    // The parameterized component must be preserved intact in the result
    const qp = result!.components.find((c) => c.value === "@query-param");
    deepStrictEqual(qp, { value: "@query-param", params: { name: "foo" } });
  },
);

// cspell: ignore keyid
