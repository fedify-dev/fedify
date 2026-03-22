import {
  createFederation,
  generateCryptoKeyPair,
  HttpMessageSignaturesSpec,
  type InboxChallengePolicy,
  MemoryKvStore,
} from "@fedify/fedify";
import {
  Accept,
  Activity,
  Create,
  Endpoints,
  Follow,
  Note,
  Person,
  Undo,
} from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import { ACTOR_ID } from "./const.ts";

const keyPairsStore = new Map<
  string,
  { privateKey: CryptoKey; publicKey: CryptoKey }[]
>();

export const followersStore = new Map<
  string,
  { id: URL; inboxId: URL | null }
>();

export const followingStore = new Map<
  string,
  { id: URL; handle: string }
>();

/** Simple event bus for SSE push to the frontend. */
type ChangeListener = (event: string) => void;
const changeListeners = new Set<ChangeListener>();
export function onStateChange(cb: ChangeListener): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}
export function emitChange(event: string): void {
  for (const cb of changeListeners) cb(event);
}

/** Log of received activities for inspection. */
export const activityLog: {
  timestamp: string;
  type: string;
  actorId: string | null;
  id: string | null;
  raw: Record<string, unknown>;
}[] = [];

const logger = getLogger(["fedify", "examples", "rfc-9421-test", "inbound"]);

export default function createFedify(
  firstKnock: HttpMessageSignaturesSpec,
  inboxChallengePolicy: InboxChallengePolicy | undefined,
) {
  const fedi = createFederation<void>({
    kv: new MemoryKvStore(),
    firstKnock,
    inboxChallengePolicy,
  });

  fedi
    .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
      if (identifier !== ACTOR_ID) return null;
      const keyPairs = await ctx.getActorKeyPairs(identifier);
      return new Person({
        id: ctx.getActorUri(identifier),
        name: "RFC 9421 Field Test",
        summary:
          "A test actor for RFC 9421 HTTP Message Signatures interoperability testing.",
        preferredUsername: identifier,
        url: new URL("/", ctx.url),
        inbox: ctx.getInboxUri(identifier),
        endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
        publicKey: keyPairs[0].cryptographicKey,
        assertionMethods: keyPairs.map((kp) => kp.multikey),
      });
    })
    .setKeyPairsDispatcher(async (_, identifier) => {
      if (identifier !== ACTOR_ID) return [];
      const existing = keyPairsStore.get(identifier);
      if (existing) return existing;
      const rsaPair = await generateCryptoKeyPair();
      const pairs = [rsaPair];
      keyPairsStore.set(identifier, pairs);
      return pairs;
    });

  fedi
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Follow, async (ctx, follow) => {
      logger.info(
        "Received Follow: actor={actor}, object={object}",
        { actor: follow.actorId?.href, object: follow.objectId?.href },
      );
      logActivity("Follow", follow);

      if (!follow.id || !follow.actorId || !follow.objectId) return;
      const result = ctx.parseUri(follow.objectId);
      if (result?.type !== "actor" || result.identifier !== ACTOR_ID) return;

      const follower = await follow.getActor(ctx);
      if (!follower?.id) return;

      // Auto-accept and record follower
      await ctx.sendActivity(
        { identifier: ACTOR_ID },
        follower,
        new Accept({
          id: new URL(
            `#accepts/${follower.id.href}`,
            ctx.getActorUri(ACTOR_ID),
          ),
          actor: follow.objectId,
          object: follow,
        }),
      );
      followersStore.set(follower.id.href, {
        id: follower.id,
        inboxId: follower.inboxId,
      });
      emitChange("followers");
      logger.info("Accepted follow from {actor}", {
        actor: follower.id.href,
      });
    })
    .on(Undo, async (ctx, undo) => {
      logger.info(
        "Received Undo: actor={actor}",
        { actor: undo.actorId?.href },
      );
      logActivity("Undo", undo);
      const activity = await undo.getObject(ctx);
      if (activity instanceof Follow && undo.actorId) {
        followersStore.delete(undo.actorId.href);
        emitChange("followers");
        logger.info("Removed follower {actor}", { actor: undo.actorId.href });
      }
    })
    .on(Create, async (ctx, create) => {
      logger.info(
        "Received Create: actor={actor}, object={object}",
        { actor: create.actorId?.href, object: create.objectId?.href },
      );
      logActivity("Create", create);
      const object = await create.getObject(ctx);
      if (object instanceof Note) {
        logger.info("  Note content: {content}", {
          content: object.content?.toString(),
        });
      }
    })
    .on(Accept, (_ctx, accept) => {
      logger.info(
        "Received Accept: actor={actor}, object={object}",
        { actor: accept.actorId?.href, object: accept.objectId?.href },
      );
      logActivity("Accept", accept);
    })
    .onError((_ctx, error) => {
      logger.error("Inbox error: {error}", { error });
    });

  fedi
    .setFollowersDispatcher("/users/{identifier}/followers", (_ctx, _id) => {
      const items = Array.from(followersStore.values()).map((f) => ({
        id: f.id,
        inboxId: f.inboxId,
        endpoints: null,
      }));
      return { items };
    });

  return fedi;
}

function logActivity(type: string, activity: Activity) {
  activityLog.push({
    timestamp: new Date().toISOString(),
    type,
    actorId: activity.actorId?.href ?? null,
    id: activity.id?.href ?? null,
    raw: {},
  });
  emitChange("log");
}
