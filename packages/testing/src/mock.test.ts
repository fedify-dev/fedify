import type { InboxContext, OutboxContext } from "@fedify/fedify/federation";
import { signJsonLd } from "@fedify/fedify/sig";
import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  Activity,
  Arrive,
  Create,
  IntransitiveActivity,
  Note,
  Person,
} from "@fedify/vocab";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  rsaPrivateKey3,
  rsaPublicKey3,
} from "../../fedify/src/testing/keys.ts";
import { createFederation, createOutboxContext } from "./mock.ts";

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
  assertEquals(mockFederation.sentActivities.length, 1);
  assertEquals(mockFederation.sentActivities[0].activity, activity);
  assertEquals(mockFederation.sentActivities[0].queued, false);
  assertEquals(mockFederation.sentActivities[0].sentOrder, 1);
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
  assertEquals(mockFederation.sentActivities.length, 1);
  assertEquals(mockFederation.sentActivities[0].activity, activity);

  // Clear sent activities
  mockFederation.reset();

  // Verify they were cleared
  assertEquals(mockFederation.sentActivities.length, 0);
});

test("receiveActivity triggers inbox listeners", async () => {
  // Provide contextData through constructor
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
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
  assertEquals(receivedActivity, activity);
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

  assertEquals(receivedIdentifier, "alice");
  assertEquals(mockFederation.sentActivities.length, 1);
  assertEquals(mockFederation.sentActivities[0].activity, activity);
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

  assertEquals(mockFederation.sentActivities.length, 1);
  assertEquals(mockFederation.sentActivities[0].activity, activity);
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

  assertEquals(mockFederation.sentActivities.length, 0);
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

    assertEquals(mockFederation.sentActivities.length, 1);
    assertEquals(mockFederation.sentActivities[0].activity, activity);
    assertEquals(mockFederation.sentActivities[0].rawActivity, signedJson);
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

    assertEquals(mockFederation.sentActivities.length, 1);
    assertEquals(mockFederation.sentActivities[0].activity, activity);
    assertEquals(mockFederation.sentActivities[0].rawActivity, signedJson);
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

    assertEquals(mockFederation.sentActivities.length, 1);
    assertEquals(mockFederation.sentActivities[0].activity, activity);
    assertEquals(mockFederation.sentActivities[0].rawActivity, proofJson);
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

    assertEquals(mockFederation.sentActivities.length, 0);
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

  assertEquals(calls, ["Create"]);
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

    assertEquals(calls, ["IntransitiveActivity"]);
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

  await assertRejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    Error,
    "The activity actor does not match the outbox owner.",
  );
  assertEquals(called, false);
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

  await assertRejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    Error,
    "The activity actor does not match the outbox owner.",
  );
  assertEquals(handled, "The activity actor does not match the outbox owner.");
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

  await assertRejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    Error,
    "The posted activity has no actor.",
  );
  assertEquals(handled, "The posted activity has no actor.");
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

  await assertRejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    Error,
    "The activity actor does not match the outbox owner.",
  );
  assertEquals(mockFederation.sentActivities.length, 1);
  assertEquals(mockFederation.sentActivities[0].activity, activity);
  assertEquals(mockFederation.sentActivities[0].rawActivity != null, true);
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

  await assertRejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    Error,
    'Actor "alice" not found.',
  );
  assertEquals(handled, false);
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

    assertEquals(called, true);
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

  await assertRejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    Error,
    'Actor "alice" not found.',
  );
  assertEquals(called, false);
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

  await assertRejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    Error,
    "Unauthorized.",
  );
  assertEquals(called, false);
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

  assertEquals(seenBody.length > 0, true);
  assertEquals(
    seenBody.includes('"https://www.w3.org/ns/activitystreams#actor"'),
    true,
  );
  assertEquals(seenBody.includes("alice"), true);
  assertEquals(called, true);
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

  await assertRejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    Error,
    "Unauthorized.",
  );
  assertEquals(called, false);
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

    await assertRejects(
      () => mockFederation.postOutboxActivity("alice", activity),
      Error,
      "MockFederation.postOutboxActivity(): contextData is not initialized. Please provide contextData through the constructor or call startQueue() before posting activities.",
    );
    assertEquals(authorizeCalled, false);
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

  await assertRejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    Error,
    "MockFederation.postOutboxActivity(): setOutboxListeners() is not initialized.",
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

  await assertRejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    Error,
    "MockFederation.postOutboxActivity(): setOutboxListeners() is not initialized.",
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

  assertEquals(mockFederation.sentActivities.length, 0);
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

    await assertRejects(
      () => mockFederation.postOutboxActivity("alice", activity),
      Error,
      "The activity actor does not match the outbox owner.",
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

  await assertRejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    Error,
    "Boom",
  );
  assertEquals(handled, "Boom");
});

test("setOutboxListeners rejects duplicate listeners for the same type", () => {
  const mockFederation = createFederation<void>();
  const listeners = mockFederation.setOutboxListeners(
    "/users/{identifier}/outbox",
  );

  listeners.on(Create, () => {});

  assertThrows(
    () => listeners.on(Create, () => {}),
    TypeError,
  );
});

test("setOutboxListeners rejects duplicate registration", () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  mockFederation.setOutboxListeners("/users/{identifier}/outbox");

  assertThrows(
    () => mockFederation.setOutboxListeners("/users/{identifier}/outbox"),
    TypeError,
    "Outbox listeners already set.",
  );
});

test("setOutboxListeners requires a leading slash", () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  assertThrows(
    () =>
      mockFederation.setOutboxListeners(
        "users/{identifier}/outbox" as `${string}{identifier}${string}`,
      ),
    TypeError,
    "Path must start with a slash.",
  );
});

test("setOutboxDispatcher requires a leading slash", () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  assertThrows(
    () =>
      mockFederation.setOutboxDispatcher(
        "users/{identifier}/outbox",
        () => ({ items: [] }),
      ),
    TypeError,
    "Path must start with a slash.",
  );
});

test("setOutboxListeners validates dispatcher path compatibility", () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  mockFederation.setOutboxDispatcher("/users/{identifier}/outbox", () => ({
    items: [],
  }));

  assertThrows(
    () => mockFederation.setOutboxListeners("/actors/{identifier}/outbox"),
    TypeError,
    "Outbox listener path and outbox dispatcher path must match.",
  );
});

test("setOutboxDispatcher validates listener path compatibility", () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  mockFederation.setOutboxListeners("/users/{identifier}/outbox");

  assertThrows(
    () =>
      mockFederation.setOutboxDispatcher("/actors/{identifier}/outbox", () => ({
        items: [],
      })),
    TypeError,
    "Outbox listener path and outbox dispatcher path must match.",
  );
});

test("setOutboxListeners validates path variables", () => {
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });

  assertThrows(
    () =>
      mockFederation.setOutboxListeners(
        "/users/outbox" as `${string}{identifier}${string}`,
      ),
    TypeError,
    "Path for outbox must have exactly one variable named identifier.",
  );

  assertThrows(
    () =>
      mockFederation.setOutboxListeners("/users/{identifier}/outbox/{extra}"),
    TypeError,
    "Path for outbox must have exactly one variable named identifier.",
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

  assertEquals(deliveryStates, [false, true]);
});

test("createOutboxContext exposes identifier", () => {
  const mockFederation = createFederation<void>();
  const ctx = createOutboxContext({
    federation: mockFederation,
    data: undefined,
    identifier: "alice",
  });

  assertEquals((ctx as OutboxContext<void>).identifier, "alice");
  assertEquals(ctx.clone(undefined).identifier, "alice");
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
  assertEquals(mockFederation.sentActivities.length, 1);
  assertEquals(mockFederation.sentActivities[0].activity, activity);
});

test("MockContext URI methods should work correctly", () => {
  const mockFederation = createFederation<void>();
  const mockContext = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  // Test URI generation methods
  assertEquals(
    mockContext.getActorUri("alice").href,
    "https://example.com/users/alice",
  );
  assertEquals(
    mockContext.getInboxUri("alice").href,
    "https://example.com/users/alice/inbox",
  );
  assertEquals(mockContext.getInboxUri().href, "https://example.com/inbox");
  assertEquals(
    mockContext.getOutboxUri("alice").href,
    "https://example.com/users/alice/outbox",
  );
  assertEquals(
    mockContext.getFollowingUri("alice").href,
    "https://example.com/users/alice/following",
  );
  assertEquals(
    mockContext.getFollowersUri("alice").href,
    "https://example.com/users/alice/followers",
  );

  const actorUri = new URL("https://example.com/users/alice");
  const parsed = mockContext.parseUri(actorUri);
  assertEquals(parsed?.type, "actor");
  if (parsed?.type === "actor") {
    assertEquals(parsed.identifier, "alice");
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
  assertEquals(
    context.getNodeInfoUri().href,
    "https://example.com/.well-known/nodeinfo",
  );
  assertEquals(
    context.getActorUri("alice").href,
    "https://example.com/actors/alice",
  );
  assertEquals(
    context.getObjectUri(Note, { id: "123" }).href,
    "https://example.com/notes/123",
  );
  assertEquals(
    context.getInboxUri("alice").href,
    "https://example.com/actors/alice/inbox",
  );
  assertEquals(
    context.getInboxUri().href,
    "https://example.com/shared-inbox",
  );
  assertEquals(
    context.getOutboxUri("alice").href,
    "https://example.com/actors/alice/outbox",
  );
  assertEquals(
    context.getFollowingUri("alice").href,
    "https://example.com/actors/alice/following",
  );
  assertEquals(
    context.getFollowersUri("alice").href,
    "https://example.com/actors/alice/followers",
  );
  assertEquals(
    context.getLikedUri("alice").href,
    "https://example.com/actors/alice/liked",
  );
  assertEquals(
    context.getFeaturedUri("alice").href,
    "https://example.com/actors/alice/featured",
  );
  assertEquals(
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

  assertEquals(
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

  assertEquals(
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

  assertEquals(
    context.getOutboxUri("alice/profile").href,
    "https://example.com/actors/alice%2Fprofile/outbox",
  );
});

test("MockContext rejects query expansion for outbox paths", () => {
  const mockFederation = createFederation<void>();
  assertThrows(
    () => mockFederation.setOutboxListeners("/actors/outbox{?identifier}"),
    TypeError,
    "Path for outbox cannot use query or fragment expansion for identifier.",
  );
});

test("MockContext reserved expansion encodes non-reserved characters", () => {
  const mockFederation = createFederation<void>();
  mockFederation.setOutboxListeners("/actors/{+identifier}/outbox");

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  assertEquals(
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
  await assertRejects(
    () => mockFederation.receiveActivity(activity),
    Error,
    "MockFederation.receiveActivity(): contextData is not initialized. Please provide contextData through the constructor or call startQueue() before receiving activities.",
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

  await assertRejects(
    () => mockFederation.postOutboxActivity("alice", activity),
    Error,
    "MockFederation.postOutboxActivity(): contextData is not initialized. Please provide contextData through the constructor or call startQueue() before posting activities.",
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
  assertEquals(mockFederation.sentActivities.length, 2);
  assertEquals(mockFederation.sentActivities[0].activity, activity1);
  assertEquals(mockFederation.sentActivities[1].activity, activity2);

  // Both should be marked as sent via queue
  assertEquals(mockFederation.sentActivities[0].queued, true);
  assertEquals(mockFederation.sentActivities[1].queued, true);
  assertEquals(mockFederation.sentActivities[0].queue, "outbox");
  assertEquals(mockFederation.sentActivities[1].queue, "outbox");
  assertEquals(mockFederation.sentActivities[0].sentOrder, 1);
  assertEquals(mockFederation.sentActivities[1].sentOrder, 2);
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
  assertEquals(mockFederation.sentActivities.length, 1);
  assertEquals(mockFederation.sentActivities[0].activity, activity);

  // Should be marked as sent immediately
  assertEquals(mockFederation.sentActivities[0].queued, false);
  assertEquals(mockFederation.sentActivities[0].queue, undefined);
  assertEquals(mockFederation.sentActivities[0].sentOrder, 1);
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
  );

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const actor = await context.getActor("alice");

  assertEquals(actor instanceof Person, true);
  assertEquals(actor?.preferredUsername, "alice");
  assertEquals(actor?.name, "Test User alice");
  assertEquals(actor?.id?.href, "https://example.com/users/alice");
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
  );

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const note = await context.getObject(Note, {
    identifier: "alice",
    postId: "123",
  });

  assertEquals(note instanceof Note, true);
  assertEquals(note?.content, "Post 123 by alice");
  assertEquals(note?.id?.href, "https://example.com/users/alice/posts/123");
});

test("MockContext.getActor() returns null when no dispatcher registered", async () => {
  const mockFederation = createFederation<void>();
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const actor = await context.getActor("alice");
  assertEquals(actor, null);
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
  assertEquals(note, null);
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
    });

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const keyPairs = await context.getActorKeyPairs("alice");

  assertEquals(keyPairs.length, 1);
  assertEquals(
    keyPairs[0].keyId.href,
    "https://example.com/users/alice#main-key",
  );
  assertEquals(keyPairs[0].privateKey, keyPair.privateKey);
  assertEquals(keyPairs[0].publicKey, keyPair.publicKey);
  assertEquals(keyPairs[0].cryptographicKey.id?.href, keyPairs[0].keyId.href);
  assertEquals(
    keyPairs[0].cryptographicKey.ownerId?.href,
    "https://example.com/users/alice",
  );
  assertEquals(keyPairs[0].multikey.id?.href, keyPairs[0].keyId.href);
  assertEquals(
    keyPairs[0].multikey.controllerId?.href,
    "https://example.com/users/alice",
  );
});

test("MockContext.getActorKeyPairs() returns empty array when no dispatcher registered", async () => {
  const mockFederation = createFederation<void>();
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const keyPairs = await context.getActorKeyPairs("alice");
  assertEquals(keyPairs, []);
});
