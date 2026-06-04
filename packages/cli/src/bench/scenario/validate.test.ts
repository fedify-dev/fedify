import assert from "node:assert/strict";
import test from "node:test";
import { parseSuiteText } from "./load.ts";
import { validateSuite } from "./validate.ts";
import { SuiteValidationError } from "./errors.ts";

function validInbox(): unknown {
  return {
    version: 1,
    target: "http://localhost:3000",
    actors: [{ signatureStandards: ["draft-cavage-http-signatures-12"] }],
    scenarios: [
      { name: "inbox-shared", type: "inbox", recipient: "acct:alice@x" },
    ],
  };
}

test("validateSuite - accepts a valid inbox suite", () => {
  const suite = validateSuite(validInbox());
  assert.strictEqual(suite.version, 1);
  assert.strictEqual(suite.scenarios[0].type, "inbox");
});

test("validateSuite - accepts YAML and JSON equivalently", () => {
  const yaml = parseSuiteText(`
version: 1
target: http://localhost:3000
scenarios:
  - name: wf
    type: webfinger
    recipient: "acct:alice@x"
`);
  const json = parseSuiteText(JSON.stringify({
    version: 1,
    target: "http://localhost:3000",
    scenarios: [{ name: "wf", type: "webfinger", recipient: "acct:alice@x" }],
  }));
  assert.deepEqual(validateSuite(yaml), validateSuite(json));
});

test("validateSuite - rejects a missing required field", () => {
  const bad = { target: "http://localhost:3000", scenarios: [] };
  assert.throws(() => validateSuite(bad), SuiteValidationError);
});

test("validateSuite - rejects a wrong-typed field", () => {
  const bad = validInbox() as Record<string, unknown>;
  bad.version = "1";
  assert.throws(() => validateSuite(bad), SuiteValidationError);
});

test("validateSuite - enforces exactly one HTTP signature scheme", () => {
  const bad = validInbox() as Record<string, unknown>;
  bad.actors = [{
    signatureStandards: ["draft-cavage-http-signatures-12", "rfc9421"],
  }];
  assert.throws(() => validateSuite(bad), SuiteValidationError);

  const docOnly = validInbox() as Record<string, unknown>;
  docOnly.actors = [{ signatureStandards: ["ld-signatures"] }];
  assert.throws(() => validateSuite(docOnly), SuiteValidationError);
});

test("validateSuite - enforces rate XOR concurrency", () => {
  const bad = validInbox() as Record<string, unknown>;
  bad.defaults = { load: { rate: "100/s", concurrency: 50 } };
  assert.throws(() => validateSuite(bad), SuiteValidationError);
});

test("validateSuite - enforces per-type expect metric allowlist", () => {
  const bad = {
    version: 1,
    target: "http://localhost:3000",
    scenarios: [{
      name: "wf",
      type: "webfinger",
      recipient: "acct:alice@x",
      expect: { "signatureVerification.p95": "< 10ms" },
    }],
  };
  assert.throws(() => validateSuite(bad), SuiteValidationError);
});

test("validateSuite - error message names the failing location", () => {
  try {
    validateSuite({ target: "http://localhost:3000", scenarios: [] });
    assert.fail("expected a SuiteValidationError");
  } catch (error) {
    assert.ok(error instanceof SuiteValidationError);
    assert.ok(error.problems.length > 0);
    assert.match(error.message, /Invalid scenario suite/);
  }
});
