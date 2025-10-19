import {
  type Context,
  createFederation,
  exportJwk,
  type Federation,
  generateCryptoKeyPair,
  importJwk,
  type KvStore,
  type MessageQueue,
} from "@fedify/fedify";
import {
  Accept,
  type Actor,
  Announce,
  Application,
  Create,
  Delete,
  Follow,
  isActor,
  Move,
  Object,
  PUBLIC_COLLECTION,
  Reject,
  Service,
  Undo,
  Update,
} from "@fedify/fedify/vocab";
import type {
  AuthenticatedDocumentLoaderFactory,
  DocumentLoaderFactory,
} from "@fedify/vocab-runtime";

const RELAY_SERVER_ACTOR = "relay";

/**
 * Handler for subscription requests (Follow/Undo activities).
 */
export type SubscriptionRequestHandler = (
  ctx: Context<void>,
  clientActor: Actor,
) => Promise<boolean>;

/**
 * Configuration options for the ActivityPub relay.
 */
export interface RelayOptions {
  kv: KvStore;
  domain?: string;
  documentLoaderFactory?: DocumentLoaderFactory;
  authenticatedDocumentLoaderFactory?: AuthenticatedDocumentLoaderFactory;
  federation?: Federation<void>;
  queue?: MessageQueue;
}

/**
 * Base interface for ActivityPub relay implementations.
 */
export interface Relay {
  readonly domain: string;

  fetch(request: Request): Promise<Response>;
  setSubscriptionHandler(handler: SubscriptionRequestHandler): this;
}

/**
 * A Mastodon-compatible ActivityPub relay implementation.
 * This relay follows Mastodon's relay protocol for maximum compatibility
 * with Mastodon instances.
 *
 * @since 2.0.0
 */
export class MastodonRelay implements Relay {
  #federation: Federation<void>;
  #options: RelayOptions;
  #subscriptionHandler?: SubscriptionRequestHandler;

  constructor(options: RelayOptions) {
    this.#options = options;
    this.#federation = options.federation ?? createFederation<void>({
      kv: options.kv,
      queue: options.queue,
      documentLoaderFactory: options.documentLoaderFactory,
      authenticatedDocumentLoaderFactory:
        options.authenticatedDocumentLoaderFactory,
    });

    this.#federation.setActorDispatcher(
      "/users/{identifier}",
      async (ctx, identifier) => {
        if (identifier !== RELAY_SERVER_ACTOR) return null;
        const keys = await ctx.getActorKeyPairs(identifier);
        return new Service({
          id: ctx.getActorUri(identifier),
          preferredUsername: identifier,
          name: "ActivityPub Relay",
          summary: "Mastodon-compatible ActivityPub relay server",
          inbox: ctx.getInboxUri(), // This should be sharedInboxUri
          followers: ctx.getFollowersUri(identifier),
          url: ctx.getActorUri(identifier),
          publicKey: keys[0].cryptographicKey,
          assertionMethods: keys.map((k) => k.multikey),
        });
      },
    )
      .setKeyPairsDispatcher(
        async (_ctx, identifier) => {
          if (identifier !== RELAY_SERVER_ACTOR) return [];

          const rsaPairJson = await options.kv.get<
            { privateKey: JsonWebKey; publicKey: JsonWebKey }
          >(["keypair", "rsa", identifier]);
          const ed25519PairJson = await options.kv.get<
            { privateKey: JsonWebKey; publicKey: JsonWebKey }
          >(["keypair", "ed25519", identifier]);
          if (rsaPairJson == null || ed25519PairJson == null) {
            const rsaPair = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
            const ed25519Pair = await generateCryptoKeyPair("Ed25519");
            await options.kv.set(["keypair", "rsa", identifier], {
              privateKey: await exportJwk(rsaPair.privateKey),
              publicKey: await exportJwk(rsaPair.publicKey),
            });
            await options.kv.set(["keypair", "ed25519", identifier], {
              privateKey: await exportJwk(ed25519Pair.privateKey),
              publicKey: await exportJwk(ed25519Pair.publicKey),
            });

            return [rsaPair, ed25519Pair];
          }

          const rsaPair: CryptoKeyPair = {
            privateKey: await importJwk(rsaPairJson.privateKey, "private"),
            publicKey: await importJwk(rsaPairJson.publicKey, "public"),
          };
          const ed25519Pair: CryptoKeyPair = {
            privateKey: await importJwk(ed25519PairJson.privateKey, "private"),
            publicKey: await importJwk(ed25519PairJson.publicKey, "public"),
          };
          return [rsaPair, ed25519Pair];
        },
      );

    this.#federation.setFollowersDispatcher(
      "/users/{identifier}/followers",
      async (_ctx, identifier) => {
        if (identifier !== RELAY_SERVER_ACTOR) return null;

        const activityIds = await options.kv.get<string[]>(["followers"]) ??
          [];

        const actors: Actor[] = [];
        for (const activityId of activityIds) {
          const actorJson = await options.kv.get(["follower", activityId]);

          const actor = await Object.fromJsonLd(actorJson);
          if (!isActor(actor)) continue;

          actors.push(actor);
        }
        return { items: actors };
      },
    );

    this.#federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(Follow, async (ctx, follow) => {
        if (follow.id == null || follow.objectId == null) return;
        const parsed = ctx.parseUri(follow.objectId);
        const isPublicFollow = follow.objectId.href ===
          "https://www.w3.org/ns/activitystreams#Public";
        if (!isPublicFollow && parsed?.type !== "actor") return;

        const relayActorUri = ctx.getActorUri(RELAY_SERVER_ACTOR);
        const recipient = await follow.getActor(ctx);
        if (
          recipient == null || recipient.id == null ||
          recipient.preferredUsername == null ||
          recipient.inboxId == null
        ) return;
        let approved = false;

        if (this.#subscriptionHandler) {
          approved = await this.#subscriptionHandler(
            ctx,
            recipient,
          );
        }

        if (approved) {
          const followers = await options.kv.get<string[]>(["followers"]) ?? [];
          followers.push(follow.id.href);
          await options.kv.set(["followers"], followers);

          await options.kv.set(
            ["follower", follow.id.href],
            await recipient.toJsonLd(),
          );

          await ctx.sendActivity(
            { identifier: RELAY_SERVER_ACTOR },
            recipient,
            new Accept({
              id: new URL(`#accepts`, relayActorUri),
              actor: relayActorUri,
              object: follow,
            }),
          );
        } else {
          await ctx.sendActivity(
            { identifier: RELAY_SERVER_ACTOR },
            recipient,
            new Reject({
              id: new URL(`#rejects`, relayActorUri),
              actor: relayActorUri,
              object: follow,
            }),
          );
        }
      })
      .on(Undo, async (ctx, undo) => {
        const activity = await undo.getObject(ctx);
        if (activity instanceof Follow) {
          if (
            activity.id == null ||
            activity.actorId == null
          ) return;
          const activityId = activity.id.href;
          const followers = await options.kv.get<string[]>(["followers"]) ??
            [];
          const updatedFollowers = followers.filter((id) => id !== activityId);
          await options.kv.set(["followers"], updatedFollowers);
          options.kv.delete(["follower", activityId]);
        } else {
          console.warn(
            "Unsupported object type ({type}) for Undo activity: {object}",
            { type: activity?.constructor.name, object: activity },
          );
        }
      })
      .on(Create, async (ctx, create) => {
        const sender = await create.getActor(ctx);
        // Exclude the sender's origin to prevent forwarding back to them
        const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

        await ctx.forwardActivity(
          { identifier: RELAY_SERVER_ACTOR },
          "followers",
          {
            skipIfUnsigned: true,
            excludeBaseUris,
            preferSharedInbox: true,
          },
        );
      })
      .on(Delete, async (ctx, deleteActivity) => {
        const sender = await deleteActivity.getActor(ctx);
        // Exclude the sender's origin to prevent forwarding back to them
        const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

        await ctx.forwardActivity(
          { identifier: RELAY_SERVER_ACTOR },
          "followers",
          {
            skipIfUnsigned: true,
            excludeBaseUris,
            preferSharedInbox: true,
          },
        );
      })
      .on(Move, async (ctx, deleteActivity) => {
        const sender = await deleteActivity.getActor(ctx);
        // Exclude the sender's origin to prevent forwarding back to them
        const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

        await ctx.forwardActivity(
          { identifier: RELAY_SERVER_ACTOR },
          "followers",
          {
            skipIfUnsigned: true,
            excludeBaseUris,
            preferSharedInbox: true,
          },
        );
      })
      .on(Update, async (ctx, deleteActivity) => {
        const sender = await deleteActivity.getActor(ctx);
        // Exclude the sender's origin to prevent forwarding back to them
        const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

        await ctx.forwardActivity(
          { identifier: RELAY_SERVER_ACTOR },
          "followers",
          {
            skipIfUnsigned: true,
            excludeBaseUris,
            preferSharedInbox: true,
          },
        );
      });
  }

  get domain(): string {
    return this.#options.domain || "localhost";
  }

  fetch(request: Request): Promise<Response> {
    return this.#federation.fetch(request, { contextData: undefined });
  }

  setSubscriptionHandler(handler: SubscriptionRequestHandler): this {
    this.#subscriptionHandler = handler;
    return this;
  }
}

/**
 * A LitePub-compatible ActivityPub relay implementation.
 * This relay follows LitePub's relay protocol and extensions for
 * enhanced federation capabilities.
 *
 * @since 2.0.0
 */
export class LitePubRelay implements Relay {
  #federation: Federation<void>;
  #options: RelayOptions;
  #subscriptionHandler?: SubscriptionRequestHandler;

  constructor(options: RelayOptions) {
    this.#options = options;
    this.#federation = options.federation ?? createFederation<void>({
      kv: options.kv,
      queue: options.queue,
      documentLoaderFactory: options.documentLoaderFactory,
      authenticatedDocumentLoaderFactory:
        options.authenticatedDocumentLoaderFactory,
    });

    this.#federation.setActorDispatcher(
      "/users/{identifier}",
      async (ctx, identifier) => {
        if (identifier !== RELAY_SERVER_ACTOR) return null;
        const keys = await ctx.getActorKeyPairs(identifier);
        return new Application({
          id: ctx.getActorUri(identifier),
          preferredUsername: identifier,
          name: "ActivityPub Relay",
          summary: "LitePub-compatible ActivityPub relay server",
          inbox: ctx.getInboxUri(), // This should be sharedInboxUri
          followers: ctx.getFollowersUri(identifier),
          url: ctx.getActorUri(identifier),
          publicKey: keys[0].cryptographicKey,
          assertionMethods: keys.map((k) => k.multikey),
        });
      },
    )
      .setKeyPairsDispatcher(
        async (_ctx, identifier) => {
          if (identifier !== RELAY_SERVER_ACTOR) return [];

          const rsaPairJson = await options.kv.get<
            { privateKey: JsonWebKey; publicKey: JsonWebKey }
          >(["keypair", "rsa", identifier]);
          const ed25519PairJson = await options.kv.get<
            { privateKey: JsonWebKey; publicKey: JsonWebKey }
          >(["keypair", "ed25519", identifier]);
          if (rsaPairJson == null || ed25519PairJson == null) {
            const rsaPair = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
            const ed25519Pair = await generateCryptoKeyPair("Ed25519");
            await options.kv.set(["keypair", "rsa", identifier], {
              privateKey: await exportJwk(rsaPair.privateKey),
              publicKey: await exportJwk(rsaPair.publicKey),
            });
            await options.kv.set(["keypair", "ed25519", identifier], {
              privateKey: await exportJwk(ed25519Pair.privateKey),
              publicKey: await exportJwk(ed25519Pair.publicKey),
            });

            return [rsaPair, ed25519Pair];
          }

          const rsaPair: CryptoKeyPair = {
            privateKey: await importJwk(rsaPairJson.privateKey, "private"),
            publicKey: await importJwk(rsaPairJson.publicKey, "public"),
          };
          const ed25519Pair: CryptoKeyPair = {
            privateKey: await importJwk(ed25519PairJson.privateKey, "private"),
            publicKey: await importJwk(ed25519PairJson.publicKey, "public"),
          };
          return [rsaPair, ed25519Pair];
        },
      );

    this.#federation.setFollowersDispatcher(
      "/users/{identifier}/followers",
      async (_ctx, identifier) => {
        if (identifier !== RELAY_SERVER_ACTOR) return null;

        const activityIds = await options.kv.get<string[]>(["followers"]) ??
          [];

        const actors: Actor[] = [];
        for (const activityId of activityIds) {
          const actorJson = await options.kv.get(["follower", activityId]);

          const actor = await Object.fromJsonLd(actorJson);
          if (!isActor(actor)) continue;

          actors.push(actor);
        }
        return { items: actors };
      },
    );

    this.#federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(Follow, async (ctx, follow) => {
        if (follow.id == null || follow.objectId == null) return;
        const parsed = ctx.parseUri(follow.objectId);
        const isPublicFollow = follow.objectId.href ===
          "https://www.w3.org/ns/activitystreams#Public";
        if (!isPublicFollow && parsed?.type !== "actor") return;

        const relayActorUri = ctx.getActorUri(RELAY_SERVER_ACTOR);
        const recipient = await follow.getActor(ctx);
        if (
          recipient == null || recipient.id == null ||
          recipient.preferredUsername == null ||
          recipient.inboxId == null
        ) return;
        let approved = false;

        if (this.#subscriptionHandler) {
          approved = await this.#subscriptionHandler(
            ctx,
            recipient,
          );
        }

        if (approved) {
          const followers = await options.kv.get<string[]>(["followers"]) ?? [];
          followers.push(follow.id.href);
          await options.kv.set(["followers"], followers);

          await options.kv.set(
            ["follower", follow.id.href],
            await recipient.toJsonLd(),
          );

          await ctx.sendActivity(
            { identifier: RELAY_SERVER_ACTOR },
            recipient,
            new Accept({
              id: new URL(`#accepts`, relayActorUri),
              actor: relayActorUri,
              object: follow,
            }),
          );
        } else {
          await ctx.sendActivity(
            { identifier: RELAY_SERVER_ACTOR },
            recipient,
            new Reject({
              id: new URL(`#rejects`, relayActorUri),
              actor: relayActorUri,
              object: follow,
            }),
          );
        }
      })
      .on(Undo, async (ctx, undo) => {
        const activity = await undo.getObject(ctx);
        if (activity instanceof Follow) {
          if (
            activity.id == null ||
            activity.actorId == null
          ) return;
          const activityId = activity.id.href;
          const followers = await options.kv.get<string[]>(["followers"]) ??
            [];
          const updatedFollowers = followers.filter((id) => id !== activityId);
          await options.kv.set(["followers"], updatedFollowers);
          options.kv.delete(["follower", activityId]);
        } else {
          console.warn(
            "Unsupported object type ({type}) for Undo activity: {object}",
            { type: activity?.constructor.name, object: activity },
          );
        }
      })
      .on(Create, async (ctx, create) => {
        const sender = await create.getActor(ctx);
        const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

        const announce = new Announce({
          id: new URL(`/announce#${crypto.randomUUID()}`, ctx.origin),
          actor: ctx.getActorUri(RELAY_SERVER_ACTOR),
          object: create.objectId,
          to: PUBLIC_COLLECTION,
        });

        await ctx.sendActivity(
          { identifier: RELAY_SERVER_ACTOR },
          "followers",
          announce,
          {
            excludeBaseUris,
            preferSharedInbox: true,
          },
        );
      })
      .on(Update, async (ctx, update) => {
        const sender = await update.getActor(ctx);
        const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

        const announce = new Announce({
          id: new URL(`/announce#${crypto.randomUUID()}`, ctx.origin),
          actor: ctx.getActorUri(RELAY_SERVER_ACTOR),
          object: update.objectId,
          to: PUBLIC_COLLECTION,
        });

        await ctx.sendActivity(
          { identifier: RELAY_SERVER_ACTOR },
          "followers",
          announce,
          {
            excludeBaseUris,
            preferSharedInbox: true,
          },
        );
      })
      .on(Move, async (ctx, move) => {
        const sender = await move.getActor(ctx);
        const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

        const announce = new Announce({
          id: new URL(`/announce#${crypto.randomUUID()}`, ctx.origin),
          actor: ctx.getActorUri(RELAY_SERVER_ACTOR),
          object: move.objectId,
          to: PUBLIC_COLLECTION,
        });

        await ctx.sendActivity(
          { identifier: RELAY_SERVER_ACTOR },
          "followers",
          announce,
          {
            excludeBaseUris,
            preferSharedInbox: true,
          },
        );
      })
      .on(Delete, async (ctx, deleteActivity) => {
        const sender = await deleteActivity.getActor(ctx);
        const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

        const announce = new Announce({
          id: new URL(`/announce#${crypto.randomUUID()}`, ctx.origin),
          actor: ctx.getActorUri(RELAY_SERVER_ACTOR),
          object: deleteActivity.objectId,
          to: PUBLIC_COLLECTION,
        });

        await ctx.sendActivity(
          { identifier: RELAY_SERVER_ACTOR },
          "followers",
          announce,
          {
            excludeBaseUris,
            preferSharedInbox: true,
          },
        );
      });
  }

  get domain(): string {
    return this.#options.domain || "localhost";
  }

  fetch(request: Request): Promise<Response> {
    return this.#federation.fetch(request, { contextData: undefined });
  }

  setSubscriptionHandler(handler: SubscriptionRequestHandler): this {
    this.#subscriptionHandler = handler;
    return this;
  }
}
