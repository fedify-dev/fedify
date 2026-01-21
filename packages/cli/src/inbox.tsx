/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
import {
  type Context,
  createFederation,
  type Federation,
  generateCryptoKeyPair,
  MemoryKvStore,
  type RequestContext,
} from "@fedify/fedify";
import {
  Accept,
  Activity,
  type Actor,
  Application,
  Delete,
  Endpoints,
  Follow,
  Image,
  isActor,
  lookupObject,
  PUBLIC_COLLECTION,
  type Recipient,
} from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import {
  choice,
  command,
  constant,
  flag,
  type InferValue,
  map,
  merge,
  message,
  multiple,
  object,
  option,
  optional,
  or,
  string,
  value,
  withDefault,
} from "@optique/core";
import Table from "cli-table3";
import { type Context as HonoContext, Hono } from "hono";
import type { BlankEnv, BlankInput } from "hono/types";
import process from "node:process";
import ora from "ora";
import metadata from "../deno.json" with { type: "json" };
import { getDocumentLoader } from "./docloader.ts";
import { configureLogging, debugOption } from "./globals.ts";
import type { ActivityEntry } from "./inbox/entry.ts";
import { ActivityEntryPage, ActivityListPage } from "./inbox/view.tsx";
import { recordingSink } from "./log.ts";
import { tableStyle } from "./table.ts";
import { spawnTemporaryServer, type TemporaryServer } from "./tempserver.ts";
import { colors, matchesActor } from "./utils.ts";

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

const logger = getLogger(["fedify", "cli", "inbox"]);

export const inboxCommand = command(
  "inbox",
  merge(
    object("Inbox options", {
      command: constant("inbox"),
      follow: optional(
        multiple(
          option("-f", "--follow", string({ metavar: "URI" }), {
            description:
              message`Follow the given actor. The argument can be either an actor URI or a handle. Can be specified multiple times.`,
          }),
        ),
      ),
      acceptFollow: optional(
        multiple(
          option("-a", "--accept-follow", string({ metavar: "URI" }), {
            description:
              message`Accept follow requests from the given actor. The argument can be either an actor URI or a handle, or a wildcard (${"*"}). Can be specified multiple times. If a wildcard is specified, all follow requests will be accepted.`,
          }),
        ),
      ),
    }),
    or(
      object({
        tunnel: map(
          flag("-T", "--no-tunnel", {
            description:
              message`Do not tunnel the ephemeral ActivityPub server to the public Internet.`,
          }),
          () => false as const,
        ),
      }),
      object({
        tunnel: constant(true),
        tunnelService: optional(
          option(
            "--tunnel-service",
            choice(["localhost.run", "serveo.net", "pinggy.io"]),
            {
              description: message`The tunneling service to use: ${
                value("localhost.run")
              }, ${value("serveo.net")}, or ${value("pinggy.io")}.`,
            },
          ),
        ),
      }),
    ),
    object({
      actorName: withDefault(
        option("--actor-name", string({ metavar: "NAME" }), {
          description: message`Customize the actor display name.`,
        }),
        "Fedify Ephemeral Inbox",
      ),
      actorSummary: withDefault(
        option("--actor-summary", string({ metavar: "SUMMARY" }), {
          description: message`Customize the actor description.`,
        }),
        "An ephemeral ActivityPub inbox for testing purposes.",
      ),
      authorizedFetch: option(
        "-A",
        "--authorized-fetch",
        {
          description:
            message`Enable authorized fetch mode. Incoming requests without valid HTTP signatures will be rejected with 401 Unauthorized.`,
        },
      ),
    }),
    debugOption,
  ),
  {
    brief: message`Run an ephemeral ActivityPub inbox server.`,
    description:
      message`Spins up an ephemeral server that serves the ActivityPub inbox with an one-time actor, through a short-lived public DNS with HTTPS. You can monitor the incoming activities in real-time.`,
  },
);

// Module-level state
const activities: ActivityEntry[] = [];
const acceptFollows: string[] = [];
const peers: Record<string, Actor> = {};
const followers: Record<string, Actor> = {};

export async function runInbox(
  command: InferValue<typeof inboxCommand>,
) {
  // Reset module-level state for a clean run
  activities.length = 0;
  acceptFollows.length = 0;
  for (const key of Object.keys(peers)) delete peers[key];
  for (const key of Object.keys(followers)) delete followers[key];

  // Enable Debug mode if requested
  if (command.debug) {
    await configureLogging();
  }

  // Create federation inside runInbox to configure skipSignatureVerification
  const federationDocumentLoader = await getDocumentLoader();
  const authorizedFetchEnabled = command.authorizedFetch ?? false;

  const authorize = async (ctx: RequestContext<ContextData>) => {
    if (!authorizedFetchEnabled) return true;
    return await ctx.getSignedKey() != null;
  };

  // Instance actor must be public for key fetching per spec
  // https://swicg.github.io/activitypub-http-signature/#instance-actor
  const instanceActor = async (
    ctx: RequestContext<ContextData>,
    identifier: string,
  ) => {
    if (identifier === "ia") return true;
    return await authorize(ctx);
  };

  const federation = createFederation<ContextData>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => federationDocumentLoader,
    skipSignatureVerification: !authorizedFetchEnabled,
  });

  const time = Temporal.Now.instant();
  let actorKeyPairs: CryptoKeyPair[] | undefined = undefined;
  let instanceActorKeyPairs: CryptoKeyPair[] | undefined = undefined;

  // Set up actor dispatcher
  federation
    .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
      if (identifier !== "i" && identifier !== "ia") return null;
      const keyPairs = await ctx.getActorKeyPairs(identifier);
      return new Application({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        name: identifier === "ia" ? "Instance Actor" : ctx.data.actorName,
        summary: identifier === "ia"
          ? "Instance actor for signing requests"
          : ctx.data.actorSummary,
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
        publicKey: keyPairs[0].cryptographicKey,
        assertionMethods: keyPairs.map((pair) => pair.multikey),
        url: ctx.getActorUri(identifier),
      });
    })
    .setKeyPairsDispatcher(async (_ctxData, identifier) => {
      if (identifier === "i") {
        if (actorKeyPairs == null) {
          actorKeyPairs = [
            await generateCryptoKeyPair("RSASSA-PKCS1-v1_5"),
            await generateCryptoKeyPair("Ed25519"),
          ];
        }
        return actorKeyPairs;
      } else if (identifier === "ia") {
        if (instanceActorKeyPairs == null) {
          instanceActorKeyPairs = [
            await generateCryptoKeyPair("RSASSA-PKCS1-v1_5"),
            await generateCryptoKeyPair("Ed25519"),
          ];
        }
        return instanceActorKeyPairs;
      }
      return [];
    })
    .authorize(instanceActor);

  // Set up inbox listeners
  federation
    .setInboxListeners("/{identifier}/inbox", "/inbox")
    .setSharedKeyDispatcher((_) => ({ identifier: "ia" }))
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
        const accepts = await matchesActor(follower, acceptFollows);
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

  // Set up collection dispatchers
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
    })
    .authorize(authorize);

  federation
    .setFollowingDispatcher(
      "/{identifier}/following",
      (_ctx, _identifier) => null,
    )
    .setCounter((_ctx, _identifier) => 0)
    .authorize(authorize);

  federation
    .setOutboxDispatcher("/{identifier}/outbox", (_ctx, _identifier) => null)
    .setCounter((_ctx, _identifier) => 0)
    .authorize(authorize);

  federation.setNodeInfoDispatcher("/nodeinfo/2.1", (_ctx) => {
    return {
      software: {
        name: "fedify-cli",
        version: metadata.version,
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

  // Create handlers with the configured federation
  const fetch = createFetchHandler(
    federation,
    { actorName: command.actorName, actorSummary: command.actorSummary },
  );
  const sendDeleteToPeers = createSendDeleteToPeers(
    federation,
    { actorName: command.actorName, actorSummary: command.actorSummary },
  );

  const spinner = ora({
    text: "Spinning up an ephemeral ActivityPub server...",
    discardStdin: false,
  }).start();
  const server = await spawnTemporaryServer(fetch, {
    noTunnel: !command.tunnel,
    ...(command.tunnel && { service: command.tunnelService }),
  });
  spinner.succeed(
    `The ephemeral ActivityPub server is up and running: ${
      colors.green(
        server.url.href,
      )
    }`,
  );
  process.on("SIGINT", () => {
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
        process.exit(0);
      });
    });
  });
  spinner.start();

  const fedCtx = federation.createContext(server.url, {
    activityIndex: -1,
    actorName: command.actorName,
    actorSummary: command.actorSummary,
  });

  if (command.acceptFollow != null && command.acceptFollow.length > 0) {
    acceptFollows.push(...(command.acceptFollow ?? []));
  }
  if (command.follow != null && command.follow.length > 0) {
    spinner.text = "Following actors...";
    const documentLoader = await fedCtx.getDocumentLoader({
      identifier: "i",
    });
    for (const uri of command.follow) {
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
}

function createSendDeleteToPeers(
  federation: Federation<ContextData>,
  actorOptions: { actorName: string; actorSummary: string },
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

function printServerInfo(fedCtx: Context<ContextData>): void {
  const table = new Table({
    chars: tableStyle,
    style: { head: [], border: [] },
  });

  table.push(
    { "Actor handle:": colors.green(`i@${fedCtx.getActorUri("i").host}`) },
    { "Actor URI:": colors.green(fedCtx.getActorUri("i").href) },
    { "Actor inbox:": colors.green(fedCtx.getInboxUri("i").href) },
    { "Shared inbox:": colors.green(fedCtx.getInboxUri().href) },
  );

  console.log(table.toString());
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

  const table = new Table({
    chars: tableStyle,
    style: { head: [], border: [] },
  });

  table.push(
    { "Request #:": colors.bold(idx.toString()) },
    {
      "Activity type:": activity == null
        ? colors.red("failed to parse")
        : colors.green(
          `${activity.constructor.name}(${object?.constructor.name})`,
        ),
    },
    {
      "HTTP request:": `${
        request.method === "POST"
          ? colors.green("POST")
          : colors.red(request.method)
      } ${url.pathname + url.search}`,
    },
    ...(response == null ? [] : [{
      "HTTP response:": `${
        response.ok
          ? colors.green(response.status.toString())
          : colors.red(response.status.toString())
      } ${response.statusText}`,
    }]),
    { "Details": new URL(`/r/${idx}`, url).href },
  );

  console.log(table.toString());
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
  federation: Federation<ContextData>,
  actorOptions: { actorName: string; actorSummary: string },
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
