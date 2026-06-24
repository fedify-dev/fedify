import { test } from "@fedify/fixture";
import {
  DisallowedOperatorError,
  DisallowedVarSpecModifierError,
  DuplicateRouteVariableError,
  RouterError,
  RouteTemplateOptionsNotMatchedError,
} from "@fedify/uri-template";
import { Activity, Note, Person } from "@fedify/vocab";
import { assertEquals, assertExists, assertThrows } from "@std/assert";
import type { Protocol } from "../nodeinfo/types.ts";
import { createFederationBuilder } from "./builder.ts";
import type {
  ActorDispatcher,
  InboxListener,
  NodeInfoDispatcher,
  ObjectDispatcher,
  OutboxListener,
  UnverifiedActivityReason,
} from "./callback.ts";
import { MemoryKvStore } from "./kv.ts";
import type { FederationImpl } from "./middleware.ts";

test("FederationBuilder", async (t) => {
  await t.step(
    "should build a Federation object with registered components",
    async () => {
      const builder = createFederationBuilder<string>();
      const kv = new MemoryKvStore();

      const actorDispatcher: ActorDispatcher<string> = (_ctx, _identifier) => {
        return null;
      };
      assertThrows(
        () =>
          createFederationBuilder<string>().setActorDispatcher(
            "/users/{identifier}",
            actorDispatcher,
          )
            .mapActorAlias("/actor/{id}", "instance"),
        RouterError,
        "Path for actor alias must have no variables.",
      );
      assertThrows(
        () =>
          createFederationBuilder<string>()
            .setActorDispatcher("/users/{identifier}", actorDispatcher)
            .mapActorAlias("/actor", "instance")
            .mapActorAlias("/bot", "instance"),
        RouterError,
        'Actor alias for "instance" already set.',
      );
      assertThrows(
        () =>
          createFederationBuilder<string>()
            .setActorDispatcher("/users/{identifier}", actorDispatcher)
            .mapActorAlias("/actor", "instance")
            .mapActorAlias("/actor", "bot"),
        RouterError,
        'Actor alias path "/actor" conflicts with existing route "actorAlias:instance".',
      );
      assertThrows(
        () =>
          createFederationBuilder<string>()
            .setActorDispatcher("/users/{identifier}", actorDispatcher)
            .mapActorAlias("/actor", ""),
        RouterError,
        "Identifier cannot be empty.",
      );
      builder.setActorDispatcher("/users/{identifier}", actorDispatcher)
        .mapActorAlias("/actor", "instance");

      const inboxListener: InboxListener<string, Activity> = (
        _ctx,
        _activity,
      ) => {
        // Do nothing
      };
      const listeners = builder.setInboxListeners("/users/{identifier}/inbox");
      listeners.on(Activity, inboxListener);

      const outboxListener: OutboxListener<string, Activity> = (
        _ctx,
        _activity,
      ) => {
        // Do nothing
      };
      builder.setOutboxListeners("/users/{identifier}/outbox")
        .on(Activity, outboxListener);

      const objectDispatcher: ObjectDispatcher<string, Note, string> = (
        _ctx,
        _values,
      ) => {
        return null;
      };
      builder.setObjectDispatcher(Note, "/notes/{id}", objectDispatcher);

      const nodeInfo = {
        version: "2.1",
        software: {
          name: "test",
          version: "1.0.0",
        },
        protocols: ["activitypub"] as Protocol[],
        services: { inbound: [], outbound: [] },
        openRegistrations: false,
        usage: {
          users: {},
          localPosts: 0,
          localComments: 0,
        },
        metadata: {},
      };

      const nodeInfoDispatcher: NodeInfoDispatcher<string> = (_ctx) => nodeInfo;
      builder.setNodeInfoDispatcher("/nodeinfo", nodeInfoDispatcher);

      const federation = await builder.build({ kv });
      assertExists(federation);

      const impl = federation as FederationImpl<string>;

      assertEquals(
        impl.router.route("/.well-known/webfinger")?.name,
        "webfinger",
      );
      assertEquals(impl.router.route("/users/test123")?.name, "actor");
      assertEquals(impl.router.route("/actor")?.name, "actorAlias:instance");
      assertEquals(impl.router.route("/users/test123/inbox")?.name, "inbox");
      assertEquals(impl.router.route("/users/test123/outbox")?.name, "outbox");
      assertEquals(
        impl.router.route("/notes/456")?.name,
        `object:${Note.typeId.href}`,
      );
      assertEquals(impl.router.route("/nodeinfo")?.name, "nodeInfo");

      const actorCallbacksDispatcher = impl.actorCallbacks?.dispatcher;
      assertExists(actorCallbacksDispatcher);

      const inboxListeners = impl.inboxListeners;
      assertExists(inboxListeners);

      const outboxListeners = impl.outboxListeners;
      assertExists(outboxListeners);

      assertExists(impl.objectCallbacks[Note.typeId.href]);

      assertExists(impl.nodeInfoDispatcher);

      const notePaths = impl.router.build(`object:${Note.typeId.href}`, {
        id: "123",
      });
      assertEquals(notePaths, "/notes/123");

      assertEquals(
        impl.router.build("actor", { identifier: "user1" }),
        "/users/user1",
      );
      assertEquals(
        impl.router.build("inbox", { identifier: "user1" }),
        "/users/user1/inbox",
      );

      await builder.build({ kv }); // Ensure build can be called multiple times
    },
  );

  await t.step("passes benchmarkMode to the built federation", async () => {
    const builder = createFederationBuilder<void>();
    const federation = await builder.build({
      kv: new MemoryKvStore(),
      benchmarkMode: true,
    });
    const impl = federation as FederationImpl<void>;
    assertEquals(impl.benchmarkMode, true);
    assertEquals(impl.allowPrivateAddress, true);
    assertEquals(impl.signatureTimeWindow, false);

    const overridden = await builder.build({
      kv: new MemoryKvStore(),
      benchmarkMode: true,
      allowPrivateAddress: false,
      signatureTimeWindow: { minutes: 10 },
    });
    const overriddenImpl = overridden as FederationImpl<void>;
    assertEquals(overriddenImpl.benchmarkMode, true);
    assertEquals(overriddenImpl.allowPrivateAddress, false);
    assertEquals(overriddenImpl.signatureTimeWindow, { minutes: 10 });
  });

  await t.step("should snapshot router state on build", async () => {
    const builder = createFederationBuilder<void>();
    const kv = new MemoryKvStore();
    const noteRouteName = `object:${Note.typeId.href}`;

    builder.setActorDispatcher("/users/{identifier}", () => null);
    const federation1 = await builder.build({ kv });
    const impl1 = federation1 as FederationImpl<void>;

    builder.setObjectDispatcher(Note, "/notes/{id}", () => null);
    assertEquals(impl1.router.route("/notes/1"), null);

    const federation2 = await builder.build({ kv });
    const impl2 = federation2 as FederationImpl<void>;
    assertEquals(impl2.router.route("/notes/1")?.name, noteRouteName);

    impl1.router.add("/leaked/{id}", "leaked");
    assertEquals(impl1.router.route("/leaked/1")?.name, "leaked");
    assertEquals(impl2.router.route("/leaked/1"), null);

    const federation3 = await builder.build({ kv });
    const impl3 = federation3 as FederationImpl<void>;
    assertEquals(impl3.router.route("/leaked/1"), null);
  });

  await t.step("should build with default options", async () => {
    const builder = createFederationBuilder<void>();
    const kv = new MemoryKvStore();
    const federation = await builder.build({ kv });

    assertExists(federation);
    const impl = federation as FederationImpl<void>;
    assertEquals(impl.kv, kv);
  });

  await t.step("should validate outbox listener paths", () => {
    const builder = createFederationBuilder<void>();
    builder.setOutboxDispatcher(
      "/users/{identifier}/outbox",
      () => ({ items: [] }),
    );

    assertThrows(
      () => builder.setOutboxListeners("/actors/{identifier}/outbox"),
      RouterError,
    );

    assertThrows(
      () =>
        builder.setOutboxListeners(
          "/users/outbox" as `${string}{identifier}${string}`,
        ),
      RouterError,
    );

    assertThrows(
      () => builder.setOutboxListeners("/users/{identifier}/outbox/{extra}"),
      RouterError,
    );

    assertThrows(
      () =>
        builder.setOutboxListeners(
          "/users/{identifier}/outbox/{identifier}",
        ),
      RouterError,
    );

    const builderAfterInvalid = createFederationBuilder<void>();
    assertThrows(
      () =>
        builderAfterInvalid.setOutboxListeners(
          "/users/{identifier}/outbox/{extra}",
        ),
      RouteTemplateOptionsNotMatchedError,
    );
    assertThrows(
      () =>
        builderAfterInvalid.setOutboxListeners(
          "/users/{identifier:3}/outbox" as `${string}{identifier}${string}`,
        ),
      DisallowedVarSpecModifierError,
    );
    assertThrows(
      () =>
        builderAfterInvalid.setOutboxListeners(
          "/users/{identifier*}/outbox" as `${string}{identifier}${string}`,
        ),
      DisallowedVarSpecModifierError,
    );
    assertThrows(
      () =>
        builderAfterInvalid.setOutboxListeners(
          "/users/{identifier,identifier}/outbox" as `${string}{identifier}${string}`,
        ),
      DuplicateRouteVariableError,
    );
    builderAfterInvalid.setOutboxListeners("/users/{identifier}/outbox");

    const builder2 = createFederationBuilder<void>();
    builder2.setOutboxListeners("/users/{identifier}/outbox");

    assertThrows(
      () =>
        builder2.setOutboxDispatcher(
          "/actors/{identifier}/outbox",
          () => ({ items: [] }),
        ),
      RouterError,
    );

    const builder3 = createFederationBuilder<void>();
    assertThrows(
      () => builder3.setOutboxListeners("/users{?identifier}/outbox"),
      DisallowedOperatorError,
    );

    const builder3a = createFederationBuilder<void>();
    assertThrows(
      () => builder3a.setOutboxListeners("/users{;identifier}/outbox"),
      DisallowedOperatorError,
    );

    const builder3b = createFederationBuilder<void>();
    assertThrows(
      () => builder3b.setOutboxListeners("/users{.identifier}/outbox"),
      DisallowedOperatorError,
    );

    const builder4 = createFederationBuilder<void>();
    assertThrows(
      () =>
        builder4.setOutboxDispatcher(
          "/users{?identifier}/outbox",
          () => ({ items: [] }),
        ),
      DisallowedOperatorError,
    );

    const builder5 = createFederationBuilder<void>();
    assertThrows(
      () =>
        builder5.setOutboxDispatcher(
          "/users/{identifier:3}/outbox" as `${string}{identifier}${string}`,
          () => ({ items: [] }),
        ),
      DisallowedVarSpecModifierError,
    );
  });

  await t.step(
    "rejects non-segment-boundary identifier operators at registration " +
      "for required-identifier routes",
    () => {
      // Fedify's actor/inbox/outbox/collection dispatchers expose a single
      // required `identifier: string`.  Path-style expansion
      // (`{/identifier}`), reserved expansion (`{+identifier}`), and the
      // optional operators (`{?identifier}`, `{;identifier}`,
      // `{.identifier}`) can all match without binding a concrete
      // segment-bounded identifier, so they are rejected at registration
      // time rather than relying on a runtime no-match.  See
      // https://github.com/fedify-dev/fedify/pull/758#discussion_r3252548632
      type IdPath = `${string}{identifier}${string}`;

      // Actor dispatcher.
      assertThrows(
        () =>
          createFederationBuilder<void>().setActorDispatcher(
            "/users{/identifier}" as IdPath,
            () => null,
          ),
        DisallowedOperatorError,
      );
      assertThrows(
        () =>
          createFederationBuilder<void>().setActorDispatcher(
            "{/identifier}" as IdPath,
            () => null,
          ),
        DisallowedOperatorError,
      );
      assertThrows(
        () =>
          createFederationBuilder<void>().setActorDispatcher(
            "/users/{/identifier}" as IdPath,
            () => null,
          ),
        DisallowedOperatorError,
      );
      assertThrows(
        () =>
          createFederationBuilder<void>().setActorDispatcher(
            "/users{?identifier}" as IdPath,
            () => null,
          ),
        DisallowedOperatorError,
      );

      // Inbox listeners.
      assertThrows(
        () =>
          createFederationBuilder<void>().setInboxListeners(
            "/users{/identifier}/inbox" as IdPath,
          ),
        DisallowedOperatorError,
      );

      // Outbox listeners and dispatcher keep the same strict shape.
      assertThrows(
        () =>
          createFederationBuilder<void>().setOutboxListeners(
            "/users{/identifier}/outbox" as IdPath,
          ),
        DisallowedOperatorError,
      );

      // Prefix and explode modifiers remain registration errors too.
      assertThrows(
        () =>
          createFederationBuilder<void>().setActorDispatcher(
            "/users/{identifier:3}" as IdPath,
            () => null,
          ),
        DisallowedVarSpecModifierError,
      );
      assertThrows(
        () =>
          createFederationBuilder<void>().setActorDispatcher(
            "/users/{identifier*}" as IdPath,
            () => null,
          ),
        DisallowedVarSpecModifierError,
      );

      // Simple expansion `{identifier}` must keep working.
      createFederationBuilder<void>().setActorDispatcher(
        "/users/{identifier}",
        () => null,
      );
      createFederationBuilder<void>().setInboxListeners(
        "/users/{identifier}/inbox",
      );
    },
  );

  await t.step(
    "every required-identifier setter rejects every omissible operator",
    () => {
      // The broader invariant from the review: a Fedify route whose callback
      // contract exposes `identifier: string` must never match without a
      // concrete identifier.  Path-style (`{/identifier}`) and the optional
      // forms (`{?identifier}`, `{;identifier}`, `{.identifier}`) can all
      // match without binding a segment-bounded value, so every setter that
      // registers such a route must reject them at registration time, not
      // just the `actor`/`outbox` ones spot-checked above.  See
      // https://github.com/fedify-dev/fedify/pull/758#discussion_r3252548632
      type IdPath = `${string}{identifier}${string}`;

      // `op` is spliced where a plain `{identifier}` expression would go.
      const omissibleExprs = [
        "{/identifier}",
        "{?identifier}",
        "{;identifier}",
        "{.identifier}",
      ] as const;

      // Each entry registers exactly one required-identifier route on a
      // fresh builder so per-route "already set" guards never fire first.
      const registrars: ReadonlyArray<
        readonly [name: string, register: (expr: string) => void]
      > = [
        [
          "setActorDispatcher",
          (expr) =>
            createFederationBuilder<void>().setActorDispatcher(
              `/users${expr}` as IdPath,
              () => null,
            ),
        ],
        [
          "setInboxListeners",
          (expr) =>
            createFederationBuilder<void>().setInboxListeners(
              `/users${expr}/inbox` as IdPath,
            ),
        ],
        [
          "setOutboxListeners",
          (expr) =>
            createFederationBuilder<void>().setOutboxListeners(
              `/users${expr}/outbox` as IdPath,
            ),
        ],
        [
          "setOutboxDispatcher",
          (expr) =>
            createFederationBuilder<void>().setOutboxDispatcher(
              `/users${expr}/outbox` as IdPath,
              () => ({ items: [] }),
            ),
        ],
        [
          "setFollowingDispatcher",
          (expr) =>
            createFederationBuilder<void>().setFollowingDispatcher(
              `/users${expr}/following` as IdPath,
              () => ({ items: [] }),
            ),
        ],
        [
          "setFollowersDispatcher",
          (expr) =>
            createFederationBuilder<void>().setFollowersDispatcher(
              `/users${expr}/followers` as IdPath,
              () => ({ items: [] }),
            ),
        ],
        [
          "setLikedDispatcher",
          (expr) =>
            createFederationBuilder<void>().setLikedDispatcher(
              `/users${expr}/liked` as IdPath,
              () => ({ items: [] }),
            ),
        ],
        [
          "setFeaturedDispatcher",
          (expr) =>
            createFederationBuilder<void>().setFeaturedDispatcher(
              `/users${expr}/featured` as IdPath,
              () => ({ items: [] }),
            ),
        ],
        [
          "setFeaturedTagsDispatcher",
          (expr) =>
            createFederationBuilder<void>().setFeaturedTagsDispatcher(
              `/users${expr}/tags` as IdPath,
              () => ({ items: [] }),
            ),
        ],
      ];

      for (const [name, register] of registrars) {
        for (const expr of omissibleExprs) {
          assertThrows(
            () => register(expr),
            DisallowedOperatorError,
            undefined,
            `${name} must reject ${expr} at registration`,
          );
        }
        // Positive control: the plain expansion still registers.
        register("{identifier}");
      }
    },
  );

  await t.step(
    "empty or missing identifier segments produce a runtime no-match",
    async () => {
      // The default `nullable: false` constraint makes every dispatcher
      // route reject empty/unbound bindings at match time, so the former
      // `assertIdentifierPath` / `variables.size < 1` registration guards
      // are no longer needed.
      const kv = new MemoryKvStore();
      const builder = createFederationBuilder<void>();
      builder.setActorDispatcher("/users/{identifier}", () => null);
      builder.setInboxListeners("/users/{identifier}/inbox");
      builder.setOutboxDispatcher(
        "/users/{identifier}/outbox",
        () => ({ items: [] }),
      );
      builder.setObjectDispatcher(Note, "/notes/{id}", () => null);
      const impl = (await builder.build({ kv })) as FederationImpl<void>;

      // Sanity: non-empty bindings still match.
      assertEquals(impl.router.route("/users/alice")?.name, "actor");
      assertEquals(
        impl.router.route("/users/alice/inbox")?.name,
        "inbox",
      );
      assertEquals(
        impl.router.route("/users/alice/outbox")?.name,
        "outbox",
      );
      assertEquals(
        impl.router.route("/notes/1")?.name,
        `object:${Note.typeId.href}`,
      );

      // Empty/blank identifier segments no longer match.  The review
      // explicitly calls out the actor/inbox/outbox callback contract
      // (`identifier: string`), so all three are exercised here.
      assertEquals(impl.router.route("/users/"), null);
      assertEquals(impl.router.route("/users//inbox"), null);
      assertEquals(impl.router.route("/users//outbox"), null);
      // Object dispatcher with an empty variable.
      assertEquals(impl.router.route("/notes/"), null);
    },
  );

  await t.step(
    "object dispatcher optional-operator routes no-match when unbound",
    async () => {
      // CuPEr: the review's own scenarios — `/notes{?id}`, `/notes{;id}`,
      // `/notes{.id}` — must register but no-match the variable-less form
      // instead of matching with an empty `values`.
      const kv = new MemoryKvStore();
      const objectName = `object:${Note.typeId.href}`;

      const query = createFederationBuilder<void>();
      query.setObjectDispatcher(Note, "/notes{?id}", () => null);
      const queryImpl = (await query.build({ kv })) as FederationImpl<void>;
      assertEquals(queryImpl.router.route("/notes"), null);
      assertEquals(queryImpl.router.route("/notes?id=1")?.name, objectName);

      const matrix = createFederationBuilder<void>();
      matrix.setObjectDispatcher(Note, "/notes{;id}", () => null);
      const matrixImpl = (await matrix.build({ kv })) as FederationImpl<void>;
      assertEquals(matrixImpl.router.route("/notes"), null);
      assertEquals(matrixImpl.router.route("/notes;id=1")?.name, objectName);

      const label = createFederationBuilder<void>();
      label.setObjectDispatcher(Note, "/notes{.id}", () => null);
      const labelImpl = (await label.build({ kv })) as FederationImpl<void>;
      assertEquals(labelImpl.router.route("/notes"), null);
      assertEquals(labelImpl.router.route("/notes.1")?.name, objectName);
    },
  );

  await t.step(
    "custom collection routes no-match empty or unbound variables",
    async () => {
      // CuPEr plan item 3: the custom collection dispatcher must also
      // reject empty-segment and unbound optional-operator bindings via
      // the router's default nullable:false constraint.
      const kv = new MemoryKvStore();
      const builder = createFederationBuilder<void>();
      builder.setCollectionDispatcher(
        "samples",
        Note,
        "/groups/{id}",
        () => ({ items: [] }),
      );
      builder.setCollectionDispatcher(
        "optionals",
        Note,
        "/optional-groups{?id}",
        () => ({ items: [] }),
      );
      // The review also names matrix and label operators, which share the
      // same optional shape: `/matrix-groups{;id}` and `/label-groups{.id}`
      // both reduce to their literal prefix when `id` is unbound.
      builder.setCollectionDispatcher(
        "matrixOptionals",
        Note,
        "/matrix-groups{;id}",
        () => ({ items: [] }),
      );
      builder.setCollectionDispatcher(
        "labelOptionals",
        Note,
        "/label-groups{.id}",
        () => ({ items: [] }),
      );
      const impl = (await builder.build({ kv })) as FederationImpl<void>;

      // Sanity: a bound segment still matches.
      assertEquals(impl.router.route("/groups/1"), {
        name: "collection:samples",
        values: { id: "1" },
        template: "/groups/{id}",
      });
      assertEquals(impl.router.route("/optional-groups?id=1"), {
        name: "collection:optionals",
        values: { id: "1" },
        template: "/optional-groups{?id}",
      });
      assertEquals(impl.router.route("/matrix-groups;id=1"), {
        name: "collection:matrixOptionals",
        values: { id: "1" },
        template: "/matrix-groups{;id}",
      });
      assertEquals(impl.router.route("/label-groups.1"), {
        name: "collection:labelOptionals",
        values: { id: "1" },
        template: "/label-groups{.id}",
      });

      // Empty segment and unbound optional operators no-match.
      assertEquals(impl.router.route("/groups/"), null);
      assertEquals(impl.router.route("/optional-groups"), null);
      assertEquals(impl.router.route("/matrix-groups"), null);
      assertEquals(impl.router.route("/label-groups"), null);
    },
  );

  await t.step("should pass build options correctly", async () => {
    const builder = createFederationBuilder<number>();
    const kv = new MemoryKvStore();
    const federation = await builder.build({
      kv,
      kvPrefixes: { activityIdempotence: ["custom", "idem"] },
      allowPrivateAddress: true,
      trailingSlashInsensitive: true,
      origin: "https://example.com",
    });

    assertExists(federation);
    const impl = federation as FederationImpl<number>;

    assertEquals(impl.kv, kv);
    assertEquals(impl.kvPrefixes.activityIdempotence, ["custom", "idem"]);
    assertEquals(impl.allowPrivateAddress, true);
    assertEquals(impl.router.trailingSlashInsensitive, true);
    assertEquals(impl.origin?.webOrigin, "https://example.com");
  });

  await t.step("should handle firstKnock option", async () => {
    const builder = createFederationBuilder<void>();
    const kv = new MemoryKvStore();

    // Test with default firstKnock (should be "rfc9421")
    const federationDefault = await builder.build({ kv });
    assertExists(federationDefault);
    const implDefault = federationDefault as FederationImpl<void>;
    assertEquals(implDefault.firstKnock, undefined); // Uses default when not specified

    // Test with custom firstKnock value
    const federationCustom = await builder.build({
      kv,
      firstKnock: "draft-cavage-http-signatures-12",
    });
    assertExists(federationCustom);
    const implCustom = federationCustom as FederationImpl<void>;
    assertEquals(implCustom.firstKnock, "draft-cavage-http-signatures-12");

    // Test with rfc9421 explicitly set
    const federationRfc = await builder.build({
      kv,
      firstKnock: "rfc9421",
    });
    assertExists(federationRfc);
    const implRfc = federationRfc as FederationImpl<void>;
    assertEquals(implRfc.firstKnock, "rfc9421");
  });

  await t.step(
    "should copy unverified activity handler into built federation",
    async () => {
      const builder = createFederationBuilder<void>();
      const kv = new MemoryKvStore();
      const handler = (
        _ctx: unknown,
        _activity: Activity,
        _reason: UnverifiedActivityReason,
      ) => {
        return;
      };

      builder
        .setInboxListeners("/users/{identifier}/inbox")
        .onUnverifiedActivity(handler);

      const federation = await builder.build({ kv });
      const impl = federation as FederationImpl<void>;
      assertEquals(impl.unverifiedActivityHandler, handler);
    },
  );

  await t.step(
    "should register multiple object dispatchers and verify them",
    async () => {
      const builder = createFederationBuilder<void>();
      const kv = new MemoryKvStore();

      const noteDispatcher: ObjectDispatcher<void, Note, string> = (
        _ctx,
        _values,
      ) => {
        return null;
      };

      const personDispatcher: ObjectDispatcher<void, Person, string> = (
        _ctx,
        _values,
      ) => {
        return null;
      };

      builder.setObjectDispatcher(Note, "/notes/{id}", noteDispatcher);
      builder.setObjectDispatcher(Person, "/people/{id}", personDispatcher);

      const federation = await builder.build({ kv });
      const impl = federation as FederationImpl<void>;

      assertExists(impl.objectCallbacks[Note.typeId.href]);
      assertExists(impl.objectCallbacks[Person.typeId.href]);

      const notePath = impl.router.build(`object:${Note.typeId.href}`, {
        id: "123",
      });
      assertEquals(notePath, "/notes/123");

      const personPath = impl.router.build(`object:${Person.typeId.href}`, {
        id: "456",
      });
      assertEquals(personPath, "/people/456");

      const noteRoute = impl.router.route("/notes/789");
      assertEquals(noteRoute?.name, `object:${Note.typeId.href}`);
      assertEquals(noteRoute?.values.id, "789");

      const personRoute = impl.router.route("/people/abc");
      assertEquals(personRoute?.name, `object:${Person.typeId.href}`);
      assertEquals(personRoute?.values.id, "abc");
    },
  );

  await t.step(
    "should handle symbol names uniquely in custom collection dispatchers",
    () => {
      const builder = createFederationBuilder<string>();

      // Create two unnamed symbols
      const unnamedSymbol1 = Symbol();
      const unnamedSymbol2 = Symbol();
      const namedSymbol1 = Symbol.for("");
      const namedSymbol2 = Symbol.for("");
      const strId = String(unnamedSymbol1);

      const dispatcher = (_ctx: unknown, _params: unknown) => ({
        items: [],
      });

      // Test that different unnamed symbols are treated as different
      builder.setCollectionDispatcher(
        unnamedSymbol1,
        Note,
        "/unnamed-symbol1/{id}",
        dispatcher,
      );

      // Test that using the same symbol twice throws an error
      assertThrows(
        () => {
          builder.setCollectionDispatcher(
            unnamedSymbol1,
            Note,
            "/unnamed-symbol1-duplicate/{id}",
            dispatcher,
          );
        },
        Error,
        "Collection dispatcher for Symbol() already set.",
      );

      // Test that using a different symbol works
      builder.setCollectionDispatcher(
        unnamedSymbol2,
        Note,
        "/unnamed-symbol2/{id}",
        dispatcher,
      );
      // Test that using same named symbol twice with a different name throws an error
      builder.setCollectionDispatcher(
        namedSymbol1,
        Note,
        "/named-symbol/{id}",
        dispatcher,
      );
      assertThrows(
        () => {
          builder.setCollectionDispatcher(
            namedSymbol2,
            Note,
            "/named-symbol/{id}",
            dispatcher,
          );
        },
      );
      // Test that using string ID stringified from an unnamed symbol works
      builder.setCollectionDispatcher(
        strId,
        Note,
        "/string-id/{id}",
        dispatcher,
      );
    },
  );
});
