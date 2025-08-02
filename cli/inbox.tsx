/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
import { colors } from "@cliffy/ansi";
import { Command } from "@cliffy/command";
import { Cell, Table } from "@cliffy/table";
import {
  Accept,
  Activity,
  type Actor,
  Application,
  type Context,
  createFederation,
  Delete,
  Endpoints,
  Follow,
  generateCryptoKeyPair,
  getActorHandle,
  Image,
  isActor,
  lookupObject,
  MemoryKvStore,
  PUBLIC_COLLECTION,
  type Recipient,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { parse } from "@std/semver";
import { type Context as HonoContext, Hono } from "hono";
import type { BlankEnv, BlankInput } from "hono/types";
import ora from "ora";
import metadata from "./deno.json" with { type: "json" };
import { getDocumentLoader } from "./docloader.ts";
import type { ActivityEntry } from "./inbox/entry.ts";
import { ActivityEntryPage, ActivityListPage } from "./inbox/view.tsx";
import { recordingSink } from "./log.ts";
import { tableStyle } from "./table.ts";
import { spawnTemporaryServer, type TemporaryServer } from "./tempserver.ts";

/**
 * Context data for the ephemeral ActivityPub inbox server.
 *
 * This interface defines the shape of context data passed to federation
 * handlers during inbox command execution.
 */
interface ContextData {
  activityIndex: number;
  actorName: string;
  actorSummary: string;
}

/**
 * Options for actor customization.
 */
interface ActorOptions {
  actorName: string;
  actorSummary: string;
}

/**
 * Options for the inbox command.
 */
export interface InboxOptions {
  follow?: string[];
  acceptFollow?: string[];
  tunnel: boolean;
  noTunnel?: boolean; // for -T shorthand support
}

export const TunnelConfig = {
  shouldDisableTunnel: (opts: InboxOptions): boolean => {
    return opts.tunnel === false || opts.noTunnel === true;
  },
} as const;

const logger = getLogger(["fedify", "cli", "inbox"]);

export const command = new Command()
  .description(
    "Spins up an ephemeral server that serves the ActivityPub inbox with " +
      "an one-time actor, through a short-lived public DNS with HTTPS.  " +
      "You can monitor the incoming activities in real-time.",
  )
  .option(
    "-f, --follow=<uri:string>",
    "Follow the given actor.  The argument can be either an actor URI or " +
      "a handle.  Can be specified multiple times.",
    { collect: true },
  )
  .option(
    "-a, --accept-follow=<uri:string>",
    "Accept follow requests from the given actor.  The argument can be " +
      "either an actor URI or a handle, or a wildcard (*).  Can be " +
      "specified multiple times.  If a wildcard is specified, all follow " +
      "requests will be accepted.",
    { collect: true },
  )
  .option(
    "-T, --no-tunnel",
    "Do not tunnel the ephemeral ActivityPub server to the public Internet.",
  )
  .option(
    "--actor-name=<name:string>",
    "Customize the actor display name.",
    { default: "Fedify Ephemeral Inbox" },
  )
  .option(
    "--actor-summary=<summary:string>",
    "Customize the actor description.",
    { default: "An ephemeral ActivityPub inbox for testing purposes." },
  )
  .action(async (options: InboxOptions & ActorOptions) => {
    const fetch = createFetchHandler(options);
    const sendDeleteToPeers = createSendDeleteToPeers(options);

    const spinner = ora({
      text: "Spinning up an ephemeral ActivityPub server...",
      discardStdin: false,
    }).start();
    const server = await spawnTemporaryServer(fetch, {
      noTunnel: TunnelConfig.shouldDisableTunnel(options),
    });
    spinner.succeed(
      `The ephemeral ActivityPub server is up and running: ${
        colors.green(
          server.url.href,
        )
      }`,
    );
    Deno.addSignalListener("SIGINT", () => {
      spinner.stop();
      const peersCnt = Object.keys(peers).length;
      spinner.start(
        `Sending Delete(Application) activities to the ${peersCnt} ${
          peersCnt === 1 ? "peer" : "peers"
        }...`,
      );
      sendDeleteToPeers(server).then(() => {
        spinner.text = "Stopping server...";
        server.close().then(() => {
          spinner.succeed("Server stopped.");
          Deno.exit(0);
        });
      });
    });
    spinner.start();

    const fedCtx = federation.createContext(server.url, {
      activityIndex: -1,
      actorName: options.actorName,
      actorSummary: options.actorSummary,
    });

    if (options.acceptFollow != null && options.acceptFollow.length > 0) {
      acceptFollows.push(...(options.acceptFollow ?? []));
    }
    if (options.follow != null && options.follow.length > 0) {
      spinner.text = "Following actors...";
      const documentLoader = await fedCtx.getDocumentLoader({
        identifier: "i",
      });
      for (const uri of options.follow) {
        spinner.text = `Following ${colors.green(uri)}...`;
        const actor = await lookupObject(uri, { documentLoader });
        if (!isActor(actor)) {
          spinner.fail(`Not an actor: ${colors.red(uri)}`);
          spinner.start();
          continue;
        }
        if (actor.id != null) peers[actor.id?.href] = actor;
        await fedCtx.sendActivity(
          { identifier: "i" },
          actor,
          new Follow({
            id: new URL(`#follows/${actor.id?.href}`, fedCtx.getActorUri("i")),
            actor: fedCtx.getActorUri("i"),
            object: actor.id,
          }),
        );
        spinner.succeed(`Sent follow request to ${colors.green(uri)}.`);
        spinner.start();
      }
    }
    spinner.stop();
    printServerInfo(fedCtx);
  });

const federation = createFederation<ContextData>({
  kv: new MemoryKvStore(),
  documentLoader: await getDocumentLoader(),
});

const time = Temporal.Now.instant();
let actorKeyPairs: CryptoKeyPair[] | undefined = undefined;

federation
  .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
    if (identifier !== "i") return null;
    return new Application({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: ctx.data.actorName,
      summary: ctx.data.actorSummary,
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      followers: ctx.getFollowersUri(identifier),
      following: ctx.getFollowingUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      manuallyApprovesFollowers: true,
      published: time,
      icon: new Image({
        url: new URL("https://fedify.dev/logo.png"),
        mediaType: "image/png",
      }),
      publicKey: (await ctx.getActorKeyPairs(identifier))[0].cryptographicKey,
      assertionMethods: (await ctx.getActorKeyPairs(identifier))
        .map((pair) => pair.multikey),
      url: ctx.getActorUri(identifier),
    });
  })
  .setKeyPairsDispatcher(async (_ctxData, identifier) => {
    if (identifier !== "i") return [];
    if (actorKeyPairs == null) {
      actorKeyPairs = [
        await generateCryptoKeyPair("RSASSA-PKCS1-v1_5"),
        await generateCryptoKeyPair("Ed25519"),
      ];
    }
    return actorKeyPairs;
  });

const activities: ActivityEntry[] = [];

const acceptFollows: string[] = [];

async function acceptsFollowFrom(actor: Actor): Promise<boolean> {
  const actorUri = actor.id;
  let actorHandle: string | undefined = undefined;
  if (actorUri == null) return false;
  for (let uri of acceptFollows) {
    if (uri === "*") return true;
    if (uri.startsWith("http:") || uri.startsWith("https:")) {
      uri = new URL(uri).href; // normalize
      if (uri === actorUri.href) return true;
    }
    if (actorHandle == null) actorHandle = await getActorHandle(actor);
    if (actorHandle === uri) return true;
  }
  return false;
}

const peers: Record<string, Actor> = {};

function createSendDeleteToPeers(
  actorOptions: ActorOptions,
): (server: TemporaryServer) => Promise<void> {
  return async function sendDeleteToPeers(
    server: TemporaryServer,
  ): Promise<void> {
    const ctx = federation.createContext(new Request(server.url), {
      activityIndex: -1,
      actorName: actorOptions.actorName,
      actorSummary: actorOptions.actorSummary,
    });

    const actor = (await ctx.getActor("i"))!;
    try {
      await ctx.sendActivity(
        { identifier: "i" },
        Object.values(peers),
        new Delete({
          id: new URL(`#delete`, actor.id!),
          actor: actor.id!,
          to: PUBLIC_COLLECTION,
          object: actor,
        }),
      );
    } catch (error) {
      logger.error(
        "Failed to send Delete(Application) activities to peers:\n{error}",
        { error },
      );
    }
  };
}

const followers: Record<string, Actor> = {};

federation
  .setInboxListeners("/{identifier}/inbox", "/inbox")
  .setSharedKeyDispatcher((_) => ({ identifier: "i" }))
  .on(Activity, async (ctx, activity) => {
    activities[ctx.data.activityIndex].activity = activity;
    for await (const actor of activity.getActors()) {
      if (actor.id != null) peers[actor.id.href] = actor;
    }
    for await (const actor of activity.getAttributions()) {
      if (actor.id != null) peers[actor.id.href] = actor;
    }
    if (activity instanceof Follow) {
      if (acceptFollows.length < 1) return;
      const objectId = activity.objectId;
      if (objectId == null) return;
      const parsed = ctx.parseUri(objectId);
      if (parsed?.type !== "actor" || parsed.identifier !== "i") return;
      const { identifier } = parsed;
      const follower = await activity.getActor();
      if (!isActor(follower)) return;
      const accepts = await acceptsFollowFrom(follower);
      if (!accepts || activity.id == null) {
        logger.debug("Does not accept follow from {actor}.", {
          actor: follower.id?.href,
        });
        return;
      }
      logger.debug("Accepting follow from {actor}.", {
        actor: follower.id?.href,
      });
      followers[activity.id.href] = follower;
      await ctx.sendActivity(
        { identifier },
        follower,
        new Accept({
          id: new URL(`#accepts/${follower.id?.href}`, ctx.getActorUri("i")),
          actor: ctx.getActorUri(identifier),
          object: activity.id,
        }),
      );
    }
  });

federation
  .setFollowersDispatcher("/{identifier}/followers", (_ctx, identifier) => {
    if (identifier !== "i") return null;
    const items: Recipient[] = [];
    for (const follower of Object.values(followers)) {
      if (follower.id == null) continue;
      items.push(follower);
    }
    return { items };
  })
  .setCounter((_ctx, identifier) => {
    if (identifier !== "i") return null;
    return Object.keys(followers).length;
  });

federation
  .setFollowingDispatcher(
    "/{identifier}/following",
    (_ctx, _identifier) => null,
  )
  .setCounter((_ctx, _identifier) => 0);

federation
  .setOutboxDispatcher("/{identifier}/outbox", (_ctx, _identifier) => null)
  .setCounter((_ctx, _identifier) => 0);

federation.setNodeInfoDispatcher("/nodeinfo/2.1", (_ctx) => {
  return {
    software: {
      name: "fedify-cli",
      version: parse(metadata.version),
      repository: new URL("https://github.com/fedify-dev/fedify"),
    },
    protocols: ["activitypub"],
    usage: {
      users: {
        total: 1,
        activeMonth: 1,
        activeHalfyear: 1,
      },
      localComments: 0,
      localPosts: 0,
    },
  };
});

function printServerInfo(fedCtx: Context<ContextData>): void {
  new Table(
    [
      new Cell("Actor handle:").align("right"),
      colors.green(`i@${fedCtx.getActorUri("i").host}`),
    ],
    [
      new Cell("Actor URI:").align("right"),
      colors.green(fedCtx.getActorUri("i").href),
    ],
    [
      new Cell("Actor inbox:").align("right"),
      colors.green(fedCtx.getInboxUri("i").href),
    ],
    [
      new Cell("Shared inbox:").align("right"),
      colors.green(fedCtx.getInboxUri().href),
    ],
  )
    .chars(tableStyle)
    .border()
    .render();
}

async function printActivityEntry(
  idx: number,
  entry: ActivityEntry,
): Promise<void> {
  const request = entry.request.clone();
  const response = entry.response?.clone();
  const url = new URL(request.url);
  const activity = entry.activity;
  const object = await activity?.getObject();
  new Table(
    [new Cell("Request #:").align("right"), colors.bold(idx.toString())],
    [
      new Cell("Activity type:").align("right"),
      activity == null ? colors.red("failed to parse") : colors.green(
        `${activity.constructor.name}(${object?.constructor.name})`,
      ),
    ],
    [
      new Cell("HTTP request:").align("right"),
      `${
        request.method === "POST"
          ? colors.green("POST")
          : colors.red(request.method)
      } ${url.pathname + url.search}`,
    ],
    ...(response == null ? [] : [
      [
        new Cell("HTTP response:").align("right"),
        `${
          response.ok
            ? colors.green(response.status.toString())
            : colors.red(response.status.toString())
        } ${response.statusText}`,
      ],
    ]),
    [new Cell("Details").align("right"), new URL(`/r/${idx}`, url).href],
  )
    .chars(tableStyle)
    .border()
    .render();
}

function getHandle<T extends string>(
  c: HonoContext<BlankEnv, T, BlankInput>,
): string {
  const url = new URL(c.req.url);
  return `@i@${url.host}`;
}

const app = new Hono();

app.get("/", (c) => c.redirect("/r"));

app.get(
  "/r",
  (c) =>
    c.html(
      <ActivityListPage handle={getHandle(c)} entries={activities} />,
    ),
);

app.get("/r/:idx{[0-9]+}", (c) => {
  const idx = parseInt(c.req.param("idx"));
  const tab = c.req.query("tab") ?? "request";
  const activity = activities[idx];
  if (activity == null) return c.notFound();
  if (
    tab !== "request" && tab !== "response" && tab !== "raw-activity" &&
    tab !== "compact-activity" && tab !== "expanded-activity" && tab !== "logs"
  ) {
    return c.notFound();
  }
  return c.html(
    <ActivityEntryPage
      handle={getHandle(c)}
      idx={idx}
      entry={activity}
      tabPage={tab}
    />,
  );
});

function createFetchHandler(
  actorOptions: ActorOptions,
): (request: Request) => Promise<Response> {
  return async function fetch(request: Request): Promise<Response> {
    const timestamp = Temporal.Now.instant();
    const idx = activities.length;
    const pathname = new URL(request.url).pathname;
    if (pathname === "/r" || pathname.startsWith("/r/")) {
      return app.fetch(request);
    }
    const inboxRequest = pathname === "/inbox" ||
      pathname.startsWith("/i/inbox");
    if (inboxRequest) {
      recordingSink.startRecording();
      // @ts-ignore: Work around `deno publish --dry-run` bug
      activities.push({ timestamp, request: request.clone(), logs: [] });
    }
    const response = await federation.fetch(request, {
      contextData: {
        activityIndex: inboxRequest ? idx : -1,
        actorName: actorOptions.actorName,
        actorSummary: actorOptions.actorSummary,
      },
      onNotAcceptable: app.fetch.bind(app),
      onNotFound: app.fetch.bind(app),
      onUnauthorized: app.fetch.bind(app),
    });
    if (inboxRequest) {
      recordingSink.stopRecording();
      activities[idx].response = response.clone();
      activities[idx].logs = recordingSink.getRecords();
      await printActivityEntry(idx, activities[idx]);
    }
    return response;
  };
}
