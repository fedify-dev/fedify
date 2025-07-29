import {
  Accept,
  createFederation,
  Endpoints,
  Follow,
  generateCryptoKeyPair,
  MemoryKvStore,
  Person,
  Undo,
} from "@fedify/fedify";
import { configure, getConsoleSink } from "@logtape/logtape";
import { Elysia } from "elysia";
import { fedify } from "./src/index.ts";

const keyPairsStore = new Map<string, Array<CryptoKeyPair>>();
const relationStore = new Map<string, string>();

// Logging settings for diagnostics:
await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    {
      category: "fedify",
      lowestLevel: "debug",
      sinks: ["console"],
      filters: [],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
      filters: [],
    },
  ],
});

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

federation
  .setNodeInfoDispatcher("/nodeinfo/2.1", async (ctx) => {
    return {
      software: {
        name: "your-software-name", // Lowercase, digits, and hyphens only.
        version: { major: 1, minor: 0, patch: 0 },
        homepage: new URL("https://your-software.com/"),
      },
      protocols: ["activitypub"],
      usage: {
        // Usage statistics is hard-coded here for demonstration purposes.
        // You should replace these with real statistics:
        users: { total: 100, activeHalfyear: 50, activeMonth: 20 },
        localPosts: 1000,
        localComments: 2000,
      },
    };
  });

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (identifier !== "demo") {
      return null;
    }
    const keyPairs = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      name: "Fedify Demo",
      summary: "This is a Fedify Demo account.",
      preferredUsername: identifier,
      url: new URL("/", ctx.url),
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      publicKey: keyPairs[0].cryptographicKey,
      assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
    });
  })
  .setKeyPairsDispatcher(async (_, identifier) => {
    if (identifier != "demo") {
      return [];
    }
    const keyPairs = keyPairsStore.get(identifier);
    if (keyPairs) {
      return keyPairs;
    }
    const { privateKey, publicKey } = await generateCryptoKeyPair();
    keyPairsStore.set(identifier, [{ privateKey, publicKey }]);
    return [{ privateKey, publicKey }];
  });

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (context, follow) => {
    if (
      follow.id == null ||
      follow.actorId == null ||
      follow.objectId == null
    ) {
      return;
    }
    const result = context.parseUri(follow.objectId);
    if (result?.type !== "actor" || result.identifier !== "demo") {
      return;
    }
    const follower = await follow.getActor(context);
    if (follower?.id == null) {
      throw new Error("follower is null");
    }
    await context.sendActivity(
      { identifier: result.identifier },
      follower,
      new Accept({
        id: new URL(
          `#accepts/${follower.id.href}`,
          context.getActorUri("demo"),
        ),
        actor: follow.objectId,
        object: follow,
      }),
    );
    relationStore.set(follower.id.href, follow.objectId.href);
  })
  .on(Undo, async (context, undo) => {
    const activity = await undo.getObject(context);
    if (activity instanceof Follow) {
      if (activity.id == null) {
        return;
      }
      if (undo.actorId == null) {
        return;
      }
      relationStore.delete(undo.actorId.href);
    } else {
      console.debug(undo);
    }
  });

const app = new Elysia()
  // Elysia automatically handles proxy headers when behind a reverse proxy
  // No need for explicit "trust proxy" setting

  .use(fedify(federation, () => void 0))
  .get("/", ({ request, set }) => {
    // Set content type
    set.headers["Content-Type"] = "text/plain";

    // Get host from request headers
    const host = request.headers.get("host") || "localhost";

    return `
 _____        _ _  __         ____
|  ___|__  __| (_)/ _|_   _  |  _ \\  ___ _ __ ___   ___
| |_ / _ \\/ _\` | | |_| | | | | | | |/ _ \\ '_ \` _ \\ / _ \\
|  _|  __/ (_| | |  _| |_| | | |_| |  __/ | | | | | (_) |
|_|  \\___|\\__,_|_|_|  \\__, | |____/ \\___|_| |_| |_|\\___/
                      |___/

This small federated server app is a demo of Fedify.  The only one
thing it does is to accept follow requests.

You can follow this demo app via the below handle:

    @demo@${host}

This account has the below ${relationStore.size} followers:

    ${Array.from(relationStore.values()).join("\n    ")}
  `;
  }).get(
    "/nodeinfo/2.1",
    () => "hi",
  );

app.listen(3000);
console.log("Elysia");
