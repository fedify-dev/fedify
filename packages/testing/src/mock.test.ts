import type { InboxContext, OutboxContext } from "@fedify/fedify/federation";
import { signJsonLd } from "@fedify/fedify/sig";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  Activity,
  Arrive,
  Create,
  Follow,
  IntransitiveActivity,
  Note,
  Object as ASObject,
  Person,
  PUBLIC_COLLECTION,
  Tombstone,
  Undo,
} from "@fedify/vocab";
import {
  computeDigestMultibase,
  exportDidKey,
  formatIri,
  parseIri,
  toCompatibleEf61Id,
} from "@fedify/vocab-runtime";
import {
  deepStrictEqual,
  notStrictEqual,
  ok,
  rejects,
  strictEqual,
  throws,
} from "node:assert/strict";
import {
  ed25519PublicKey,
  rsaPrivateKey3,
  rsaPublicKey3,
} from "../../fedify/src/testing/keys.ts";
import {
  createFederation,
  createOutboxContext,
  createRequestContext,
} from "./mock.ts";
import { getDocumentLoader, UrlError } from "@fedify/vocab-runtime";
import { metrics, trace } from "@opentelemetry/api";

test("MockFederation preserves telemetry providers with private-address loaders", () => {
  const meterProvider = metrics.getMeterProvider();
  const tracerProvider = trace.getTracerProvider();
  for (const allowPrivateAddress of [false, true]) {
    const federation = createFederation({
      contextData: {},
      allowPrivateAddress,
      meterProvider,
      tracerProvider,
    });
    const context = federation.createContext(
      new URL("https://example.com/"),
      {},
    );
    strictEqual(context.meterProvider, meterProvider);
    strictEqual(context.tracerProvider, tracerProvider);
  }
});

test("MockFederation actor setters support chaining in any order", () => {
  const federation = createFederation<void>();
  const setters = federation.setActorDispatcher(
    "/users/{identifier}",
    () => null,
  );
  const configure = [
    () => setters.setKeyPairsDispatcher(() => []),
    () => setters.mapHandle((_ctx, handle) => handle),
    () => setters.mapAlias(() => null),
    () => setters.authorize(() => true),
  ];
  for (const first of configure) {
    strictEqual(first(), setters);
    for (const second of configure) {
      strictEqual(second(), setters);
    }
  }
  strictEqual(
    setters.setKeyPairsDispatcher(() => [])
      .mapHandle((_ctx, handle) => handle)
      .mapAlias(() => null)
      .authorize(() => true)
      .setKeyPairsDispatcher(() => []),
    setters,
  );
});

test("MockFederation object setters support chaining authorize", () => {
  const federation = createFederation<void>();
  const setters = federation.setObjectDispatcher(
    Note,
    "/notes/{id}",
    () => null,
  );
  strictEqual(setters.authorize(() => true), setters);
  strictEqual(
    setters.authorize(() => true).authorize(() => false),
    setters,
  );
});

for (
  const method of [
    "setInboxDispatcher",
    "setOutboxDispatcher",
    "setFollowingDispatcher",
    "setFollowersDispatcher",
    "setLikedDispatcher",
    "setFeaturedDispatcher",
    "setFeaturedTagsDispatcher",
    "setCollectionDispatcher",
    "setOrderedCollectionDispatcher",
  ] as const
) {
  test(`MockFederation.${method} setters support chaining in any order`, () => {
    const federation = createFederation<void>();
    const setters = method === "setCollectionDispatcher" ||
        method === "setOrderedCollectionDispatcher"
      ? federation[method]("notes", Note, "/notes/{identifier}", () => null)
      : federation[method]("/users/{identifier}/collection", () => null);
    strictEqual(setters.setCounter(() => 0), setters);
    strictEqual(setters.setFirstCursor(() => null), setters);
    strictEqual(setters.setLastCursor(() => null), setters);
    strictEqual(setters.authorize(() => true), setters);
    strictEqual(
      setters.authorize(() => true)
        .setCounter(() => 0)
        .setFirstCursor(() => null)
        .setLastCursor(() => null)
        .authorize(() => false),
      setters,
    );
    strictEqual(
      setters.setLastCursor(() => null)
        .setFirstCursor(() => null)
        .setCounter(() => 0)
        .authorize(() => true)
        .setLastCursor(() => null),
      setters,
    );
  });
}

test("getSentActivities returns sent activities", async () => {
  const mockFederation = createFederation<void>();
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  // Create a test activity
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      content: "Hello, world!",
    }),
  });

  // Send the activity
  await context.sendActivity(
    { identifier: "alice" },
    new Person({ id: new URL("https://example.com/users/bob") }),
    activity,
  );

  // Check that the activity was recorded
  deepStrictEqual(mockFederation.sentActivities.length, 1);
  strictEqual(mockFederation.sentActivities[0].activity, activity);
  deepStrictEqual(mockFederation.sentActivities[0].queued, false);
  deepStrictEqual(mockFederation.sentActivities[0].sentOrder, 1);
});

test("reset clears sent activities", async () => {
  const mockFederation = createFederation<void>();
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  // Send an activity
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await context.sendActivity(
    { identifier: "alice" },
    new Person({ id: new URL("https://example.com/users/bob") }),
    activity,
  );

  // Verify it was sent
  deepStrictEqual(mockFederation.sentActivities.length, 1);
  strictEqual(mockFederation.sentActivities[0].activity, activity);

  // Clear sent activities
  mockFederation.reset();

  // Verify they were cleared
  deepStrictEqual(mockFederation.sentActivities.length, 0);
});

test("MockFederation accepts inbox request observation registration", () => {
  const federation = createFederation<void>();
  const setters = federation.setInboxListeners("/users/{identifier}/inbox");
  strictEqual(setters.onRequestFinished(() => {}), setters);
  strictEqual(setters.on(Create, () => {}), setters);
});

test("receiveActivity triggers inbox listeners", async () => {
  // Provide contextData through constructor
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
    documentLoader: mockDocumentLoader,
  });
  let receivedActivity: Create | null = null;

  // Set up an inbox listener
  mockFederation
    .setInboxListeners("/users/{identifier}/inbox")
    .on(
      Create,
      (_ctx: InboxContext<{ test: string }>, activity: Create) => {
        receivedActivity = activity;
        return Promise.resolve();
      },
    );

  // Create and receive an activity
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      content: "Test note",
    }),
  });

  await mockFederation.receiveActivity(activity);

  // Verify the listener was triggered
  const received = receivedActivity as Create | null;
  ok(received instanceof Create);
  notStrictEqual(received, activity);
  deepStrictEqual(
    await received.toJsonLd({ format: "expand" }),
    await activity.toJsonLd({ format: "expand" }),
  );
});

test("postOutboxActivity triggers outbox listeners", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  let receivedIdentifier: string | null = null;

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .on(
      Create,
      async (ctx: OutboxContext<{ test: string }>, activity: Create) => {
        receivedIdentifier = ctx.identifier;
        await ctx.sendActivity(
          { identifier: ctx.identifier },
          new Person({ id: new URL("https://example.com/users/bob") }),
          activity,
        );
      },
    );

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      content: "Test note",
    }),
  });

  await mockFederation.postOutboxActivity("alice", activity);

  deepStrictEqual(receivedIdentifier, "alice");
  deepStrictEqual(mockFederation.sentActivities.length, 1);
  strictEqual(mockFederation.sentActivities[0].activity, activity);
});

test("postOutboxActivity supports forwardActivity", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .on(
      Create,
      async (ctx: OutboxContext<{ test: string }>) => {
        await ctx.forwardActivity(
          { identifier: ctx.identifier },
          new Person({ id: new URL("https://example.com/users/bob") }),
        );
      },
    );

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await mockFederation.postOutboxActivity("alice", activity);

  deepStrictEqual(mockFederation.sentActivities.length, 1);
  strictEqual(mockFederation.sentActivities[0].activity, activity);
});

test("postOutboxActivity forwardActivity respects skipIfUnsigned", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .on(
      Create,
      async (ctx: OutboxContext<{ test: string }>) => {
        await ctx.forwardActivity(
          { identifier: ctx.identifier },
          new Person({ id: new URL("https://example.com/users/bob") }),
          { skipIfUnsigned: true },
        );
      },
    );

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await mockFederation.postOutboxActivity("alice", activity);

  deepStrictEqual(mockFederation.sentActivities.length, 0);
});

test(
  "postOutboxActivity forwardActivity treats linked data signatures as signed",
  async () => {
    const mockFederation = createFederation<{ test: string }>({
      contextData: { test: "data" },
    });

    mockFederation.setActorDispatcher(
      "/users/{identifier}",
      (_ctx, identifier) => {
        return new Person({
          id: new URL(`https://example.com/users/${identifier}`),
        });
      },
    );

    mockFederation
      .setOutboxListeners("/users/{identifier}/outbox")
      .on(
        Create,
        async (ctx: OutboxContext<{ test: string }>) => {
          await ctx.forwardActivity(
            { identifier: ctx.identifier },
            new Person({ id: new URL("https://example.com/users/bob") }),
            { skipIfUnsigned: true },
          );
        },
      );

    const signedJson = await signJsonLd(
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/activities/1",
        type: "Create",
        actor: "https://example.com/users/alice",
      },
      rsaPrivateKey3,
      rsaPublicKey3.id!,
      { contextLoader: mockDocumentLoader },
    );
    const activity = await Activity.fromJsonLd(signedJson, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });

    await mockFederation.postOutboxActivity("alice", activity);

    deepStrictEqual(mockFederation.sentActivities.length, 1);
    strictEqual(mockFederation.sentActivities[0].activity, activity);
    deepStrictEqual(mockFederation.sentActivities[0].rawActivity, signedJson);
  },
);

test(
  "postOutboxActivity forwardActivity treats alternate linked data signature suites as signed",
  async () => {
    const mockFederation = createFederation<{ test: string }>({
      contextData: { test: "data" },
    });

    mockFederation.setActorDispatcher(
      "/users/{identifier}",
      (_ctx, identifier) => {
        return new Person({
          id: new URL(`https://example.com/users/${identifier}`),
        });
      },
    );

    mockFederation
      .setOutboxListeners("/users/{identifier}/outbox")
      .on(
        Create,
        async (ctx: OutboxContext<{ test: string }>) => {
          await ctx.forwardActivity(
            { identifier: ctx.identifier },
            new Person({ id: new URL("https://example.com/users/bob") }),
            { skipIfUnsigned: true },
          );
        },
      );

    const signedJson = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/activities/1",
      type: "Create",
      actor: "https://example.com/users/alice",
      signature: {
        type: "Ed25519Signature2020",
        verificationMethod: {
          id: "https://example.com/users/alice#main-key",
        },
        jws: "signature",
      },
    };
    const activity = await Activity.fromJsonLd(signedJson, {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    });

    await mockFederation.postOutboxActivity("alice", activity);

    deepStrictEqual(mockFederation.sentActivities.length, 1);
    strictEqual(mockFederation.sentActivities[0].activity, activity);
    deepStrictEqual(mockFederation.sentActivities[0].rawActivity, signedJson);
  },
);

test(
  "postOutboxActivity forwardActivity treats expanded proof payloads as signed",
  async () => {
    const mockFederation = createFederation<{ test: string }>({
      contextData: { test: "data" },
    });

    mockFederation.setActorDispatcher(
      "/users/{identifier}",
      (_ctx, identifier) => {
        return new Person({
          id: new URL(`https://example.com/users/${identifier}`),
        });
      },
    );

    mockFederation
      .setOutboxListeners("/users/{identifier}/outbox")
      .on(
        Create,
        async (ctx: OutboxContext<{ test: string }>) => {
          await ctx.forwardActivity(
            { identifier: ctx.identifier },
            new Person({ id: new URL("https://example.com/users/bob") }),
            { skipIfUnsigned: true },
          );
        },
      );

    const proofJson = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/activities/1",
      type: "Create",
      actor: "https://example.com/users/alice",
      "https://w3id.org/security#proof": {
        "@type": ["https://w3id.org/security#DataIntegrityProof"],
        "https://w3id.org/security#verificationMethod": [{
          "@id": "https://example.com/users/alice#main-key",
        }],
        "https://w3id.org/security#proofPurpose": [{
          "@id": "https://w3id.org/security#assertionMethod",
        }],
        "https://w3id.org/security#proofValue": [{ "@value": "signature" }],
      },
    };
    const activity = new Create({
      id: new URL("https://example.com/activities/1"),
      actor: new URL("https://example.com/users/alice"),
    });
    Object.assign(activity, {
      toJsonLd: () => Promise.resolve(proofJson),
    });

    await mockFederation.postOutboxActivity("alice", activity);

    deepStrictEqual(mockFederation.sentActivities.length, 1);
    strictEqual(mockFederation.sentActivities[0].activity, activity);
    deepStrictEqual(mockFederation.sentActivities[0].rawActivity, proofJson);
  },
);

test(
  "postOutboxActivity forwardActivity skips malformed linked data signatures",
  async () => {
    const mockFederation = createFederation<{ test: string }>({
      contextData: { test: "data" },
    });

    mockFederation.setActorDispatcher(
      "/users/{identifier}",
      (_ctx, identifier) => {
        return new Person({
          id: new URL(`https://example.com/users/${identifier}`),
        });
      },
    );

    mockFederation
      .setOutboxListeners("/users/{identifier}/outbox")
      .on(
        Create,
        async (ctx: OutboxContext<{ test: string }>) => {
          await ctx.forwardActivity(
            { identifier: ctx.identifier },
            new Person({ id: new URL("https://example.com/users/bob") }),
            { skipIfUnsigned: true },
          );
        },
      );

    const activity = await Activity.fromJsonLd(
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/activities/1",
        type: "Create",
        actor: "https://example.com/users/alice",
        signature: { type: "RsaSignature2017" },
      },
      {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      },
    );

    await mockFederation.postOutboxActivity("alice", activity);

    deepStrictEqual(mockFederation.sentActivities.length, 0);
  },
);

test("postOutboxActivity prefers the most specific listener", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  const calls: string[] = [];

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .on(Activity, () => {
      calls.push("Activity");
    })
    .on(Create, () => {
      calls.push("Create");
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await mockFederation.postOutboxActivity("alice", activity);

  deepStrictEqual(calls, ["Create"]);
});

test(
  "postOutboxActivity matches listeners through the prototype chain",
  async () => {
    const mockFederation = createFederation<{ test: string }>({
      contextData: { test: "data" },
    });

    mockFederation
      .setActorDispatcher("/users/{identifier}", (_ctx, identifier) => {
        return new Person({
          id: new URL(`https://example.com/users/${identifier}`),
        });
      });
    const calls: string[] = [];

    mockFederation
      .setOutboxListeners("/users/{identifier}/outbox")
      .on(IntransitiveActivity, () => {
        calls.push("IntransitiveActivity");
      });

    const activity = new Arrive({
      id: new URL("https://example.com/activities/1"),
      actor: new URL("https://example.com/users/alice"),
    });

    await mockFederation.postOutboxActivity("alice", activity);

    deepStrictEqual(calls, ["IntransitiveActivity"]);
  },
);

test("postOutboxActivity rejects actor mismatch before dispatch", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  let called = false;

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .on(Create, () => {
      called = true;
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/bob"),
  });

  await rejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    (error) =>
      error instanceof Error &&
      error.message.includes(
        "The activity actor does not match the outbox owner.",
      ),
  );
  deepStrictEqual(called, false);
});

test("postOutboxActivity routes owner mismatch through onError", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  let handled: string | null = null;

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .onError((_ctx: OutboxContext<{ test: string }>, error: Error) => {
      handled = error.message;
    })
    .on(Create, () => {
      throw new Error("listener should not run");
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/bob"),
  });

  await rejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    (error) =>
      error instanceof Error &&
      error.message.includes(
        "The activity actor does not match the outbox owner.",
      ),
  );
  deepStrictEqual(
    handled,
    "The activity actor does not match the outbox owner.",
  );
});

test("postOutboxActivity routes missing actor through onError", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  let handled: string | null = null;

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .onError((_ctx: OutboxContext<{ test: string }>, error: Error) => {
      handled = error.message;
    })
    .on(Create, () => {
      throw new Error("listener should not run");
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
  });

  await rejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    (error) =>
      error instanceof Error &&
      error.message.includes("The posted activity has no actor."),
  );
  deepStrictEqual(handled, "The posted activity has no actor.");
});

test("postOutboxActivity onError can forward after validation failure", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .onError(async (ctx: OutboxContext<{ test: string }>) => {
      await ctx.forwardActivity(
        { identifier: ctx.identifier },
        new Person({ id: new URL("https://example.com/users/bob") }),
      );
    })
    .on(Create, () => {
      throw new Error("listener should not run");
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/bob"),
  });

  await rejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    (error) =>
      error instanceof Error &&
      error.message.includes(
        "The activity actor does not match the outbox owner.",
      ),
  );
  deepStrictEqual(mockFederation.sentActivities.length, 1);
  strictEqual(mockFederation.sentActivities[0].activity, activity);
  deepStrictEqual(mockFederation.sentActivities[0].rawActivity != null, true);
});

test("postOutboxActivity missing owner does not invoke onError", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  let handled = false;

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .onError((_ctx: OutboxContext<{ test: string }>, _error: Error) => {
      handled = true;
    })
    .on(Create, () => {
      throw new Error("listener should not run");
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await rejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    (error) =>
      error instanceof Error &&
      error.message.includes('Actor "alice" not found.'),
  );
  deepStrictEqual(handled, false);
});

test(
  "postOutboxActivity accepts the dispatched actor id as the owner",
  async () => {
    const mockFederation = createFederation<{ test: string }>({
      contextData: { test: "data" },
    });
    let called = false;

    mockFederation.setActorDispatcher(
      "/users/{identifier}",
      (_ctx, identifier) => {
        if (identifier !== "alice") return null;
        return new Person({
          id: new URL("https://example.com/actors/alice"),
        });
      },
    );

    mockFederation
      .setOutboxListeners("/users/{identifier}/outbox")
      .on(Create, () => {
        called = true;
      });

    const activity = new Create({
      id: new URL("https://example.com/activities/1"),
      actor: new URL("https://example.com/actors/alice"),
    });

    await mockFederation.postOutboxActivity("alice", activity);

    deepStrictEqual(called, true);
  },
);

test("postOutboxActivity rejects missing actors before dispatch", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  let called = false;

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .on(Create, () => {
      called = true;
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await rejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    (error) =>
      error instanceof Error &&
      error.message.includes('Actor "alice" not found.'),
  );
  deepStrictEqual(called, false);
});

test("postOutboxActivity enforces authorize predicate", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  let called = false;

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .authorize(() => false)
    .on(Create, () => {
      called = true;
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await rejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    (error) =>
      error instanceof Error && error.message.includes("Unauthorized."),
  );
  deepStrictEqual(called, false);
});

test("postOutboxActivity authorize predicate can inspect posted body", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  let seenBody = "";
  let called = false;

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .authorize(async (ctx) => {
      seenBody = await ctx.request.text();
      return true;
    })
    .on(Create, () => {
      called = true;
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await mockFederation.postOutboxActivity("alice", activity);

  deepStrictEqual(seenBody.length > 0, true);
  deepStrictEqual(
    seenBody.includes('"https://www.w3.org/ns/activitystreams#actor"'),
    true,
  );
  deepStrictEqual(seenBody.includes("alice"), true);
  deepStrictEqual(called, true);
});

test("postOutboxActivity falls back to dispatcher authorize predicate", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  let called = false;

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );
  mockFederation
    .setOutboxDispatcher("/users/{identifier}/outbox", () => ({ items: [] }))
    .authorize(() => false);

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .on(Create, () => {
      called = true;
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await rejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    (error) =>
      error instanceof Error && error.message.includes("Unauthorized."),
  );
  deepStrictEqual(called, false);
});

test(
  "postOutboxActivity with matching listener fails fast before auth when contextData is missing",
  async () => {
    const mockFederation = createFederation<void>();
    let authorizeCalled = false;

    mockFederation.setActorDispatcher(
      "/users/{identifier}",
      () => {
        throw new Error("actor dispatcher should not run");
      },
    );
    mockFederation
      .setOutboxDispatcher("/users/{identifier}/outbox", () => ({ items: [] }))
      .authorize(() => {
        authorizeCalled = true;
        return true;
      });
    mockFederation
      .setOutboxListeners("/users/{identifier}/outbox")
      .on(Create, () => {});

    const activity = new Create({
      id: new URL("https://example.com/activities/1"),
      actor: new URL("https://example.com/users/alice"),
    });

    await rejects(
      () => mockFederation.postOutboxActivity("alice", activity),
      (error) =>
        error instanceof Error &&
        error.message.includes(
          "MockFederation.postOutboxActivity(): contextData is not initialized. Please provide contextData through the constructor or call startQueue() before posting activities.",
        ),
    );
    deepStrictEqual(authorizeCalled, false);
  },
);

test("postOutboxActivity fails fast without outbox listeners", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    () => {
      throw new Error("actor dispatcher should not run");
    },
  );

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await rejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    (error) =>
      error instanceof Error &&
      error.message.includes(
        "MockFederation.postOutboxActivity(): setOutboxListeners() is not initialized.",
      ),
  );
});

test("postOutboxActivity with only dispatcher still fails fast", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  mockFederation
    .setOutboxDispatcher("/users/{identifier}/outbox", () => ({ items: [] }));

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await rejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    (error) =>
      error instanceof Error &&
      error.message.includes(
        "MockFederation.postOutboxActivity(): setOutboxListeners() is not initialized.",
      ),
  );
});

test("postOutboxActivity without matching listener is a no-op", async () => {
  const mockFederation = createFederation<void>();
  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );
  mockFederation.setOutboxListeners("/users/{identifier}/outbox");

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await mockFederation.postOutboxActivity("alice", activity);

  deepStrictEqual(mockFederation.sentActivities.length, 0);
});

test(
  "postOutboxActivity without matching listener still validates ownership",
  async () => {
    const mockFederation = createFederation<{ test: string }>({
      contextData: { test: "data" },
    });

    mockFederation.setActorDispatcher(
      "/users/{identifier}",
      (_ctx, identifier) => {
        return new Person({
          id: new URL(`https://example.com/users/${identifier}`),
        });
      },
    );

    mockFederation
      .setOutboxListeners("/users/{identifier}/outbox")
      .on(Arrive, () => {
        throw new Error("listener should not run");
      });

    const activity = new Create({
      id: new URL("https://example.com/activities/1"),
      actor: new URL("https://example.com/users/bob"),
    });

    await rejects(
      () => mockFederation.postOutboxActivity("alice", activity),
      (error) =>
        error instanceof Error &&
        error.message.includes(
          "The activity actor does not match the outbox owner.",
        ),
    );
  },
);

test("postOutboxActivity invokes outbox error handler", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  let handled: string | null = null;

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .onError((_ctx: OutboxContext<{ test: string }>, error: Error) => {
      handled = error.message;
    })
    .on(Create, () => {
      throw new Error("Boom");
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await rejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    (error) => error instanceof Error && error.message.includes("Boom"),
  );
  deepStrictEqual(handled, "Boom");
});

test("setOutboxListeners rejects duplicate listeners for the same type", () => {
  const mockFederation = createFederation<void>();
  const listeners = mockFederation.setOutboxListeners(
    "/users/{identifier}/outbox",
  );

  listeners.on(Create, () => {});

  throws(() => listeners.on(Create, () => {}), TypeError);
});

test("setOutboxListeners rejects duplicate registration", () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  mockFederation.setOutboxListeners("/users/{identifier}/outbox");

  throws(
    () => mockFederation.setOutboxListeners("/users/{identifier}/outbox"),
    (error) =>
      error instanceof TypeError &&
      error.message.includes("Outbox listeners already set."),
  );
});

test("setOutboxListeners requires a leading slash", () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  throws(
    () =>
      mockFederation.setOutboxListeners(
        "users/{identifier}/outbox" as `${string}{identifier}${string}`,
      ),
    (error) =>
      error instanceof TypeError &&
      error.message.includes("Path must start with a slash."),
  );
});

test("setOutboxDispatcher requires a leading slash", () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  throws(
    () =>
      mockFederation.setOutboxDispatcher(
        "users/{identifier}/outbox",
        () => ({ items: [] }),
      ),
    (error) =>
      error instanceof TypeError &&
      error.message.includes("Path must start with a slash."),
  );
});

test("setOutboxListeners validates dispatcher path compatibility", () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  mockFederation.setOutboxDispatcher("/users/{identifier}/outbox", () => ({
    items: [],
  }));

  throws(
    () => mockFederation.setOutboxListeners("/actors/{identifier}/outbox"),
    (error) =>
      error instanceof TypeError &&
      error.message.includes(
        "Outbox listener path and outbox dispatcher path must match.",
      ),
  );
});

test("setOutboxDispatcher validates listener path compatibility", () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  mockFederation.setOutboxListeners("/users/{identifier}/outbox");

  throws(
    () =>
      mockFederation.setOutboxDispatcher("/actors/{identifier}/outbox", () => ({
        items: [],
      })),
    (error) =>
      error instanceof TypeError &&
      error.message.includes(
        "Outbox listener path and outbox dispatcher path must match.",
      ),
  );
});

test("setOutboxListeners validates path variables", () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  throws(
    () =>
      mockFederation.setOutboxListeners(
        "/users/outbox" as `${string}{identifier}${string}`,
      ),
    (error) =>
      error instanceof TypeError &&
      error.message.includes(
        "Path for outbox must have exactly one variable named identifier.",
      ),
  );

  throws(
    () =>
      mockFederation.setOutboxListeners("/users/{identifier}/outbox/{extra}"),
    (error) =>
      error instanceof TypeError &&
      error.message.includes(
        "Path for outbox must have exactly one variable named identifier.",
      ),
  );
});

test("mock outbox context tracks delivery state", async () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  const deliveryStates: boolean[] = [];
  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .on(Create, async (ctx, activity) => {
      deliveryStates.push(ctx.hasDeliveredActivity());
      await ctx.sendActivity(
        { identifier: ctx.identifier },
        new Person({ id: new URL("https://example.com/users/bob") }),
        activity,
      );
      deliveryStates.push(ctx.hasDeliveredActivity());
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await mockFederation.postOutboxActivity("alice", activity);

  deepStrictEqual(deliveryStates, [false, true]);
});

test("createOutboxContext exposes identifier", () => {
  const mockFederation = createFederation<void>();
  const ctx = createOutboxContext({
    federation: mockFederation,
    data: undefined,
    identifier: "alice",
  });

  deepStrictEqual((ctx as OutboxContext<void>).identifier, "alice");
  deepStrictEqual(ctx.clone(undefined).identifier, "alice");
});

test("MockContext tracks sent activities", async () => {
  const mockFederation = createFederation<void>();
  const mockContext = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  // Create a test activity
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      content: "Hello from MockContext!",
    }),
  });

  // Send the activity
  await mockContext.sendActivity(
    { identifier: "alice" },
    new Person({ id: new URL("https://example.com/users/bob") }),
    activity,
  );

  // Check that the activity was recorded in the federation
  deepStrictEqual(mockFederation.sentActivities.length, 1);
  strictEqual(mockFederation.sentActivities[0].activity, activity);
});

test("MockContext URI methods should work correctly", () => {
  const mockFederation = createFederation<void>();
  const mockContext = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  // Test URI generation methods
  deepStrictEqual(
    mockContext.getActorUri("alice").href,
    "https://example.com/users/alice",
  );
  deepStrictEqual(
    mockContext.getInboxUri("alice").href,
    "https://example.com/users/alice/inbox",
  );
  deepStrictEqual(mockContext.getInboxUri().href, "https://example.com/inbox");
  deepStrictEqual(
    mockContext.getOutboxUri("alice").href,
    "https://example.com/users/alice/outbox",
  );
  deepStrictEqual(
    mockContext.getFollowingUri("alice").href,
    "https://example.com/users/alice/following",
  );
  deepStrictEqual(
    mockContext.getFollowersUri("alice").href,
    "https://example.com/users/alice/followers",
  );

  const actorUri = new URL("https://example.com/users/alice");
  const parsed = mockContext.parseUri(actorUri);
  deepStrictEqual(parsed?.type, "actor");
  if (parsed?.type === "actor") {
    deepStrictEqual(parsed.identifier, "alice");
  }
});

test("MockContext URI methods respect registered paths", () => {
  const mockFederation = createFederation<void>();

  // Register custom paths with dummy dispatchers
  mockFederation.setNodeInfoDispatcher("/.well-known/nodeinfo", () => ({
    software: { name: "test", version: "1.0.0" },
    protocols: [],
    usage: {
      users: {},
      localPosts: 0,
      localComments: 0,
    },
  }));
  mockFederation.setActorDispatcher("/actors/{identifier}", () => null);
  mockFederation.setObjectDispatcher(Note, "/notes/{id}", () => null);
  mockFederation.setInboxListeners(
    "/actors/{identifier}/inbox",
    "/shared-inbox",
  );
  mockFederation.setOutboxDispatcher("/actors/{identifier}/outbox", () => null);
  mockFederation.setFollowingDispatcher(
    "/actors/{identifier}/following",
    () => null,
  );
  mockFederation.setFollowersDispatcher(
    "/actors/{identifier}/followers",
    () => null,
  );
  mockFederation.setLikedDispatcher("/actors/{identifier}/liked", () => null);
  mockFederation.setFeaturedDispatcher(
    "/actors/{identifier}/featured",
    () => null,
  );
  mockFederation.setFeaturedTagsDispatcher(
    "/actors/{identifier}/tags",
    () => null,
  );

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  // Test that URIs use the registered paths
  deepStrictEqual(
    context.getNodeInfoUri().href,
    "https://example.com/.well-known/nodeinfo",
  );
  deepStrictEqual(
    context.getActorUri("alice").href,
    "https://example.com/actors/alice",
  );
  deepStrictEqual(
    context.getObjectUri(Note, { id: "123" }).href,
    "https://example.com/notes/123",
  );
  deepStrictEqual(
    context.getInboxUri("alice").href,
    "https://example.com/actors/alice/inbox",
  );
  deepStrictEqual(
    context.getInboxUri().href,
    "https://example.com/shared-inbox",
  );
  deepStrictEqual(
    context.getOutboxUri("alice").href,
    "https://example.com/actors/alice/outbox",
  );
  deepStrictEqual(
    context.getFollowingUri("alice").href,
    "https://example.com/actors/alice/following",
  );
  deepStrictEqual(
    context.getFollowersUri("alice").href,
    "https://example.com/actors/alice/followers",
  );
  deepStrictEqual(
    context.getLikedUri("alice").href,
    "https://example.com/actors/alice/liked",
  );
  deepStrictEqual(
    context.getFeaturedUri("alice").href,
    "https://example.com/actors/alice/featured",
  );
  deepStrictEqual(
    context.getFeaturedTagsUri("alice").href,
    "https://example.com/actors/alice/tags",
  );
});

test("MockContext getOutboxUri respects outbox listener path", () => {
  const mockFederation = createFederation<void>();
  mockFederation.setOutboxListeners("/actors/{identifier}/outbox");

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  deepStrictEqual(
    context.getOutboxUri("alice").href,
    "https://example.com/actors/alice/outbox",
  );
});

test("MockContext getOutboxUri supports reserved expansion", () => {
  const mockFederation = createFederation<void>();
  mockFederation.setOutboxListeners("/actors/{+identifier}/outbox");

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  deepStrictEqual(
    context.getOutboxUri("alice/profile").href,
    "https://example.com/actors/alice/profile/outbox",
  );
});

test("MockContext getOutboxUri supports path-segment expansion", () => {
  const mockFederation = createFederation<void>();
  mockFederation.setOutboxListeners("/actors{/identifier}/outbox");

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  deepStrictEqual(
    context.getOutboxUri("alice/profile").href,
    "https://example.com/actors/alice%2Fprofile/outbox",
  );
});

test("MockContext rejects query expansion for outbox paths", () => {
  const mockFederation = createFederation<void>();
  throws(
    () => mockFederation.setOutboxListeners("/actors/outbox{?identifier}"),
    (error) =>
      error instanceof TypeError &&
      error.message.includes(
        "Path for outbox cannot use query or fragment expansion for identifier.",
      ),
  );
});

test("MockContext reserved expansion encodes non-reserved characters", () => {
  const mockFederation = createFederation<void>();
  mockFederation.setOutboxListeners("/actors/{+identifier}/outbox");

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  deepStrictEqual(
    context.getOutboxUri("alice profile/notes").href,
    "https://example.com/actors/alice%20profile/notes/outbox",
  );
});

test("receiveActivity throws error when contextData not initialized", async () => {
  const mockFederation = createFederation<void>();

  // Set up an inbox listener without initializing contextData
  mockFederation
    .setInboxListeners("/users/{identifier}/inbox")
    .on(Create, (_ctx: InboxContext<void>, _activity: Create) => {
      /* should not happen */
      return Promise.resolve();
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  // Should throw error
  await rejects(
    () => mockFederation.receiveActivity(activity),
    (error) =>
      error instanceof Error &&
      error.message.includes(
        "MockFederation.receiveActivity(): contextData is not initialized. Please provide contextData through the constructor or call startQueue() before receiving activities.",
      ),
  );
});

test("postOutboxActivity throws error when contextData not initialized", async () => {
  const mockFederation = createFederation<void>();

  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => {
      return new Person({
        id: new URL(`https://example.com/users/${identifier}`),
      });
    },
  );

  mockFederation
    .setOutboxListeners("/users/{identifier}/outbox")
    .on(Create, (_ctx: OutboxContext<void>, _activity: Create) => {
      return Promise.resolve();
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await rejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    (error) =>
      error instanceof Error &&
      error.message.includes(
        "MockFederation.postOutboxActivity(): contextData is not initialized. Please provide contextData through the constructor or call startQueue() before posting activities.",
      ),
  );
});

test("MockFederation distinguishes between immediate and queued activities", async () => {
  const mockFederation = createFederation<void>();

  // Start the queue to enable queued sending
  await mockFederation.startQueue(undefined);

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const activity1 = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  const activity2 = new Create({
    id: new URL("https://example.com/activities/2"),
    actor: new URL("https://example.com/users/alice"),
  });

  // Send activities after queue is started - should be marked as queued
  await context.sendActivity(
    { identifier: "alice" },
    new Person({ id: new URL("https://example.com/users/bob") }),
    activity1,
  );

  await context.sendActivity(
    { identifier: "alice" },
    new Person({ id: new URL("https://example.com/users/bob") }),
    activity2,
  );

  // Check activity details
  deepStrictEqual(mockFederation.sentActivities.length, 2);
  strictEqual(mockFederation.sentActivities[0].activity, activity1);
  strictEqual(mockFederation.sentActivities[1].activity, activity2);

  // Both should be marked as sent via queue
  deepStrictEqual(mockFederation.sentActivities[0].queued, true);
  deepStrictEqual(mockFederation.sentActivities[1].queued, true);
  deepStrictEqual(mockFederation.sentActivities[0].queue, "outbox");
  deepStrictEqual(mockFederation.sentActivities[1].queue, "outbox");
  deepStrictEqual(mockFederation.sentActivities[0].sentOrder, 1);
  deepStrictEqual(mockFederation.sentActivities[1].sentOrder, 2);
});

test("MockFederation without queue sends all activities immediately", async () => {
  const mockFederation = createFederation<void>();

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  // Send activity - should be marked as immediate since queue not started
  await context.sendActivity(
    { identifier: "alice" },
    new Person({ id: new URL("https://example.com/users/bob") }),
    activity,
  );

  // Check activity details
  deepStrictEqual(mockFederation.sentActivities.length, 1);
  strictEqual(mockFederation.sentActivities[0].activity, activity);

  // Should be marked as sent immediately
  deepStrictEqual(mockFederation.sentActivities[0].queued, false);
  deepStrictEqual(mockFederation.sentActivities[0].queue, undefined);
  deepStrictEqual(mockFederation.sentActivities[0].sentOrder, 1);
});

test("MockContext.getActor() calls registered actor dispatcher", async () => {
  const mockFederation = createFederation<void>();

  // Register actor dispatcher
  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (ctx, identifier) => {
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        name: `Test User ${identifier}`,
      });
    },
  ).mapHandle((_ctx, handle) => handle).mapAlias(() => null).authorize(() =>
    true
  );

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const actor = await context.getActor("alice");

  deepStrictEqual(actor instanceof Person, true);
  deepStrictEqual(actor?.preferredUsername, "alice");
  deepStrictEqual(actor?.name, "Test User alice");
  deepStrictEqual(actor?.id?.href, "https://example.com/users/alice");
});

test("MockContext.getObject() calls registered object dispatcher", async () => {
  const mockFederation = createFederation<void>();

  // Register object dispatcher
  mockFederation.setObjectDispatcher(
    Note,
    "/users/{identifier}/posts/{postId}",
    (ctx, values) => {
      return new Note({
        id: ctx.getObjectUri(Note, values),
        content: `Post ${values.postId} by ${values.identifier}`,
      });
    },
  ).authorize(() => true).authorize(() => true);

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const note = await context.getObject(Note, {
    identifier: "alice",
    postId: "123",
  });

  deepStrictEqual(note instanceof Note, true);
  deepStrictEqual(note?.content, "Post 123 by alice");
  deepStrictEqual(note?.id?.href, "https://example.com/users/alice/posts/123");
});

test("MockContext.getActor() returns null when no dispatcher registered", async () => {
  const mockFederation = createFederation<void>();
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const actor = await context.getActor("alice");
  deepStrictEqual(actor, null);
});

test("MockContext.getObject() returns null when no dispatcher registered", async () => {
  const mockFederation = createFederation<void>();
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const note = await context.getObject(Note, {
    identifier: "alice",
    postId: "123",
  });
  deepStrictEqual(note, null);
});

test("MockContext.getActorKeyPairs() calls registered key pairs dispatcher", async () => {
  const mockFederation = createFederation<void>();

  // Generate a test RSA key pair
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  // Register actor dispatcher with key pairs dispatcher
  mockFederation
    .setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
      });
    })
    .setKeyPairsDispatcher((ctx, identifier) => {
      return [
        {
          keyId: new URL(`${ctx.getActorUri(identifier).href}#main-key`),
          privateKey: keyPair.privateKey,
          publicKey: keyPair.publicKey,
        },
      ];
    })
    .mapHandle((_ctx, handle) => handle)
    .mapAlias(() => null)
    .authorize(() => true);

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const keyPairs = await context.getActorKeyPairs("alice");

  deepStrictEqual(keyPairs.length, 1);
  deepStrictEqual(
    keyPairs[0].keyId.href,
    "https://example.com/users/alice#main-key",
  );
  strictEqual(keyPairs[0].privateKey, keyPair.privateKey);
  strictEqual(keyPairs[0].publicKey, keyPair.publicKey);
  deepStrictEqual(
    keyPairs[0].cryptographicKey.id?.href,
    keyPairs[0].keyId.href,
  );
  deepStrictEqual(
    keyPairs[0].cryptographicKey.ownerId?.href,
    "https://example.com/users/alice",
  );
  deepStrictEqual(keyPairs[0].multikey.id?.href, keyPairs[0].keyId.href);
  deepStrictEqual(
    keyPairs[0].multikey.controllerId?.href,
    "https://example.com/users/alice",
  );
});

test("MockFederation actor setters chain from mapPortableActorId()", () => {
  const mockFederation = createFederation<void>();
  const keyPairsDispatcher = () => [];
  mockFederation
    .setActorDispatcher("/users/{identifier}", () => null)
    .mapPortableActorId(() => null)
    .setKeyPairsDispatcher(keyPairsDispatcher);
  strictEqual(
    (mockFederation as unknown as { actorKeyPairsDispatcher: unknown })
      .actorKeyPairsDispatcher,
    keyPairsDispatcher,
  );
});

test("MockContext.getActorKeyPairs() returns empty array when no dispatcher registered", async () => {
  const mockFederation = createFederation<void>();
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const keyPairs = await context.getActorKeyPairs("alice");
  deepStrictEqual(keyPairs, []);
});

// A Standard Schema that only accepts numbers; mirrors a strict task schema.
const numberSchema: StandardSchemaV1<unknown, number> = {
  "~standard": {
    version: 1,
    vendor: "fedify-test",
    validate: (value: unknown) =>
      typeof value === "number"
        ? { value }
        : { issues: [{ message: "Expected a number." }] },
  },
};

test("MockContext.enqueueTask rejects a payload the schema refuses", async () => {
  const federation = createFederation<void>();
  let called = 0;
  const task = federation.defineTask("count", {
    schema: numberSchema,
    handler: () => {
      called++;
    },
  });
  const context = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  await rejects(
    () => context.enqueueTask(task, "not a number" as unknown as number),
    (error) =>
      error instanceof TypeError &&
      error.message.includes("Task data failed schema validation"),
  );
  deepStrictEqual(called, 0); // production fails fast at enqueue; so must the mock
});

test("MockContext.enqueueTask passes the schema's validated output to the handler", async () => {
  const federation = createFederation<void>();
  // A coercing schema: uppercases the string.  Input and output share the
  // same type, but the validated value differs from the raw input.
  const upper: StandardSchemaV1<string, string> = {
    "~standard": {
      version: 1,
      vendor: "fedify-test",
      validate: (value: unknown) =>
        typeof value === "string"
          ? { value: value.toUpperCase() }
          : { issues: [{ message: "Expected a string." }] },
    },
  };
  let received = "UNSET";
  const task = federation.defineTask("shout", {
    schema: upper,
    handler: (_ctx, data) => {
      received = data;
    },
  });
  const context = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  await context.enqueueTask(task, "hi");
  // The handler observes the validated output, not the raw "hi".
  deepStrictEqual(received, "HI");
});

test("MockContext.enqueueTaskMany validates the whole batch before any handler runs", async () => {
  const federation = createFederation<void>();
  const seen: number[] = [];
  const task = federation.defineTask("count-many", {
    schema: numberSchema,
    handler: (_ctx, data) => {
      seen.push(data);
    },
  });
  const context = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  // The second item is invalid: production validates every payload before
  // enqueuing anything, so the whole batch rejects with no effect.  The
  // mock must not let the first handler run before the batch is vetted.
  await rejects(
    () => context.enqueueTaskMany(task, [1, "two" as unknown as number]),
    (error) =>
      error instanceof TypeError &&
      error.message.includes("Task data failed schema validation"),
  );
  deepStrictEqual(seen, []);
});

test("MockContext.enqueueTask rejects a handle from another federation", async () => {
  const federation = createFederation<void>();
  const other = createFederation<void>();
  let called = 0;
  federation.defineTask("shared-name", {
    schema: numberSchema,
    handler: () => {
      called++;
    },
  });
  // Same task name on another federation: production compares the registered
  // handle by identity and rejects the foreign one, so a name-only lookup in
  // the mock would let tests pass with a handle the real federation refuses.
  const foreign = other.defineTask("shared-name", {
    schema: numberSchema,
    handler: () => {},
  });
  const context = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  await rejects(
    () => context.enqueueTask(foreign, 1),
    (error) =>
      error instanceof TypeError &&
      error.message.includes("is not defined on this federation"),
  );
  deepStrictEqual(called, 0);
});

test("MockFederation.setHashlinkMediaDispatcher()", () => {
  const federation = createFederation<void>();
  federation.setHashlinkMediaDispatcher(() => null);
  throws(
    () => federation.setHashlinkMediaDispatcher(() => null),
    (error) =>
      error instanceof TypeError &&
      error.message.includes("Hashlink media dispatcher already set."),
  );
});

test("MockContext uses the injected portable verifier for lookup", async () => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const portableId = parseIri(`ap+ef61://${did}/notes/1`);
  const compatibleId = toCompatibleEf61Id(portableId, "https://example.com");
  const document = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: formatIri(portableId),
    type: "Note",
    content: "A portable note",
  };
  const loaded: string[] = [];
  const verified: unknown[] = [];
  const federation = createFederation<void>({
    documentLoader: (url) => {
      loaded.push(url);
      return Promise.resolve({ contextUrl: null, document, documentUrl: url });
    },
    contextLoader: mockDocumentLoader,
    verifyPortableObject: (value) => {
      verified.push(value);
      return Promise.resolve({ verified: true });
    },
  });
  const context = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  ok((await context.lookupObject(compatibleId)) instanceof Note);
  deepStrictEqual(loaded, [compatibleId.href]);
  deepStrictEqual(verified, [document]);
  ok(
    (await context.clone(undefined).lookupObject(compatibleId)) instanceof Note,
  );
  deepStrictEqual(verified.length, 2);
  let overrides = 0;
  await context.lookupObject(compatibleId, {
    verifyPortableObject: () => {
      overrides++;
      return Promise.resolve({ verified: true });
    },
  });
  deepStrictEqual(overrides, 1);
  deepStrictEqual(verified.length, 2);
  deepStrictEqual(
    await context.lookupObject(compatibleId, {
      verifyPortableObject: () => Promise.resolve({ verified: false }),
    }),
    null,
  );
  deepStrictEqual(
    await createFederation<void>().createContext(
      new URL("https://example.com"),
      undefined,
    )
      .lookupObject(compatibleId),
    null,
  );
});

test("MockContext portable lookup uses a per-call loader", async () => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const portableId = parseIri(`ap+ef61://${did}/notes/1`);
  const compatibleId = toCompatibleEf61Id(portableId, "https://example.com");
  const context = createFederation<void>().createContext(
    new URL("https://example.com"),
    undefined,
  );
  let loaded = 0;
  const documentLoader = (url: string) => {
    if (url !== compatibleId.href) return mockDocumentLoader(url);
    loaded++;
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: formatIri(portableId),
        type: "Note",
      },
    });
  };
  deepStrictEqual(
    await context.lookupObject(compatibleId, { documentLoader }),
    null,
  );
  deepStrictEqual(loaded, 0);
  ok(
    (await context.lookupObject(compatibleId, {
      documentLoader,
      verifyPortableObject: () => Promise.resolve({ verified: true }),
    })) instanceof Note,
  );
  deepStrictEqual(loaded, 1);
  deepStrictEqual(
    await context.lookupObject("@alice@example.com", {
      documentLoader,
    }),
    null,
  );
  deepStrictEqual(
    await context.lookupObject("https://example.com/users/alice", {
      documentLoader,
    }),
    null,
  );
});

test("MockContext carries an explicit portable request to dispatchers", async () => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const portableRequest = {
    authority: did,
    id: parseIri(`ap+ef61://${did}/users/alice`),
  };
  const federation = createFederation<void>();
  federation.setActorDispatcher("/users/{identifier}", (ctx) => {
    strictEqual(ctx.portableRequest, portableRequest);
    return new Person({ id: ctx.getPortableActorUri("alice", did) });
  });
  federation.setObjectDispatcher(Note, "/notes/{id}", (ctx) => {
    strictEqual(ctx.portableRequest, portableRequest);
    return new Note({ id: ctx.getPortableObjectUri(Note, { id: "1" }, did) });
  });
  const request = new Request("https://example.com/.well-known/apgateway/test");
  const context = federation.createContext(request, undefined, {
    portableRequest,
  });
  strictEqual(context.portableRequest, portableRequest);
  strictEqual(context.clone(undefined).portableRequest, portableRequest);
  strictEqual(context.clone(undefined).request, request);
  ok((await context.getActor("alice")) instanceof Person);
  ok((await context.getObject(Note, { id: "1" })) instanceof Note);
  deepStrictEqual(
    federation.createContext(new URL(request.url), undefined).portableRequest,
    undefined,
  );
  deepStrictEqual(
    federation.createContext(request, undefined).portableRequest,
    undefined,
  );
  const createWithUnion = (
    input: URL | Request,
    options?: { portableRequest?: typeof portableRequest },
  ) => federation.createContext(input, undefined, options);
  strictEqual(createWithUnion(request).request, request);
  const unionContext = createWithUnion(request, { portableRequest });
  strictEqual(unionContext.request, request);
  strictEqual(unionContext.portableRequest, portableRequest);
  ok((await unionContext.getActor("alice")) instanceof Person);
  ok((await unionContext.getObject(Note, { id: "1" })) instanceof Note);
});

test("MockFederation.fetch() dispatches hashlink media", async () => {
  const digest = await computeDigestMultibase(
    new TextEncoder().encode("media"),
  );
  const path = `https://example.com/.well-known/apgateway/hl:${digest}`;
  const request = new Request(`${path}?download=1`);
  const federation = createFederation<{ id: number }>();
  const expected = new Response("media", {
    status: 206,
    headers: { "Content-Type": "text/plain" },
  });
  let calls = 0;
  federation.setHashlinkMediaDispatcher((ctx, media) => {
    calls++;
    strictEqual(ctx.request, request);
    deepStrictEqual(ctx.data, { id: 42 });
    deepStrictEqual(ctx.portableRequest, undefined);
    deepStrictEqual(media.hashlink, `hl:${digest}`);
    deepStrictEqual(media.digestMultibase, digest);
    deepStrictEqual(media.algorithm, "sha2-256");
    deepStrictEqual(media.digest.length, 32);
    deepStrictEqual(media.multihash.length, 34);
    return expected;
  });
  strictEqual(
    await federation.fetch(request, { contextData: { id: 42 } }),
    expected,
  );
  deepStrictEqual(calls, 1);
  deepStrictEqual(
    (await federation.fetch(new Request(`${path}/extra`), {
      contextData: { id: 42 },
    })).status,
    400,
  );
  deepStrictEqual(calls, 1);
  const method = await federation.fetch(
    new Request(`${path}/extra`, { method: "POST" }),
    { contextData: { id: 42 } },
  );
  deepStrictEqual(method.status, 405);
  deepStrictEqual(method.headers.get("Allow"), "GET, HEAD");
});

test("MockFederation.fetch() handles hashlink variants and misses", async () => {
  const digest = await computeDigestMultibase(
    new TextEncoder().encode("media"),
  );
  const base = "https://example.com/.well-known/apgateway/";
  const federation = createFederation<void>();
  const missing = new Response("missing", { status: 404 });
  let calls = 0;
  federation.setHashlinkMediaDispatcher((_ctx, media) => {
    calls++;
    deepStrictEqual(media.hashlink, `hl:${digest}`);
    return null;
  });
  strictEqual(
    await federation.fetch(new Request(`${base}HL%3A${digest}?download=1`), {
      contextData: undefined,
      onNotFound: () => missing,
    }),
    missing,
  );
  deepStrictEqual(calls, 1);
  const malformed = await federation.fetch(new Request(`${base}hl:%ZZ`), {
    contextData: undefined,
  });
  deepStrictEqual(malformed.status, 400);
  deepStrictEqual(calls, 1);
  const malformedHead = await federation.fetch(
    new Request(`${base}hl:%ZZ`, { method: "HEAD" }),
    { contextData: undefined },
  );
  deepStrictEqual(malformedHead.status, 400);
  deepStrictEqual(malformedHead.body, null);
  deepStrictEqual(
    (await federation.fetch(new Request(`${base}did:key:zabc/notes/1`), {
      contextData: undefined,
    })).status,
    404,
  );
  deepStrictEqual(
    (await createFederation<void>().fetch(new Request(`${base}hl:${digest}`), {
      contextData: undefined,
    })).status,
    404,
  );
});

test("MockFederation.fetch() removes a HEAD response body", async () => {
  const digest = await computeDigestMultibase(
    new TextEncoder().encode("media"),
  );
  let cancelled = false;
  const federation = createFederation<void>();
  federation.setHashlinkMediaDispatcher(() =>
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      {
        status: 206,
        statusText: "Partial Content",
        headers: { "Content-Type": "text/plain" },
      },
    )
  );
  const response = await federation.fetch(
    new Request(`https://example.com/.well-known/apgateway/hl:${digest}`, {
      method: "HEAD",
    }),
    { contextData: undefined },
  );
  deepStrictEqual(response.status, 206);
  deepStrictEqual(response.statusText, "Partial Content");
  deepStrictEqual(response.headers.get("Content-Type"), "text/plain");
  deepStrictEqual(response.body, null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  deepStrictEqual(cancelled, true);
});

test("MockContext builds portable IDs", async (t) => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const mockFederation = createFederation<void>();
  mockFederation.setActorDispatcher("/users/{identifier}", () => null);
  mockFederation.setObjectDispatcher(Note, "/notes/{id}", () => null);
  mockFederation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
  mockFederation.setOutboxDispatcher("/users/{identifier}/outbox", () => null);
  mockFederation.setFollowingDispatcher(
    "/users/{identifier}/following",
    () => null,
  );
  mockFederation.setFollowersDispatcher(
    "/users/{identifier}/followers",
    () => null,
  );
  mockFederation.setLikedDispatcher("/users/{identifier}/liked", () => null);
  mockFederation.setFeaturedDispatcher(
    "/users/{identifier}/featured",
    () => null,
  );
  mockFederation.setFeaturedTagsDispatcher(
    "/users/{identifier}/tags",
    () => null,
  );
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  const helpers: Record<string, [(authority: string) => URL, string]> = {
    getPortableActorUri: [
      (authority) => context.getPortableActorUri("alice", authority),
      "/users/alice",
    ],
    getPortableObjectUri: [
      (authority) => context.getPortableObjectUri(Note, { id: "1" }, authority),
      "/notes/1",
    ],
    getPortableInboxUri: [
      (authority) => context.getPortableInboxUri("alice", authority),
      "/users/alice/inbox",
    ],
    getPortableOutboxUri: [
      (authority) => context.getPortableOutboxUri("alice", authority),
      "/users/alice/outbox",
    ],
    getPortableFollowingUri: [
      (authority) => context.getPortableFollowingUri("alice", authority),
      "/users/alice/following",
    ],
    getPortableFollowersUri: [
      (authority) => context.getPortableFollowersUri("alice", authority),
      "/users/alice/followers",
    ],
    getPortableLikedUri: [
      (authority) => context.getPortableLikedUri("alice", authority),
      "/users/alice/liked",
    ],
    getPortableFeaturedUri: [
      (authority) => context.getPortableFeaturedUri("alice", authority),
      "/users/alice/featured",
    ],
    getPortableFeaturedTagsUri: [
      (authority) => context.getPortableFeaturedTagsUri("alice", authority),
      "/users/alice/tags",
    ],
    getPortableCollectionUri: [
      (authority) =>
        context.getPortableCollectionUri("bookmarks", { id: "1" }, authority),
      "/collections/bookmarks/id/1",
    ],
  };
  for (const [name, [helper, path]] of Object.entries(helpers)) {
    await t.step(name, () => {
      deepStrictEqual(formatIri(helper(did)), `ap+ef61://${did}${path}`);
      deepStrictEqual(
        formatIri(helper(did.replace("did:key:", "DID:KEY:"))),
        `ap+ef61://${did}${path}`,
      );
      for (
        const authority of [
          `${did}/extra`,
          "https://example.com",
          `did:key:u${did.slice("did:key:z".length)}`,
          "did:key:z",
        ]
      ) {
        throws(() => helper(authority), TypeError, authority);
      }
    });
  }
});

test("MockContext.parseUri() recognizes portable IDs on request", async () => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const context = createFederation<void>().createContext(
    new URL("https://example.com/"),
    undefined,
  );
  const portableIds = [
    parseIri(`ap+ef61://${did}/users/alice`),
    parseIri(`ap://${did}/users/alice?@gateway=https%3A%2F%2Fgw.example`),
    new URL(
      `https://gateway.example/.well-known/apgateway/${did}/users/alice`,
    ),
  ];
  for (const uri of portableIds) {
    deepStrictEqual(context.parseUri(uri), null, uri.href);
    deepStrictEqual(
      context.parseUri(uri, { portable: true }),
      { type: "actor", identifier: "alice", authority: did },
      uri.href,
    );
  }
  const malformed = [
    new URL(
      `ap+ef61://${
        encodeURIComponent(`did:key:u${did.slice("did:key:z".length)}`)
      }/users/alice`,
    ),
    new URL(`ap+ef61://${encodeURIComponent(did)}/users/%ZZ`),
    new URL(`ap+ef61://user@${encodeURIComponent(did)}/users/alice`),
    new URL("https://gateway.example/.well-known/apgateway/did:/users/alice"),
  ];
  for (const uri of malformed) {
    deepStrictEqual(context.parseUri(uri, { portable: true }), null, uri.href);
  }
  deepStrictEqual(context.parseUri(null, { portable: true }), null);
  deepStrictEqual(
    context.parseUri(new URL("https://example.com/users/alice"), {
      portable: true,
    }),
    { type: "actor", identifier: "alice" },
  );
});

test("MockContext.getObject() suppresses tombstones unless passed through", async () => {
  const federation = createFederation<void>();
  federation.setObjectDispatcher(
    Note,
    "/notes/{id}",
    (_ctx: unknown, values: Record<string, string>) =>
      values.id === "deleted"
        ? new Tombstone({ id: new URL("https://example.com/notes/deleted") })
        : new Note({ id: new URL(`https://example.com/notes/${values.id}`) }),
  );
  federation.setObjectDispatcher(
    ASObject,
    "/objects/{id}",
    () => new Tombstone({ id: new URL("https://example.com/objects/1") }),
  );
  const ctx = federation.createContext(
    new URL("https://example.com/"),
    undefined,
  );

  const defaultPromise = ctx.getObject(Note, { id: "deleted" });
  const defaultResult: Note | null = await defaultPromise;
  deepStrictEqual(defaultResult, null);
  const suppressed: Note | null = await ctx.getObject(Note, {
    id: "deleted",
  }, { tombstone: "suppress" });
  deepStrictEqual(suppressed, null);
  ok(
    (await ctx.getObject(Note, { id: "deleted" }, {
      tombstone: "passthrough",
    })) instanceof Tombstone,
  );
  ok((await ctx.getObject(Note, { id: "1" })) instanceof Note);
  // A tombstone that is an instance of the requested class is returned:
  ok((await ctx.getObject(ASObject, { id: "1" })) instanceof Tombstone);
});

test("MockFederation custom collection setters chain mapPortableOwner()", () => {
  const federation = createFederation<void>();
  const setters = federation.setCollectionDispatcher(
    "bookmarks",
    Note,
    "/users/{identifier}/bookmarks",
    () => ({ items: [] }),
  );
  strictEqual(setters.mapPortableOwner(() => null), setters);
  const ordered = federation.setOrderedCollectionDispatcher(
    "pins",
    Note,
    "/users/{identifier}/pins",
    () => ({ items: [] }),
  );
  strictEqual(ordered.mapPortableOwner(() => null), ordered);
  // The other setters return the same setters, so that they chain in any
  // order:
  strictEqual(
    ordered
      .setFirstCursor(() => "0")
      .setLastCursor(() => "1")
      .setCounter(() => 0)
      .authorize(() => true)
      .mapPortableOwner(() => null),
    ordered,
  );
});

test("RequestContext.isSignedByAudience() in test contexts", async (t) => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);
  const portableId = parseIri(`ap+ef61://${did}/actor`);
  const signer = new Person({
    id: toCompatibleEf61Id(portableId, "https://other.example"),
  });
  const followers = new URL("https://example.com/followers");
  const federation = createFederation<void>();
  const url = new URL("https://example.com/");

  await t.step("createRequestContext()", async () => {
    const unsigned = createRequestContext<void>({
      url,
      data: undefined,
      federation,
    });
    deepStrictEqual(
      await unsigned.isSignedByAudience(new Note({ to: PUBLIC_COLLECTION })),
      true,
    );
    deepStrictEqual(
      await unsigned.isSignedByAudience(new Note({ to: portableId })),
      false,
    );
    const signed = createRequestContext<void>({
      url,
      data: undefined,
      federation,
      getSignedKeyOwner: () => Promise.resolve(signer),
    });
    deepStrictEqual(
      await signed.isSignedByAudience(new Note({ to: portableId })),
      true,
    );
    // Malformed portable IDs are skipped rather than thrown on:
    deepStrictEqual(
      await signed.isSignedByAudience(
        new Note({
          tos: [
            new URL(
              `https://example.com/.well-known/apgateway/${did}/actor` +
                "?@gateway=https%3A%2F%2Fexample.com",
            ),
            new URL("ap+ef61://bad/actor"),
            portableId,
          ],
        }),
      ),
      true,
    );
    deepStrictEqual(
      await signed.isSignedByAudience(new Note({ cc: followers })),
      false,
    );
    deepStrictEqual(
      await signed.isSignedByAudience(new Note({ cc: followers }), {
        isMember: (addressee) => addressee.href === followers.href,
      }),
      true,
    );
  });

  await t.step("MockContext", async () => {
    const context = federation.createContext(url, undefined);
    deepStrictEqual(
      await context.isSignedByAudience(new Note({ cc: PUBLIC_COLLECTION })),
      true,
    );
    deepStrictEqual(
      await context.isSignedByAudience(new Note({ to: portableId })),
      false,
    );
  });
});

const localActorUrl = "http://localhost:9999/users/alicia";

function createNetworkFederation() {
  const options = { contextData: {}, allowPrivateAddress: true };
  return createFederation(options);
}

function createLocalFollow(): Follow {
  return new Follow({
    id: new URL("http://localhost:9999/activities/follow"),
    actor: new URL(localActorUrl),
    object: new URL("https://example.com/users/alice"),
  });
}

async function withActorFetch(fn: () => Promise<void>): Promise<string[]> {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (input) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          "@context": "https://www.w3.org/ns/activitystreams",
          id: url,
          type: "Person",
          preferredUsername: "alicia",
        }),
        { headers: { "Content-Type": "application/activity+json" } },
      ),
    );
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return requests;
}

for (const passContext of [false, true]) {
  test(`receiveActivity allows private actor lookup (pass context: ${passContext})`, async () => {
    const federation = createNetworkFederation();
    const activity = createLocalFollow();
    const received: Follow[] = [];
    let actor: unknown;
    federation.setInboxListeners("/users/{identifier}/inbox").on(
      Follow,
      async (ctx: InboxContext<Record<string, never>>, follow: Follow) => {
        received.push(follow);
        actor = await follow.getActor(passContext ? ctx : {});
      },
    ).on(
      Follow,
      (_ctx: InboxContext<Record<string, never>>, follow: Follow) => {
        received.push(follow);
        return Promise.resolve();
      },
    );
    const requests = await withActorFetch(() =>
      federation.receiveActivity(activity)
    );
    deepStrictEqual(requests, [localActorUrl]);
    ok(actor instanceof Person);
    deepStrictEqual(actor.id?.href, localActorUrl);
    ok((received[0]) instanceof Follow);
    notStrictEqual(received[0], activity);
    strictEqual(received[0], received[1]);
    deepStrictEqual(activity.actorId?.href, localActorUrl);
    // The listener's lazy lookup must not populate the caller's actor cache.
    await rejects(
      () => activity.getActor(),
      (error) =>
        error instanceof UrlError && error.message.includes("Localhost"),
    );
  });
}

for (const allowPrivateAddress of [undefined, false]) {
  test(`receiveActivity retains offline defaults (allowPrivateAddress: ${allowPrivateAddress})`, async () => {
    const options = { contextData: {}, allowPrivateAddress };
    const federation = createFederation(options);
    const activity = createLocalFollow();
    let received: Follow | undefined;
    let document: unknown;
    let contextDocument: unknown;
    federation.setInboxListeners("/users/{identifier}/inbox").on(
      Follow,
      async (ctx: InboxContext<Record<string, never>>, follow: Follow) => {
        received = follow;
        document = (await ctx.documentLoader(localActorUrl)).document;
        contextDocument = (await ctx.contextLoader(localActorUrl)).document;
        await rejects(
          () => follow.getActor(),
          (error) =>
            error instanceof UrlError && error.message.includes("Localhost"),
        );
      },
    );
    const requests = await withActorFetch(async () => {
      await federation.receiveActivity(activity);
      const ctx = federation.createContext(new URL("https://example.com"), {});
      await ctx.documentLoader(localActorUrl);
      await ctx.contextLoader(localActorUrl);
    });
    deepStrictEqual(requests, []);
    strictEqual(received, activity);
    deepStrictEqual(document, {});
    deepStrictEqual(contextDocument, {});
  });
}

test("createContext allows private actor lookup", async () => {
  const federation = createNetworkFederation();
  const ctx = federation.createContext(new URL("https://example.com"), {});
  const activity = createLocalFollow();
  let actor: unknown;
  const requests = await withActorFetch(async () => {
    actor = await activity.getActor(ctx);
  });
  deepStrictEqual(requests, [localActorUrl]);
  ok(actor instanceof Person);
  deepStrictEqual(actor.id?.href, localActorUrl);
});

test("receiveActivity preserves embedded objects and supports lookup with context", async () => {
  const federation = createNetworkFederation();
  const follow = createLocalFollow();
  // A different origin must not cause a trusted embedded object to be fetched.
  const activity = new Undo({
    id: new URL("https://example.com/activities/undo"),
    object: follow,
  });
  let embedded: unknown;
  let actor: unknown;
  federation.setInboxListeners("/users/{identifier}/inbox").on(
    Undo,
    async (ctx: InboxContext<Record<string, never>>, undo: Undo) => {
      const object = await undo.getObject();
      embedded = object;
      if (object instanceof Follow) actor = await object.getActor(ctx);
    },
  );
  const requests = await withActorFetch(() =>
    federation.receiveActivity(activity)
  );
  deepStrictEqual(requests, [localActorUrl]);
  strictEqual(embedded, follow);
  ok(actor instanceof Person);
  deepStrictEqual(actor.id?.href, localActorUrl);
});

test("receiveActivity respects an explicit getter document loader", async () => {
  const federation = createNetworkFederation();
  let actor: unknown;
  const loaderRequests: string[] = [];
  federation.setInboxListeners("/users/{identifier}/inbox").on(
    Follow,
    async (_ctx: InboxContext<Record<string, never>>, follow: Follow) => {
      actor = await follow.getActor({
        documentLoader: (url) => {
          loaderRequests.push(url);
          return Promise.resolve({
            contextUrl: null,
            documentUrl: url,
            document: {
              "@context": "https://www.w3.org/ns/activitystreams",
              id: url,
              type: "Person",
            },
          });
        },
      });
    },
  );
  const requests = await withActorFetch(() =>
    federation.receiveActivity(createLocalFollow())
  );
  deepStrictEqual(requests, []);
  deepStrictEqual(loaderRequests, [localActorUrl]);
  ok(actor instanceof Person);
  deepStrictEqual(actor.id?.href, localActorUrl);
});

test("receiveActivity preserves an unconfigured activity's own loaders", async () => {
  const federation = createFederation({ contextData: {} });
  const loader = getDocumentLoader({ allowPrivateAddress: true });
  const activity = createLocalFollow().clone({}, {
    documentLoader: loader,
    contextLoader: loader,
  });
  let actor: unknown;
  federation.setInboxListeners("/users/{identifier}/inbox").on(
    Follow,
    async (_ctx: InboxContext<Record<string, never>>, follow: Follow) => {
      actor = await follow.getActor();
    },
  );
  const requests = await withActorFetch(() =>
    federation.receiveActivity(activity)
  );
  deepStrictEqual(requests, [localActorUrl]);
  ok(actor instanceof Person);
});

test("receiveActivity does not clone without listeners or context data", async () => {
  const options = { contextData: undefined, allowPrivateAddress: true };
  const federation = createFederation(options);
  const activity = createLocalFollow();
  let clones = 0;
  activity.clone = () => {
    clones++;
    return activity;
  };
  const requests = await withActorFetch(async () => {
    await federation.receiveActivity(activity);
    federation.setInboxListeners("/users/{identifier}/inbox").on(
      Follow,
      () => Promise.resolve(),
    );
    await rejects(
      () => federation.receiveActivity(activity),
      (error) =>
        error instanceof Error && error.message.includes("contextData"),
    );
  });
  deepStrictEqual(requests, []);
  deepStrictEqual(clones, 0);
});

test("receiveActivity preserves parsed JSON-LD extension properties", async () => {
  const federation = createNetworkFederation();
  const json = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "http://localhost:9999/activities/follow",
    type: "Follow",
    actor: localActorUrl,
    object: "https://example.com/users/alice",
    "https://example.com/ns#custom": "preserved",
  };
  const activity = await Follow.fromJsonLd(json);
  let receivedJson: unknown;
  federation.setInboxListeners("/users/{identifier}/inbox").on(
    Follow,
    async (_ctx: InboxContext<Record<string, never>>, follow: Follow) => {
      receivedJson = await follow.toJsonLd();
    },
  );
  const requests = await withActorFetch(() =>
    federation.receiveActivity(activity)
  );
  deepStrictEqual(requests, []);
  deepStrictEqual(receivedJson, json);
  deepStrictEqual(await activity.toJsonLd(), json);
});

test("MockFederation explicit loaders take precedence over private-address defaults", () => {
  const documentLoader = mockDocumentLoader;
  const contextLoader = (url: string) => mockDocumentLoader(url);
  for (const allowPrivateAddress of [false, true]) {
    const federation = createFederation({
      contextData: {},
      allowPrivateAddress,
      documentLoader,
      contextLoader,
    });
    const context = federation.createContext(
      new URL("https://example.com/"),
      {},
    );
    strictEqual(context.documentLoader, documentLoader);
    strictEqual(context.contextLoader, contextLoader);
  }
});
