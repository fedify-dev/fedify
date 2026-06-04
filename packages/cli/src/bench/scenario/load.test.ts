import assert from "node:assert/strict";
import test from "node:test";
import { parseSuiteText, renderSuiteTemplates } from "./load.ts";

test("parseSuiteText - parses YAML and JSON alike", () => {
  const yaml = parseSuiteText("version: 1\ntarget: http://x\n");
  const json = parseSuiteText('{"version":1,"target":"http://x"}');
  assert.deepEqual(yaml, json);
});

test("renderSuiteTemplates - expands target.host from the suite target", () => {
  const raw = {
    version: 1,
    target: "http://localhost:3000",
    scenarios: [{
      name: "x",
      type: "inbox",
      recipient: "http://${{ target.host }}/users/alice",
    }],
  };
  const rendered = renderSuiteTemplates(raw) as typeof raw;
  assert.strictEqual(
    rendered.scenarios[0].recipient,
    "http://localhost:3000/users/alice",
  );
});

test("renderSuiteTemplates - uses the --target override for the context", () => {
  const raw = {
    version: 1,
    target: "http://a",
    scenarios: [{
      name: "x",
      type: "webfinger",
      recipient: "acct:bob@${{ target.host }}",
    }],
  };
  const rendered = renderSuiteTemplates(raw, "http://b:9000") as typeof raw;
  assert.strictEqual(rendered.scenarios[0].recipient, "acct:bob@b:9000");
});

test("renderSuiteTemplates - leaves untemplated values untouched", () => {
  const raw = {
    version: 1,
    target: "http://localhost:3000",
    scenarios: [{ name: "x", type: "webfinger", recipient: "acct:a@host" }],
  };
  assert.deepEqual(renderSuiteTemplates(raw), raw);
});
