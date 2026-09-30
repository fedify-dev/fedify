import { mockDocumentLoader, test } from "@fedify/fixture";
import { type Activity, Create, Note } from "@fedify/vocab";
import {
  type DocumentLoader,
  exportDidKey,
  formatIri,
  parseIri,
  toCompatibleEf61Id,
} from "@fedify/vocab-runtime";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { signObject } from "../sig/proof.ts";
import { ed25519PrivateKey, ed25519PublicKey } from "../testing/keys.ts";
import { MemoryKvStore } from "./kv.ts";
import { createFederation } from "./middleware.ts";

const did = await exportDidKey(ed25519PublicKey.publicKey);
const keyId = new URL(`${did}#${did.slice("did:key:".length)}`);
const otherKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]) as CryptoKeyPair;
const otherDid = await exportDidKey(otherKeyPair.publicKey);
const otherKeyId = new URL(`${otherDid}#${otherDid.slice("did:key:".length)}`);

const GATEWAY = "https://gw.example";

function portableId(authority: string, path: string): URL {
  return parseIri(`ap+ef61://${authority}${path}`);
}

function compatibleId(
  authority: string,
  path: string,
  gateway: string = GATEWAY,
): URL {
  return new URL(`${gateway}/.well-known/apgateway/${authority}${path}`);
}

async function sign(
  activity: Activity,
  signer: "did" | "otherDid",
): Promise<Activity> {
  return await signObject(
    activity,
    signer === "did" ? ed25519PrivateKey : otherKeyPair.privateKey,
    signer === "did" ? keyId : otherKeyId,
    { contextLoader: mockDocumentLoader },
  );
}

interface RouteOptions {
  /**
   * The activity served at the ID of the routed activity, if any.
   */
  readonly served?: Activity;
  /**
   * The actors of the routed activity.  Defaults to the actors of the served
   * activity.
   */
  readonly actors?: readonly URL[];
}

/**
 * Routes a `Create` activity with the given ID through
 * `Context.routeActivity()`.  Unless `activity` is an `Activity`, the routed
 * activity has no proof, so that it is trusted only if it can be dereferenced
 * by its ID, which serves `served`.
 * @returns Whether the activity was routed, and the IDs of the actors of
 *          the activities that reached the inbox listener.
 */
async function route(
  activity: URL | Activity,
  { served, actors }: RouteOptions = {},
): Promise<{ routed: boolean; received: string[] }> {
  const documents = new Map<string, unknown>();
  if (served != null && activity instanceof URL) {
    const document = await served.toJsonLd({
      contextLoader: mockDocumentLoader,
    });
    // The URLs through which lookupObject() may ask for the activity:
    documents.set(activity.href, document);
    if (activity.protocol === "ap+ef61:") {
      documents.set(formatIri(activity), document);
      documents.set(toCompatibleEf61Id(activity, GATEWAY).href, document);
    }
  }
  const documentLoader: DocumentLoader = (url, options) => {
    if (documents.has(url)) {
      return Promise.resolve({
        contextUrl: null,
        documentUrl: url,
        document: documents.get(url),
      });
    }
    return mockDocumentLoader(url, options);
  };
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => documentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  const received: string[] = [];
  federation
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Create, (_ctx, create) => {
      received.push(...create.actorIds.map((id) => id.href));
    });
  const ctx = federation.createContext(new URL("https://example.com/"));
  const routed = await ctx.routeActivity(
    null,
    activity instanceof URL
      ? new Create({
        id: activity,
        actors: [...(actors ?? served?.actorIds ?? [])],
      })
      : activity,
  );
  return { routed, received };
}

async function portableCreate(
  id: URL,
  actors: readonly URL[],
  signer: "did" | "otherDid" = "did",
): Promise<Activity> {
  return await sign(
    new Create({
      id,
      actors: [...actors],
      object: new Note({ content: "Hello" }),
    }),
    signer,
  );
}

test("Context.routeActivity() rejects portable activities attributed to other DIDs", async (t) => {
  const cases: [string, URL, URL[]][] = [
    [
      "ap+ef61: IDs",
      portableId(did, "/activities/1"),
      [portableId(otherDid, "/actor")],
    ],
    [
      "compatible identifiers on one gateway",
      compatibleId(did, "/activities/1"),
      [compatibleId(otherDid, "/actor")],
    ],
    [
      "compatible activity ID and ap+ef61: actor ID",
      compatibleId(did, "/activities/1"),
      [portableId(otherDid, "/actor")],
    ],
    [
      "ap+ef61: activity ID and compatible actor ID",
      portableId(did, "/activities/1"),
      [compatibleId(otherDid, "/actor")],
    ],
    [
      "one of multiple actors with another DID",
      portableId(did, "/activities/1"),
      [portableId(did, "/actor"), portableId(otherDid, "/actor")],
    ],
    [
      "ap+ef61: activity ID and HTTP(S) actor ID",
      portableId(did, "/activities/1"),
      [new URL("https://example.com/person")],
    ],
    [
      "compatible activity ID and HTTP(S) actor ID on the gateway",
      compatibleId(did, "/activities/1"),
      [new URL(`${GATEWAY}/users/alice`)],
    ],
  ];
  for (const [name, id, actors] of cases) {
    await t.step(name, async () => {
      const served = await portableCreate(id, actors);
      assertEquals(await route(id, { served }), {
        routed: false,
        received: [],
      });
      // The same with the proof of the served activity attached:
      assertEquals(await route(served), { routed: false, received: [] });
    });
  }
});

test("Context.routeActivity() accepts portable activities of the same DID", async (t) => {
  const cases: [string, URL, URL[]][] = [
    [
      "ap+ef61: IDs",
      portableId(did, "/activities/1"),
      [portableId(did, "/actor")],
    ],
    [
      "compatible identifiers on one gateway",
      compatibleId(did, "/activities/1"),
      [compatibleId(did, "/actor")],
    ],
    [
      "compatible identifiers on different gateways",
      compatibleId(did, "/activities/1"),
      [compatibleId(did, "/actor", "https://gw2.example")],
    ],
    [
      "compatible activity ID and ap+ef61: actor ID",
      compatibleId(did, "/activities/1"),
      [portableId(did, "/actor")],
    ],
    [
      "ap+ef61: activity ID and compatible actor ID",
      portableId(did, "/activities/1"),
      [compatibleId(did, "/actor")],
    ],
    [
      "actor ID with a location hint",
      portableId(did, "/activities/1"),
      [
        portableId(
          did,
          `/actor?@gateway=${encodeURIComponent(GATEWAY)}`,
        ),
      ],
    ],
  ];
  for (const [name, id, actors] of cases) {
    await t.step(name, async () => {
      const served = await portableCreate(id, actors);
      const expected = {
        routed: true,
        received: actors.map((actor) => actor.href),
      };
      assertEquals(await route(id, { served }), expected);
      // The same with the proof of the served activity attached:
      assertEquals(await route(served), expected);
    });
  }
});

test("Context.routeActivity() compares portable activity IDs canonically", async (t) => {
  const id = portableId(did, "/activities/1");
  const actors = [portableId(did, "/actor")];

  await t.step("compatible ID serving an ap+ef61: ID", async () => {
    const served = await portableCreate(id, actors);
    const { routed } = await route(compatibleId(did, "/activities/1"), {
      served,
    });
    assert(routed);
  });

  await t.step("ap+ef61: ID serving a compatible ID", async () => {
    const served = await portableCreate(
      compatibleId(did, "/activities/1"),
      actors,
    );
    const { routed } = await route(id, { served });
    assert(routed);
  });

  await t.step("ap+ef61: ID with a location hint", async () => {
    const served = await portableCreate(id, actors);
    const { routed } = await route(
      portableId(
        did,
        `/activities/1?@gateway=${encodeURIComponent(GATEWAY)}`,
      ),
      { served },
    );
    assert(routed);
  });

  await t.step("another path of the same DID", async () => {
    const served = await portableCreate(
      portableId(did, "/activities/2"),
      actors,
    );
    const { routed } = await route(id, { served });
    assertFalse(routed);
  });

  await t.step("another fragment of the same DID", async () => {
    const served = await portableCreate(
      portableId(did, "/activities/1#other"),
      actors,
    );
    const { routed } = await route(id, { served });
    assertFalse(routed);
  });
});

test("Context.routeActivity() rejects proofs of other DIDs for portable actors", async () => {
  const id = portableId(did, "/activities/1");
  const actors = [portableId(did, "/actor")];
  // Nothing is served at the ID, so only the proof can authenticate it:
  const signed = await portableCreate(id, actors, "otherDid");
  assertEquals(await route(signed), { routed: false, received: [] });
  // The proof of the actor's DID authenticates it without dereferencing:
  assertEquals(await route(await portableCreate(id, actors)), {
    routed: true,
    received: actors.map((actor) => actor.href),
  });
});

test("Context.routeActivity() keeps comparing web origins of HTTP(S) IDs", async (t) => {
  const cases: [string, URL, URL, boolean][] = [
    [
      "same origin",
      new URL("https://remote.example/activities/1"),
      new URL("https://remote.example/users/alice"),
      true,
    ],
    [
      "same origin with an explicit default port",
      new URL("https://remote.example/activities/1"),
      new URL("https://remote.example:443/users/alice"),
      true,
    ],
    [
      "another origin",
      new URL("https://remote.example/activities/1"),
      new URL("https://other.example/users/alice"),
      false,
    ],
    [
      "another port",
      new URL("https://remote.example/activities/1"),
      new URL("https://remote.example:8443/users/alice"),
      false,
    ],
    [
      "compatible actor ID on the same host",
      new URL("https://remote.example/activities/1"),
      compatibleId(did, "/actor", "https://remote.example"),
      false,
    ],
  ];
  for (const [name, id, actor, expected] of cases) {
    await t.step(name, async () => {
      const served = new Create({ id, actor });
      const { routed, received } = await route(id, { served });
      assertEquals(routed, expected);
      assertEquals(received, expected ? [actor.href] : []);
    });
  }
});
