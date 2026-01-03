import { WorkersKvStore, WorkersMessageQueue } from "@fedify/cfworkers";
import {
  createFederationBuilder,
  type Federation,
  type Message,
} from "@fedify/fedify/federation";
import {
  exportJwk,
  generateCryptoKeyPair,
  importJwk,
} from "@fedify/fedify/sig";
import {
  Accept,
  Endpoints,
  Follow,
  isActor,
  Object,
  Person,
  Undo,
} from "@fedify/vocab";

interface ContextData {
  kv: KVNamespace<string>;
}

interface KeyPair {
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
}

const builder = createFederationBuilder<ContextData>();

builder
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (identifier !== "test") return null;
    const keyPairs = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      name: "Test actor",
      summary: "A test actor to test Fedify on Cloudflare Workers",
      preferredUsername: "test",
      url: new URL("/", ctx.canonicalOrigin),
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      publicKey: keyPairs[0].cryptographicKey,
      assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
    });
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    if (identifier !== "test") return [];
    const key = (await ctx.data.kv.get("key", "json")) as KeyPair | undefined;
    if (key == null) {
      const { privateKey, publicKey } = await generateCryptoKeyPair(
        "RSASSA-PKCS1-v1_5",
      );
      await ctx.data.kv.put(
        "key",
        JSON.stringify({
          privateKey: await exportJwk(privateKey),
          publicKey: await exportJwk(publicKey),
        }),
      );
      return [{ privateKey, publicKey }];
    }
    const privateKey = await importJwk(key.privateKey, "private");
    const publicKey = await importJwk(key.publicKey, "public");
    return [{ privateKey, publicKey }];
  });

builder
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    if (
      follow.id == null ||
      follow.actorId == null ||
      follow.objectId == null
    ) {
      return;
    }
    const result = ctx.parseUri(follow.objectId);
    if (result?.type !== "actor" || result.identifier !== "test") return;
    const follower = await follow.getActor(ctx);
    if (follower == null) return;
    await ctx.sendActivity(
      { identifier: result.identifier },
      follower,
      new Accept({
        id: new URL(
          `#accepts/${follower.id?.href}`,
          ctx.getActorUri(result.identifier),
        ),
        actor: follow.objectId,
        object: follow,
      }),
    );
    await ctx.data.kv.put(
      `followers/${follow.id.href}`,
      JSON.stringify(await follower.toJsonLd(ctx)),
    );
  })
  .on(Undo, async (ctx, undo) => {
    const activity = await undo.getObject(ctx);
    if (activity instanceof Follow) {
      if (activity.id == null) return;
      await ctx.data.kv.delete(`followers/${activity.id.href}`);
    }
  });

async function listFollowers(request: Request, env: Env): Promise<Response> {
  const keys = await env.FEDIFY_KV.list({ prefix: "followers/" });
  const values = keys.keys.length > 0
    ? await env.FEDIFY_KV.get(
      keys.keys.map((k) => k.name),
      { type: "json" },
    )
    : new Map();
  const followers = values.size > 0
    ? (
      await Promise.all(
        [...values.values()].map((json) => Object.fromJsonLd(json)),
      )
    ).filter(isActor)
    : [];
  const list = followers.map((f) => `- ${f.name} (${f.id?.href})`).join("\n");
  return new Response(
    `Please follow @test@${new URL(request.url).host}!

Followers:\n\n${list}

You can get the source code of this application from \
<https://github.com/fedify-dev/fedify/tree/main/examples/cloudflare-workers>.
`,
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

export default {
  async fetch(req, env, _ctx): Promise<Response> {
    // Since `KvNamespace` and `Queue` are not bound to global variables,
    // but rather passed as an argument to the `fetch()` and `queue()` methods,
    // you need to instantiate your `Federation` object inside these methods,
    // rather than at the top level:
    const federation: Federation<ContextData> = await builder.build({
      kv: new WorkersKvStore(env.FEDIFY_KV),
      queue: new WorkersMessageQueue(env.FEDIFY_QUEUE),
    });
    const url = new URL(req.url);
    if (url.pathname === "/") return await listFollowers(req, env);
    return await federation.fetch(req, { contextData: { kv: env.FEDIFY_KV } });
  },

  // Since defining a `queue()` method is the only way to consume messages
  // from the queue in Cloudflare Workers, we need to define it so that
  // the messages can be manually processed by `Federation.processQueuedTask()`
  // method:
  async queue(batch, env): Promise<void> {
    const federation: Federation<ContextData> = await builder.build({
      kv: new WorkersKvStore(env.FEDIFY_KV),
      queue: new WorkersMessageQueue(env.FEDIFY_QUEUE),
    });
    for (const message of batch.messages) {
      await federation.processQueuedTask(
        { kv: env.FEDIFY_KV },
        // You need to cast the message body to `Message`:
        message.body as unknown as Message,
      );
    }
  },
} satisfies ExportedHandler<Env, Error>;
