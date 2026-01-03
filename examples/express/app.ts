import { integrateFederation } from "@fedify/express";
import {
  createFederation,
  generateCryptoKeyPair,
  MemoryKvStore,
} from "@fedify/fedify";
import { Accept, Endpoints, Follow, Person, Undo } from "@fedify/vocab";
import { configure, getConsoleSink } from "@logtape/logtape";
import express from "express";
import process from "node:process";

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
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (identifier != "demo") {
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

const app = express();

app.set("trust proxy", true);

app.use(integrateFederation(federation, () => void 0));

app.get("/", (req, res) => {
  res.header("Content-Type", "text/plain");
  res.send(`
 _____        _ _  __         ____
|  ___|__  __| (_)/ _|_   _  |  _ \\  ___ _ __ ___   ___
| |_ / _ \\/ _\` | | |_| | | | | | | |/ _ \\ '_ \` _ \\ / _ \\
|  _|  __/ (_| | |  _| |_| | | |_| |  __/ | | | | | (_) |
|_|  \\___|\\__,_|_|_|  \\__, | |____/ \\___|_| |_| |_|\\___/
                      |___/

This small federated server app is a demo of Fedify.  The only one
thing it does is to accept follow requests.

You can follow this demo app via the below handle:

    @demo@${req.get("host")}

This account has the below ${relationStore.size} followers:

    ${Array.from(relationStore.values()).join("\n    ")}
  `);
});

const PORT = process.env.PORT ?? 8000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
