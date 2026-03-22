import { federation } from "@fedify/hono";
import {
  Create,
  Follow,
  Note,
  Person,
  PUBLIC_COLLECTION,
  Undo,
} from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import type { Context as HonoContext } from "hono";
import { Hono } from "hono";
import { ACTOR_ID } from "./const.ts";
import type createFedify from "./federation.ts";
import { activityLog, followersStore } from "./federation.ts";

const logger = getLogger(["fedify", "examples", "rfc-9421-test", "send"]);

type Fedi = ReturnType<typeof createFedify>;

interface AppConfig {
  firstKnock: string;
  challengeEnabled: boolean;
  challengeNonce: boolean;
  nonceTtl: number;
}

export default function createApp(fedi: Fedi, config: AppConfig) {
  const app = new Hono();
  app.use(federation(fedi, () => undefined));

  app.get("/", root(config));
  app.get("/send/follow", sendFollow(fedi));
  app.post("/send/follow", sendFollow(fedi));
  app.get("/send/note", sendNote(fedi));
  app.post("/send/note", sendNote(fedi));
  app.get("/send/unfollow", sendUnfollow(fedi));
  app.post("/send/unfollow", sendUnfollow(fedi));

  app.get("/log", (c) => c.json(activityLog.slice().reverse()));
  app.get("/followers", (c) => c.json(Array.from(followersStore.entries())));

  return app;
}

function root(config: AppConfig) {
  return (c: HonoContext) =>
    c.json({
      name: "RFC 9421 Field Test Server",
      actor: `${new URL(c.req.url).origin}/users/${ACTOR_ID}`,
      webfinger: `${
        new URL(c.req.url).origin
      }/.well-known/webfinger?resource=acct:${ACTOR_ID}@${
        new URL(c.req.url).hostname
      }`,
      config,
      endpoints: {
        activityLog: "/log",
        followers: "/followers",
        sendFollow: "/send/follow?handle=@user@example.com",
        sendNote: "/send/note?handle=@user@example.com&content=Hello",
        sendUnfollow: "/send/unfollow?handle=@user@example.com",
      },
    });
}

function sendFollow(fedi: Fedi) {
  return async (c: HonoContext) => {
    const result = await resolveActor(fedi, c);
    if ("error" in result) return result.error;
    const { actor, ctx } = result;

    const actorUri = ctx.getActorUri(ACTOR_ID);
    const followId = new URL(`#follow/${Date.now()}`, actorUri);
    const follow = new Follow({
      id: followId,
      actor: actorUri,
      object: actor.id,
    });

    logger.info("Sending Follow to {target}", { target: actor.id?.href });
    try {
      await ctx.sendActivity({ identifier: ACTOR_ID }, actor, follow);
    } catch (e) {
      logger.error("Failed: {error}", { error: e });
      return c.json({ ok: false, error: String(e) }, 502);
    }
    return c.json({
      ok: true,
      activityId: followId.href,
      target: actor.id?.href,
    });
  };
}

function sendNote(fedi: Fedi) {
  return async (c: HonoContext) => {
    const result = await resolveActor(fedi, c);
    if ("error" in result) return result.error;
    const { actor, ctx } = result;

    const content = (await getParam(c, "content")) ??
      "Hello from Fedify RFC 9421 field test!";
    const actorUri = ctx.getActorUri(ACTOR_ID);
    const noteId = new URL(
      `/users/${ACTOR_ID}/posts/${Date.now()}`,
      ctx.origin,
    );
    const note = new Note({
      id: noteId,
      attribution: actorUri,
      content,
      mediaType: "text/plain",
      to: PUBLIC_COLLECTION,
      published: Temporal.Now.instant(),
    });
    const create = new Create({
      id: new URL(`#create/${Date.now()}`, actorUri),
      actor: actorUri,
      object: note,
      tos: [PUBLIC_COLLECTION],
    });

    logger.info("Sending Create(Note) to {target}", {
      target: actor.id?.href,
    });
    try {
      await ctx.sendActivity({ identifier: ACTOR_ID }, actor, create);
    } catch (e) {
      logger.error("Failed: {error}", { error: e });
      return c.json({ ok: false, error: String(e) }, 502);
    }
    return c.json({
      ok: true,
      activityId: noteId.href,
      target: actor.id?.href,
    });
  };
}

function sendUnfollow(fedi: Fedi) {
  return async (c: HonoContext) => {
    const result = await resolveActor(fedi, c);
    if ("error" in result) return result.error;
    const { actor, ctx } = result;

    const actorUri = ctx.getActorUri(ACTOR_ID);
    const follow = new Follow({
      id: new URL(`#follow/existing`, actorUri),
      actor: actorUri,
      object: actor.id,
    });
    const undo = new Undo({
      id: new URL(`#undo/${Date.now()}`, actorUri),
      actor: actorUri,
      object: follow,
    });

    logger.info("Sending Undo(Follow) to {target}", {
      target: actor.id?.href,
    });
    try {
      await ctx.sendActivity({ identifier: ACTOR_ID }, actor, undo);
    } catch (e) {
      logger.error("Failed: {error}", { error: e });
      return c.json({ ok: false, error: String(e) }, 502);
    }
    return c.json({ ok: true, target: actor.id?.href });
  };
}

/** Look up a remote actor by fediverse handle. */
async function resolveActor(fedi: Fedi, c: HonoContext) {
  const handle = await getParam(c, "handle");
  if (!handle) {
    return { error: c.json({ ok: false, error: "missing handle" }, 400) };
  }
  const ctx = fedi.createContext(c.req.raw);
  const obj = await ctx.lookupObject(handle);
  if (!obj) {
    return {
      error: c.json({ ok: false, error: `could not resolve: ${handle}` }, 502),
    };
  }
  if (!(obj instanceof Person)) {
    return {
      error: c.json({
        ok: false,
        error: `not a Person: ${obj.constructor.name}`,
      }, 400),
    };
  }
  return { actor: obj, ctx };
}

/** Read a param from query string (GET) or JSON body (POST). */
async function getParam(
  c: HonoContext,
  name: string,
): Promise<string | undefined> {
  const fromQuery = c.req.query(name);
  if (fromQuery != null) return fromQuery;
  if (c.req.method === "POST") {
    try {
      const body = await c.req.json();
      return body[name] ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
