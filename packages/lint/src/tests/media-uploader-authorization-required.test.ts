import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/media-uploader-authorization-required.ts";

const ruleName = RULE_IDS.mediaUploaderAuthorizationRequired;
const EXPECTED = "protected with .authorize()";

test(
  `${ruleName}: ✅ Good - chained .authorize()`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation
  .setMediaUploader(
    "/users/{identifier}/media",
    async (ctx) => ctx.getObjectUri(Image, { uuid: "abc" }),
  )
  .authorize((ctx, identifier) => identifier === "me");
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - setter stored then authorized`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

const uploader = federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx) => ctx.getObjectUri(Image, { uuid: "abc" }),
);
uploader.authorize((ctx, identifier) => identifier === "me");
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - non-federation object`,
  lintTest({
    code: `
federation.setMediaUploader("/users/{identifier}/media", async () => {});
`,
    rule,
    ruleName,
    federationSetup: `
      const federation = { setMediaUploader: () => ({ authorize: () => {} }) };
    `,
  }),
);

test(
  `${ruleName}: ❌ Bad - no .authorize()`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx) => ctx.getObjectUri(Image, { uuid: "abc" }),
);
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);

test(
  `${ruleName}: ❌ Bad - stored setter never authorized`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

const uploader = federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx) => ctx.getObjectUri(Image, { uuid: "abc" }),
);
uploader.on(Image, () => {});
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);
