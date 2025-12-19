import { test } from "@fedify/fixture";
import { Activity, Note, Person } from "@fedify/vocab";
import { assertEquals, assertExists, assertThrows } from "@std/assert";
import type { Protocol } from "../nodeinfo/types.ts";
import { createFederationBuilder } from "./builder.ts";
import type {
  ActorDispatcher,
  InboxListener,
  NodeInfoDispatcher,
  ObjectDispatcher,
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
      builder.setActorDispatcher("/users/{identifier}", actorDispatcher);

      const inboxListener: InboxListener<string, Activity> = (
        _ctx,
        _activity,
      ) => {
        // Do nothing
      };
      const listeners = builder.setInboxListeners("/users/{identifier}/inbox");
      listeners.on(Activity, inboxListener);

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
      assertEquals(impl.router.route("/users/test123/inbox")?.name, "inbox");
      assertEquals(
        impl.router.route("/notes/456")?.name,
        `object:${Note.typeId.href}`,
      );
      assertEquals(impl.router.route("/nodeinfo")?.name, "nodeInfo");

      const actorCallbacksDispatcher = impl.actorCallbacks?.dispatcher;
      assertExists(actorCallbacksDispatcher);

      const inboxListeners = impl.inboxListeners;
      assertExists(inboxListeners);

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

  await t.step("should build with default options", async () => {
    const builder = createFederationBuilder<void>();
    const kv = new MemoryKvStore();
    const federation = await builder.build({ kv });

    assertExists(federation);
    const impl = federation as FederationImpl<void>;
    assertEquals(impl.kv, kv);
  });

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
