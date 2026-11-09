import { test } from "@fedify/fixture";
import { Create, Note } from "@fedify/vocab";
import { deepStrictEqual, ok, strictEqual, throws } from "node:assert/strict";
import { projectSenderPayload } from "./outbound-document.ts";
import { createFederationBuilder, FederationBuilderImpl } from "./builder.ts";

const as = "https://www.w3.org/ns/activitystreams";
const secret = "https://private.example/recipient";

test("sender payload accepts generated history contexts while redacting blind recipients", async () => {
  const history = new URL("https://example.com/history");
  const source = await new Create({
    btos: [new URL(secret)],
    object: new Note({ contextHistory: history, bccs: [new URL(secret)] }),
  }).toJsonLd();
  const result = projectSenderPayload(source);
  ok(result.type === "available");
  strictEqual(result.redacted, true);
  const json = JSON.stringify(result.value);
  strictEqual(json.includes(secret), false);
  ok(json.includes(history.href));
});

test("sender payload projects nested compact expanded and proof-bearing blind fields", () => {
  const source = {
    "@context": [as, "https://w3id.org/security/data-integrity/v2"],
    type: "Create",
    bto: [secret],
    object: {
      bcc: [secret],
      children: [
        {
          "as:bto": secret,
          [`${as}#bcc`]: secret,
          content: "visible",
        },
      ],
      proof: {
        "@context": "https://w3id.org/identity/v1",
        type: "DataIntegrityProof",
        proofValue: "retained-proof",
        "as:bcc": secret,
      },
    },
    signature: { signatureValue: "retained-signature", [`${as}#bto`]: secret },
  };
  const original = structuredClone(source);
  const result = projectSenderPayload(source);
  ok(result.type === "available");
  strictEqual(result.representation, "privacy-projection");
  strictEqual(result.redacted, true);
  strictEqual(JSON.stringify(result.value).includes(secret), false);
  ok(JSON.stringify(result.value).includes("retained-proof"));
  ok(JSON.stringify(result.value).includes("retained-signature"));
  deepStrictEqual(source, original);
  ok(Object.isFrozen(result));
  ok(Object.isFrozen(result.value));
  const value = result.value as Record<string, unknown>;
  ok(Object.isFrozen(value.object));
  source.object.children[0].content = "changed";
  ok(JSON.stringify(result.value).includes("visible"));
  const expanded = projectSenderPayload([
    {
      "@type": [`${as}#Create`],
      [`${as}#object`]: [
        {
          [`${as}#bcc`]: [{ "@id": secret }],
          [`${as}#content`]: [{ "@value": "visible" }],
        },
      ],
    },
  ]);
  ok(expanded.type === "available");
  strictEqual(expanded.redacted, true);
  strictEqual(JSON.stringify(expanded.value).includes(secret), false);
});

test("sender payload fails closed without evaluating getters or JSON conversion", () => {
  let getters = 0;
  let conversions = 0;
  const getter = {
    "@context": as,
    get object() {
      getters++;
      return "private";
    },
  };
  const conversion = { "@context": as };
  Object.defineProperty(conversion, "toJSON", {
    value() {
      conversions++;
      return {};
    },
  });
  const context = [as];
  Object.defineProperty(context, "includes", {
    get() {
      getters++;
      throw new Error("must not run");
    },
    enumerable: true,
  });
  const cycle: Record<string, unknown> = { "@context": as };
  cycle.object = cycle;
  let deep: unknown = "leaf";
  for (let i = 0; i < 65; i++) deep = { object: deep };
  for (const source of [
    { "@context": [as, { private: `${as}#bcc` }], private: secret },
    {
      "@context": as,
      object: {
        "@context": { as: "https://other.example/" },
        "as:bcc": secret,
      },
    },
    { "@context": [as, "https://unknown.example/context"], private: secret },
    { "@context": [as, { sensitive: "as:bcc" }], sensitive: secret },
    {
      "@context": [
        as,
        { contextHistory: { "@id": `${as}#bcc`, "@type": "@id" } },
      ],
      contextHistory: secret,
    },
    {
      "@context": [as, { toot: `${as}#`, Emoji: "toot:bcc" }],
      Emoji: secret,
    },
    { type: "Create", object: secret },
    getter,
    conversion,
    { "@context": context },
    cycle,
    { "@context": as, object: deep },
    { "@context": as, object: NaN },
    { "@context": as, object: new Date() },
    { "@context": as, object: [undefined] },
  ]) {
    deepStrictEqual(projectSenderPayload(source), {
      stage: "sender-payload",
      type: "unavailable",
      reason: "privacy-filter-unavailable",
    });
  }
  strictEqual(getters, 0);
  strictEqual(conversions, 0);
});

test("sender payload opt-in validates atomically and retains builder selection", () => {
  const builder = createFederationBuilder<void>();
  ok(builder instanceof FederationBuilderImpl);
  const config = { senderPayload: true, onAttempt() {} };
  builder.setOutboundObservers(config);
  const original = builder.outboundObservers;
  config.senderPayload = false;
  strictEqual(original.senderPayload, true);
  for (const value of [null, 1, "true", {}]) {
    throws(
      () => builder.setOutboundObservers({ senderPayload: value as never }),
      TypeError,
    );
    strictEqual(builder.outboundObservers, original);
  }
  builder.setOutboundObservers({});
  strictEqual(builder.outboundObservers.senderPayload, false);
});
