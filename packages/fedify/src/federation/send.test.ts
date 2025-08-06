import {
  assert,
  assertEquals,
  assertFalse,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import fetchMock from "fetch-mock";
import { verifyRequest } from "../sig/http.ts";
import { doesActorOwnKey } from "../sig/owner.ts";
import { mockDocumentLoader } from "../testing/docloader.ts";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  rsaPrivateKey2,
  rsaPublicKey2,
} from "../testing/keys.ts";
import { test } from "../testing/mod.ts";
import type { Actor } from "../vocab/actor.ts";
import {
  Activity,
  Application,
  Endpoints,
  Group,
  Person,
  Service,
} from "../vocab/vocab.ts";
import { extractInboxes, sendActivity } from "./send.ts";

test("extractInboxes()", () => {
  const recipients: Actor[] = [
    new Person({
      id: new URL("https://example.com/alice"),
      inbox: new URL("https://example.com/alice/inbox"),
      endpoints: new Endpoints({
        sharedInbox: new URL("https://example.com/inbox"),
      }),
    }),
    new Application({
      id: new URL("https://example.com/app"),
      inbox: new URL("https://example.com/app/inbox"),
      endpoints: new Endpoints({
        sharedInbox: new URL("https://example.com/inbox"),
      }),
    }),
    new Group({
      id: new URL("https://example.org/group"),
      inbox: new URL("https://example.org/group/inbox"),
    }),
    new Service({
      id: new URL("https://example.net/service"),
      inbox: new URL("https://example.net/service/inbox"),
      endpoints: new Endpoints({
        sharedInbox: new URL("https://example.net/inbox"),
      }),
    }),
  ];
  let inboxes = extractInboxes({ recipients });
  assertEquals(
    inboxes,
    {
      "https://example.com/alice/inbox": {
        actorIds: new Set(["https://example.com/alice"]),
        sharedInbox: false,
      },
      "https://example.com/app/inbox": {
        actorIds: new Set(["https://example.com/app"]),
        sharedInbox: false,
      },
      "https://example.org/group/inbox": {
        actorIds: new Set(["https://example.org/group"]),
        sharedInbox: false,
      },
      "https://example.net/service/inbox": {
        actorIds: new Set(["https://example.net/service"]),
        sharedInbox: false,
      },
    },
  );
  inboxes = extractInboxes({ recipients, preferSharedInbox: true });
  assertEquals(
    inboxes,
    {
      "https://example.com/inbox": {
        actorIds: new Set([
          "https://example.com/alice",
          "https://example.com/app",
        ]),
        sharedInbox: true,
      },
      "https://example.org/group/inbox": {
        actorIds: new Set(["https://example.org/group"]),
        sharedInbox: false,
      },
      "https://example.net/inbox": {
        actorIds: new Set(["https://example.net/service"]),
        sharedInbox: true,
      },
    },
  );
  inboxes = extractInboxes({
    recipients,
    excludeBaseUris: [new URL("https://foo.bar/")],
  });
  assertEquals(
    inboxes,
    {
      "https://example.com/alice/inbox": {
        actorIds: new Set(["https://example.com/alice"]),
        sharedInbox: false,
      },
      "https://example.com/app/inbox": {
        actorIds: new Set(["https://example.com/app"]),
        sharedInbox: false,
      },
      "https://example.org/group/inbox": {
        actorIds: new Set(["https://example.org/group"]),
        sharedInbox: false,
      },
      "https://example.net/service/inbox": {
        actorIds: new Set(["https://example.net/service"]),
        sharedInbox: false,
      },
    },
  );
  inboxes = extractInboxes({
    recipients,
    excludeBaseUris: [new URL("https://example.com/")],
  });
  assertEquals(
    inboxes,
    {
      "https://example.org/group/inbox": {
        actorIds: new Set(["https://example.org/group"]),
        sharedInbox: false,
      },
      "https://example.net/service/inbox": {
        actorIds: new Set(["https://example.net/service"]),
        sharedInbox: false,
      },
    },
  );
  inboxes = extractInboxes({
    recipients,
    preferSharedInbox: true,
    excludeBaseUris: [new URL("https://example.com/")],
  });
  assertEquals(
    inboxes,
    {
      "https://example.org/group/inbox": {
        actorIds: new Set(["https://example.org/group"]),
        sharedInbox: false,
      },
      "https://example.net/inbox": {
        actorIds: new Set(["https://example.net/service"]),
        sharedInbox: true,
      },
    },
  );
});

test("sendActivity()", async (t) => {
  fetchMock.spyGlobal();

  let httpSigVerified: boolean | null = null;
  let request: Request | null = null;
  fetchMock.post(
    "https://example.com/inbox",
    async (cl) => {
      httpSigVerified = false;
      request = cl.request!.clone() as Request;
      const options = {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      };
      const key = await verifyRequest(request, options);
      const activity = await Activity.fromJsonLd(await request.json(), options);
      if (key != null && await doesActorOwnKey(activity, key, options)) {
        httpSigVerified = true;
      }
      if (httpSigVerified) return new Response("", { status: 202 });
      return new Response("", { status: 401 });
    },
  );

  await t.step("success", async () => {
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person",
    };

    await sendActivity({
      activity,
      keys: [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      inbox: new URL("https://example.com/inbox"),
      headers: new Headers({
        "X-Test": "test",
      }),
    });
    assert(httpSigVerified);
    assertNotEquals(request, null);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );
    assertEquals(request?.headers.get("X-Test"), "test");

    httpSigVerified = null;
    await assertRejects(() =>
      sendActivity({
        activity: { ...activity, actor: "https://example.com/person2" },
        keys: [{ privateKey: ed25519PrivateKey, keyId: ed25519Multikey.id! }],
        inbox: new URL("https://example.com/inbox"),
      })
    );
    assertFalse(httpSigVerified);
    assertNotEquals(request, null);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );
  });

  fetchMock.post("https://example.com/inbox2", {
    status: 500,
    body: "something went wrong",
  });

  await t.step("failure", async () => {
    const activity: unknown = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person",
    };
    await assertRejects(
      () =>
        sendActivity({
          activity,
          activityId: "https://example.com/activity",
          keys: [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
          inbox: new URL("https://example.com/inbox2"),
        }),
      Error,
      "Failed to send activity https://example.com/activity to " +
        "https://example.com/inbox2 (500 Internal Server Error):\n" +
        "something went wrong",
    );
  });

  fetchMock.hardReset();
});
