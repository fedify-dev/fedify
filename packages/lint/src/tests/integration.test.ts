/**
 * Integration tests for all Fedify lint rules.
 * Based on the example code in examples/lint/deno/mod.ts
 *
 * All tests start from the complete valid code and modify only the part
 * necessary to trigger the specific lint rule being tested.
 */
import { assert, assertEquals } from "jsr:@std/assert";
import { test } from "node:test";
import plugin from "../mod.ts";

const PLUGIN_NAME = "fedify-lint";

/**
 * Run all lint rules on the given code and return diagnostics.
 */
function lintCode(code: string): Deno.lint.Diagnostic[] {
  return Deno.lint.runPlugin(plugin, "integration.test.ts", code);
}

/**
 * Assert that the code passes all lint rules (no diagnostics).
 */
function assertNoErrors(code: string, message?: string) {
  const diagnostics = lintCode(code);
  assertEquals(
    diagnostics.length,
    0,
    message ??
      `Expected no errors but got: ${
        diagnostics.map((d) => `${d.id}: ${d.message}`).join(", ")
      }`,
  );
}

/**
 * Assert that the code has exactly one error matching the given rule.
 */
function assertHasError(code: string, ruleName: string, message?: string) {
  const diagnostics = lintCode(code);
  const ruleId = `${PLUGIN_NAME}/${ruleName}`;
  const matched = diagnostics.some((d) => d.id === ruleId);
  assert(
    matched,
    message ??
      `Expected error from ${ruleName} but got: ${
        diagnostics.length === 0
          ? "no errors"
          : diagnostics.map((d) => d.id).join(", ")
      }`,
  );
}

// =============================================================================
// Complete Valid Code (based on examples/lint/deno/mod.ts)
// =============================================================================

/**
 * Complete valid code that passes all lint rules.
 * This is the baseline for all tests - each test modifies only what's needed.
 */
const COMPLETE_VALID_CODE = `
import {
  createFederation,
  Endpoints,
  InProcessMessageQueue,
  MemoryKvStore,
  Person,
} from "@fedify/fedify";

const federation = createFederation({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    const keyPairs = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      name: "John Doe",
      summary: "A test actor for comprehensive lint rule validation",
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      outbox: ctx.getOutboxUri(identifier),
      following: ctx.getFollowingUri(identifier),
      followers: ctx.getFollowersUri(identifier),
      liked: ctx.getLikedUri(identifier),
      featured: ctx.getFeaturedUri(identifier),
      featuredTags: ctx.getFeaturedTagsUri(identifier),
      publicKey: keyPairs[0]?.cryptographicKey,
      assertionMethod: keyPairs[0]?.multikey,
    });
  })
  .setKeyPairsDispatcher(async (_ctx, _identifier) => []);

federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");

federation.setOutboxDispatcher(
  "/users/{identifier}/outbox",
  async (_ctx, _identifier, _cursor) => {
    return { items: [] };
  },
);

federation.setFollowingDispatcher(
  "/users/{identifier}/following",
  async (_ctx, _identifier, _cursor) => {
    return { items: [] };
  },
);

federation.setFollowersDispatcher(
  "/users/{identifier}/followers",
  async (_ctx, _identifier, _cursor, _filter) => {
    return { items: [] };
  },
);

federation.setLikedDispatcher(
  "/users/{identifier}/liked",
  async (_ctx, _identifier, _cursor) => {
    return { items: [] };
  },
);

federation.setFeaturedDispatcher(
  "/users/{identifier}/featured",
  async (_ctx, _identifier, _cursor) => {
    return { items: [] };
  },
);

federation.setFeaturedTagsDispatcher(
  "/users/{identifier}/tags",
  async (_ctx, _identifier, _cursor) => {
    return { items: [] };
  },
);
`;

// =============================================================================
// Test: Complete Valid Code
// =============================================================================

test("Integration: ✅ Complete valid code passes all rules", () => {
  assertNoErrors(COMPLETE_VALID_CODE);
});

// =============================================================================
// Test: *-required rules (property missing when dispatcher is configured)
// =============================================================================

test("Integration: ❌ actor-id-required - missing id property", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "id: ctx.getActorUri(identifier),",
    "// id: ctx.getActorUri(identifier), // REMOVED",
  );
  assertHasError(code, "actor-id-required");
});

test("Integration: ❌ actor-inbox-property-required - missing inbox property", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "inbox: ctx.getInboxUri(identifier),",
    "// inbox: ctx.getInboxUri(identifier), // REMOVED",
  );
  assertHasError(code, "actor-inbox-property-required");
});

test("Integration: ❌ actor-shared-inbox-property-required - missing sharedInbox property", () => {
  const code = COMPLETE_VALID_CODE.replace(
    `endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),`,
    "// endpoints: REMOVED",
  );
  assertHasError(code, "actor-shared-inbox-property-required");
});

test("Integration: ❌ actor-following-property-required - missing following property", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "following: ctx.getFollowingUri(identifier),",
    "// following: ctx.getFollowingUri(identifier), // REMOVED",
  );
  assertHasError(code, "actor-following-property-required");
});

test("Integration: ❌ actor-followers-property-required - missing followers property", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "followers: ctx.getFollowersUri(identifier),",
    "// followers: ctx.getFollowersUri(identifier), // REMOVED",
  );
  assertHasError(code, "actor-followers-property-required");
});

test("Integration: ❌ actor-outbox-property-required - missing outbox property", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "outbox: ctx.getOutboxUri(identifier),",
    "// outbox: ctx.getOutboxUri(identifier), // REMOVED",
  );
  assertHasError(code, "actor-outbox-property-required");
});

test("Integration: ❌ actor-liked-property-required - missing liked property", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "liked: ctx.getLikedUri(identifier),",
    "// liked: ctx.getLikedUri(identifier), // REMOVED",
  );
  assertHasError(code, "actor-liked-property-required");
});

test("Integration: ❌ actor-featured-property-required - missing featured property", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "featured: ctx.getFeaturedUri(identifier),",
    "// featured: ctx.getFeaturedUri(identifier), // REMOVED",
  );
  assertHasError(code, "actor-featured-property-required");
});

test("Integration: ❌ actor-featured-tags-property-required - missing featuredTags property", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "featuredTags: ctx.getFeaturedTagsUri(identifier),",
    "// featuredTags: ctx.getFeaturedTagsUri(identifier), // REMOVED",
  );
  assertHasError(code, "actor-featured-tags-property-required");
});

test("Integration: ❌ actor-public-key-required - missing publicKey property", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "publicKey: keyPairs[0]?.cryptographicKey,",
    "// publicKey: keyPairs[0]?.cryptographicKey, // REMOVED",
  );
  assertHasError(code, "actor-public-key-required");
});

test("Integration: ❌ actor-assertion-method-required - missing assertionMethod property", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "assertionMethod: keyPairs[0]?.multikey,",
    "// assertionMethod: keyPairs[0]?.multikey, // REMOVED",
  );
  assertHasError(code, "actor-assertion-method-required");
});

// =============================================================================
// Test: *-mismatch rules (property uses wrong context method)
// =============================================================================

test("Integration: ❌ actor-id-mismatch - id uses wrong context method", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "id: ctx.getActorUri(identifier),",
    "id: ctx.getInboxUri(identifier), // WRONG METHOD",
  );
  assertHasError(code, "actor-id-mismatch");
});

test("Integration: ❌ actor-inbox-property-mismatch - inbox uses wrong context method", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "inbox: ctx.getInboxUri(identifier),",
    "inbox: ctx.getOutboxUri(identifier), // WRONG METHOD",
  );
  assertHasError(code, "actor-inbox-property-mismatch");
});

test("Integration: ❌ actor-shared-inbox-property-mismatch - sharedInbox uses wrong context method", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "sharedInbox: ctx.getInboxUri(),",
    "sharedInbox: ctx.getOutboxUri(identifier), // WRONG METHOD",
  );
  assertHasError(code, "actor-shared-inbox-property-mismatch");
});

test("Integration: ❌ actor-following-property-mismatch - following uses wrong context method", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "following: ctx.getFollowingUri(identifier),",
    "following: ctx.getFollowersUri(identifier), // WRONG METHOD",
  );
  assertHasError(code, "actor-following-property-mismatch");
});

test("Integration: ❌ actor-followers-property-mismatch - followers uses wrong context method", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "followers: ctx.getFollowersUri(identifier),",
    "followers: ctx.getFollowingUri(identifier), // WRONG METHOD",
  );
  assertHasError(code, "actor-followers-property-mismatch");
});

test("Integration: ❌ actor-outbox-property-mismatch - outbox uses wrong context method", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "outbox: ctx.getOutboxUri(identifier),",
    "outbox: ctx.getInboxUri(identifier), // WRONG METHOD",
  );
  assertHasError(code, "actor-outbox-property-mismatch");
});

test("Integration: ❌ actor-liked-property-mismatch - liked uses wrong context method", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "liked: ctx.getLikedUri(identifier),",
    "liked: ctx.getOutboxUri(identifier), // WRONG METHOD",
  );
  assertHasError(code, "actor-liked-property-mismatch");
});

test("Integration: ❌ actor-featured-property-mismatch - featured uses wrong context method", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "featured: ctx.getFeaturedUri(identifier),",
    "featured: ctx.getOutboxUri(identifier), // WRONG METHOD",
  );
  assertHasError(code, "actor-featured-property-mismatch");
});

test("Integration: ❌ actor-featured-tags-property-mismatch - featuredTags uses wrong context method", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "featuredTags: ctx.getFeaturedTagsUri(identifier),",
    "featuredTags: ctx.getOutboxUri(identifier), // WRONG METHOD",
  );
  assertHasError(code, "actor-featured-tags-property-mismatch");
});

// =============================================================================
// Test: collection-filtering-not-implemented
// =============================================================================

test("Integration: ❌ collection-filtering-not-implemented - setFollowersDispatcher without filter parameter", () => {
  const code = COMPLETE_VALID_CODE.replace(
    "async (_ctx, _identifier, _cursor, _filter) => {",
    "async (_ctx, _identifier, _cursor) => { // NO FILTER",
  );
  assertHasError(code, "collection-filtering-not-implemented");
});

// =============================================================================
// Test: Non-Federation objects should not trigger errors
// =============================================================================

test("Integration: ✅ Non-Federation object - custom federation object", () => {
  const code = COMPLETE_VALID_CODE.replace(
    `const federation = createFederation({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});`,
    `const federation = {
  setActorDispatcher: () => ({ setKeyPairsDispatcher: () => {} }),
  setInboxListeners: () => {},
  setOutboxDispatcher: () => {},
  setFollowingDispatcher: () => {},
  setFollowersDispatcher: () => {},
  setLikedDispatcher: () => {},
  setFeaturedDispatcher: () => {},
  setFeaturedTagsDispatcher: () => {},
};`,
  );
  assertNoErrors(code);
});

// =============================================================================
// Test: Dispatcher not configured - property not required
// =============================================================================

test("Integration: ✅ No setFollowingDispatcher - following property not required", () => {
  // Remove the following property AND the setFollowingDispatcher
  const code = COMPLETE_VALID_CODE
    .replace(
      "following: ctx.getFollowingUri(identifier),",
      "// following: REMOVED",
    )
    .replace(
      `federation.setFollowingDispatcher(
  "/users/{identifier}/following",
  async (_ctx, _identifier, _cursor) => {
    return { items: [] };
  },
);`,
      "// setFollowingDispatcher REMOVED",
    );
  assertNoErrors(code);
});

test("Integration: ✅ No setFollowersDispatcher - followers property not required", () => {
  const code = COMPLETE_VALID_CODE
    .replace(
      "followers: ctx.getFollowersUri(identifier),",
      "// followers: REMOVED",
    )
    .replace(
      `federation.setFollowersDispatcher(
  "/users/{identifier}/followers",
  async (_ctx, _identifier, _cursor, _filter) => {
    return { items: [] };
  },
);`,
      "// setFollowersDispatcher REMOVED",
    );
  assertNoErrors(code);
});

test("Integration: ✅ No setOutboxDispatcher - outbox property not required", () => {
  const code = COMPLETE_VALID_CODE
    .replace(
      "outbox: ctx.getOutboxUri(identifier),",
      "// outbox: REMOVED",
    )
    .replace(
      `federation.setOutboxDispatcher(
  "/users/{identifier}/outbox",
  async (_ctx, _identifier, _cursor) => {
    return { items: [] };
  },
);`,
      "// setOutboxDispatcher REMOVED",
    );
  assertNoErrors(code);
});

test("Integration: ✅ No setLikedDispatcher - liked property not required", () => {
  const code = COMPLETE_VALID_CODE
    .replace(
      "liked: ctx.getLikedUri(identifier),",
      "// liked: REMOVED",
    )
    .replace(
      `federation.setLikedDispatcher(
  "/users/{identifier}/liked",
  async (_ctx, _identifier, _cursor) => {
    return { items: [] };
  },
);`,
      "// setLikedDispatcher REMOVED",
    );
  assertNoErrors(code);
});

test("Integration: ✅ No setFeaturedDispatcher - featured property not required", () => {
  const code = COMPLETE_VALID_CODE
    .replace(
      "featured: ctx.getFeaturedUri(identifier),",
      "// featured: REMOVED",
    )
    .replace(
      `federation.setFeaturedDispatcher(
  "/users/{identifier}/featured",
  async (_ctx, _identifier, _cursor) => {
    return { items: [] };
  },
);`,
      "// setFeaturedDispatcher REMOVED",
    );
  assertNoErrors(code);
});

test("Integration: ✅ No setFeaturedTagsDispatcher - featuredTags property not required", () => {
  const code = COMPLETE_VALID_CODE
    .replace(
      "featuredTags: ctx.getFeaturedTagsUri(identifier),",
      "// featuredTags: REMOVED",
    )
    .replace(
      `federation.setFeaturedTagsDispatcher(
  "/users/{identifier}/tags",
  async (_ctx, _identifier, _cursor) => {
    return { items: [] };
  },
);`,
      "// setFeaturedTagsDispatcher REMOVED",
    );
  assertNoErrors(code);
});

test("Integration: ✅ No setInboxListeners - inbox/sharedInbox not required", () => {
  const code = COMPLETE_VALID_CODE
    .replace(
      "inbox: ctx.getInboxUri(identifier),",
      "// inbox: REMOVED",
    )
    .replace(
      `endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),`,
      "// endpoints: REMOVED",
    )
    .replace(
      `federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");`,
      "// setInboxListeners REMOVED",
    );
  assertNoErrors(code);
});

test("Integration: ✅ No setKeyPairsDispatcher - publicKey/assertionMethod not required", () => {
  const code = COMPLETE_VALID_CODE
    .replace(
      "const keyPairs = await ctx.getActorKeyPairs(identifier);",
      "// keyPairs REMOVED",
    )
    .replace(
      "publicKey: keyPairs[0]?.cryptographicKey,",
      "// publicKey: REMOVED",
    )
    .replace(
      "assertionMethod: keyPairs[0]?.multikey,",
      "// assertionMethod: REMOVED",
    )
    .replace(
      ".setKeyPairsDispatcher(async (_ctx, _identifier) => []);",
      "; // setKeyPairsDispatcher REMOVED",
    );
  assertNoErrors(code);
});

// =============================================================================
// Test: Multiple errors in one file
// =============================================================================

test("Integration: ❌ Multiple errors - missing id and inbox", () => {
  const code = COMPLETE_VALID_CODE
    .replace(
      "id: ctx.getActorUri(identifier),",
      "// id: REMOVED",
    )
    .replace(
      "inbox: ctx.getInboxUri(identifier),",
      "// inbox: REMOVED",
    );

  const diagnostics = lintCode(code);
  const ruleIds = diagnostics.map((d) => d.id);

  assert(
    ruleIds.includes(`${PLUGIN_NAME}/actor-id-required`),
    "Expected actor-id-required error",
  );
  assert(
    ruleIds.includes(`${PLUGIN_NAME}/actor-inbox-property-required`),
    "Expected actor-inbox-property-required error",
  );
});
