import { test } from "node:test";
import { RULE_IDS } from "../lib/const.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/media-uploader-object-uri-required.ts";

const ruleName = RULE_IDS.mediaUploaderObjectUriRequired;
const EXPECTED = "derived from";

test(
  `${ruleName}: ✅ Good - returns ctx.getObjectUri() directly`,
  lintTest({
    code: `
import { Video } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    return ctx.getObjectUri(Video, { uuid: "abc" });
  },
);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - returns an object whose id is ctx.getObjectUri()`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    return new Image({
      id: ctx.getObjectUri(Image, { uuid: "abc" }),
      url: new URL("https://example.com/abc.png"),
      mediaType: file.type,
      name: object.name,
    });
  },
);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - getObjectUri stored in a variable`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    const id = ctx.getObjectUri(Image, { uuid: "abc" });
    return new Image({ id });
  },
);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - named callback using getObjectUri`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

const uploader = async (ctx, identifier, file, object) => {
  return new Image({ id: ctx.getObjectUri(Image, { uuid: "abc" }) });
};

federation.setMediaUploader("/users/{identifier}/media", uploader);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - destructured getObjectUri alias`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async ({ getObjectUri }, identifier, file, object) => {
    return getObjectUri(Image, { uuid: "abc" });
  },
);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - non-federation object`,
  lintTest({
    code: `
federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => new URL("https://example.com/x"),
);
`,
    rule,
    ruleName,
    federationSetup: `
      const federation = {
        setMediaUploader: () => ({ authorize: () => {} }),
      };
    `,
  }),
);

test(
  `${ruleName}: ❌ Bad - returns a plain URL`,
  lintTest({
    code: `
federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    return new URL("https://example.com/x");
  },
);
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);

test(
  `${ruleName}: ❌ Bad - object id not from getObjectUri`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    return new Image({ id: new URL("https://example.com/x") });
  },
);
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);

test(
  `${ruleName}: ❌ Bad - getObjectUri only mentioned in a comment`,
  lintTest({
    code: `
federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    // TODO: use ctx.getObjectUri(Image, { uuid }) once ready
    return new URL("https://example.com/x");
  },
);
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);

test(
  `${ruleName}: ❌ Bad - getObjectUri in a dead branch, returns hard-coded URL`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    if (file.size > 1000) {
      // Called for an unrelated side effect, not returned.
      ctx.getObjectUri(Image, { uuid: "unused" });
    }
    return new URL("https://example.com/hard-coded");
  },
);
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);

test(
  `${ruleName}: ✅ Good - getObjectUri returned in both branches`,
  lintTest({
    code: `
import { Image, Video } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    if (file.type.startsWith("video/")) {
      return ctx.getObjectUri(Video, { uuid: "abc" });
    }
    return new Image({ id: ctx.getObjectUri(Image, { uuid: "abc" }) });
  },
);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - one branch derives, the other returns hard-coded`,
  lintTest({
    code: `
import { Video } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    if (file.type.startsWith("video/")) {
      return ctx.getObjectUri(Video, { uuid: "abc" });
    }
    return new URL("https://example.com/hard-coded");
  },
);
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);

test(
  `${ruleName}: ❌ Bad - id hard-coded even though another property uses getObjectUri`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    return new Image({
      id: new URL("https://example.com/hard-coded"),
      url: ctx.getObjectUri(Image, { uuid: "abc" }),
    });
  },
);
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);

test(
  `${ruleName}: ✅ Good - callback passed as an object member`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

const uploaders = {
  image: async (ctx, identifier, file, object) =>
    new Image({ id: ctx.getObjectUri(Image, { uuid: "abc" }) }),
};

federation.setMediaUploader("/users/{identifier}/media", uploaders.image);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - object-member callback returns a hard-coded URL`,
  lintTest({
    code: `
const uploaders = {
  image: async (ctx, identifier, file, object) =>
    new URL("https://example.com/hard-coded"),
};

federation.setMediaUploader("/users/{identifier}/media", uploaders.image);
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);

test(
  `${ruleName}: ❌ Bad - a later duplicate id overrides the derived one`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    return new Image({
      id: ctx.getObjectUri(Image, { uuid: "abc" }),
      id: new URL("https://example.com/hard-coded"),
    });
  },
);
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);

test(
  `${ruleName}: ❌ Bad - a spread after id could override it`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    const overrides = { id: new URL("https://example.com/hard-coded") };
    return new Image({
      id: ctx.getObjectUri(Image, { uuid: "abc" }),
      ...overrides,
    });
  },
);
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);

test(
  `${ruleName}: ✅ Good - a spread before an explicit derived id`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    const base = { mediaType: file.type };
    return new Image({
      ...base,
      id: ctx.getObjectUri(Image, { uuid: "abc" }),
    });
  },
);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - getObjectUri called on some other object, not ctx`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

const helper = { getObjectUri: (cls, values) => new URL("https://example.com/x") };

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (ctx, identifier, file, object) => {
    return new Image({ id: helper.getObjectUri(Image, { uuid: "abc" }) });
  },
);
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);

test(
  `${ruleName}: ✅ Good - getObjectUri on a renamed context parameter`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  async (context, identifier, file, object) => {
    return new Image({ id: context.getObjectUri(Image, { uuid: "abc" }) });
  },
);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - a synchronous callback wrapping getObjectUri in Promise.resolve`,
  lintTest({
    code: `
import { Video } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  (ctx, identifier, file, object) =>
    Promise.resolve(ctx.getObjectUri(Video, { uuid: "abc" })),
);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - Promise.resolve wrapping an object with a derived id`,
  lintTest({
    code: `
import { Image } from "@fedify/vocab";

federation.setMediaUploader(
  "/users/{identifier}/media",
  (ctx, identifier, file, object) =>
    Promise.resolve(new Image({ id: ctx.getObjectUri(Image, { uuid: "abc" }) })),
);
`,
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - Promise.resolve wrapping a hard-coded URL`,
  lintTest({
    code: `
federation.setMediaUploader(
  "/users/{identifier}/media",
  (ctx, identifier, file, object) =>
    Promise.resolve(new URL("https://example.com/hard-coded")),
);
`,
    rule,
    ruleName,
    expectedError: EXPECTED,
  }),
);
