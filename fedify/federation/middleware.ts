import { getLogger, withContext } from "@logtape/logtape";
import {
  context,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
  type Tracer,
  type TracerProvider,
} from "@opentelemetry/api";
import {
  ATTR_HTTP_REQUEST_HEADER,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_HEADER,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_URL_FULL,
} from "@opentelemetry/semantic-conventions";
import { getDefaultActivityTransformers } from "../compat/transformers.ts";
import type { ActivityTransformer } from "../compat/types.ts";
import metadata from "../deno.json" with { type: "json" };
import { getNodeInfo, type GetNodeInfoOptions } from "../nodeinfo/client.ts";
import { handleNodeInfo, handleNodeInfoJrd } from "../nodeinfo/handler.ts";
import type { JsonValue, NodeInfo } from "../nodeinfo/types.ts";
import { getAuthenticatedDocumentLoader } from "../runtime/authdocloader.ts";
import {
  type AuthenticatedDocumentLoaderFactory,
  type DocumentLoader,
  type DocumentLoaderFactory,
  type DocumentLoaderFactoryOptions,
  getDocumentLoader,
  type GetUserAgentOptions,
  kvCache,
} from "../runtime/docloader.ts";
import {
  type HttpMessageSignaturesSpec,
  type HttpMessageSignaturesSpecDeterminer,
  verifyRequest,
} from "../sig/http.ts";
import { exportJwk, importJwk, validateCryptoKey } from "../sig/key.ts";
import { hasSignature, signJsonLd } from "../sig/ld.ts";
import { getKeyOwner, type GetKeyOwnerOptions } from "../sig/owner.ts";
import { signObject, verifyObject } from "../sig/proof.ts";
import type { Actor, Recipient } from "../vocab/actor.ts";
import {
  lookupObject,
  type LookupObjectOptions,
  traverseCollection,
  type TraverseCollectionOptions,
} from "../vocab/lookup.ts";
import { getTypeId } from "../vocab/type.ts";
import {
  Activity,
  type Collection,
  CryptographicKey,
  type Link,
  Multikey,
  type Object,
} from "../vocab/vocab.ts";
import { handleWebFinger } from "../webfinger/handler.ts";
import type { ResourceDescriptor } from "../webfinger/jrd.ts";
import {
  lookupWebFinger,
  type LookupWebFingerOptions,
} from "../webfinger/lookup.ts";
import { FederationBuilderImpl } from "./builder.ts";
import type { OutboxErrorHandler } from "./callback.ts";
import { buildCollectionSynchronizationHeader } from "./collection.ts";
import type {
  ActorKeyPair,
  Context,
  ForwardActivityOptions,
  GetSignedKeyOptions,
  InboxContext,
  ParseUriResult,
  RequestContext,
  RouteActivityOptions,
  SendActivityOptionsForCollection,
} from "./context.ts";
import type {
  Federation,
  FederationFetchOptions,
  FederationObserver,
  FederationOptions,
  FederationStartQueueOptions,
} from "./federation.ts";
import {
  handleActor,
  handleCollection,
  handleInbox,
  handleObject,
} from "./handler.ts";
import { routeActivity } from "./inbox.ts";
import { KvKeyCache } from "./keycache.ts";
import type { KvKey, KvStore } from "./kv.ts";
import type { MessageQueue } from "./mq.ts";
import type {
  FanoutMessage,
  InboxMessage,
  Message,
  OutboxMessage,
  SenderKeyJwkPair,
} from "./queue.ts";
import { createExponentialBackoffPolicy, type RetryPolicy } from "./retry.ts";
import { RouterError } from "./router.ts";
import { extractInboxes, sendActivity, type SenderKeyPair } from "./send.ts";

/**
 * Options for {@link createFederation} function.
 * @typeParam TContextData The type of the context data.
 * @since 0.10.0
 * @deprecated Use {@link FederationOptions} instead.
 */
export interface CreateFederationOptions<TContextData>
  extends FederationOptions<TContextData> {
}

/**
 * Configures the task queues for sending and receiving activities.
 * @since 1.3.0
 */
export interface FederationQueueOptions {
  /**
   * The message queue for incoming activities.  If not provided, incoming
   * activities will not be queued and will be processed immediately.
   */
  inbox?: MessageQueue;

  /**
   * The message queue for outgoing activities.  If not provided, outgoing
   * activities will not be queued and will be sent immediately.
   */
  outbox?: MessageQueue;

  /**
   * The message queue for fanning out outgoing activities.  If not provided,
   * outgoing activities will not be fanned out in the background, but will be
   * fanned out immediately, which causes slow response times on
   * {@link Context.sendActivity} calls.
   */
  fanout?: MessageQueue;
}

/**
 * Prefixes for namespacing keys in the Deno KV store.
 */
export interface FederationKvPrefixes {
  /**
   * The key prefix used for storing whether activities have already been
   * processed or not.
   * @default `["_fedify", "activityIdempotence"]`
   */
  activityIdempotence: KvKey;

  /**
   * The key prefix used for storing remote JSON-LD documents.
   * @default `["_fedify", "remoteDocument"]`
   */
  remoteDocument: KvKey;

  /**
   * The key prefix used for caching public keys.
   * @default `["_fedify", "publicKey"]`
   * @since 0.12.0
   */
  publicKey: KvKey;

  /**
   * The key prefix used for caching HTTP Message Signatures specs.
   * The cached spec is used to reduce the number of requests to make signed
   * requests ("double-knocking" technique).
   * @default `["_fedify", "httpMessageSignaturesSpec"]`
   * @since 1.6.0
   */
  httpMessageSignaturesSpec: KvKey;
}

/**
 * Options for {@link CreateFederationOptions.origin} when it is not a string.
 * @since 1.5.0
 */
export interface FederationOrigin {
  /**
   * The canonical hostname for fediverse handles (which are looked up through
   * WebFinger).  This is used for WebFinger lookups.  It has to be a valid
   * hostname, e.g., `"example.com"`.
   */
  handleHost: string;

  /**
   * The canonical origin for web URLs.  This is used for constructing absolute
   * URLs.  It has to start with either `"http://"` or `"https://"`, and must
   * not contain a path or query string, e.g., `"https://example.com"`.
   */
  webOrigin: string;
}

/**
 * Create a new {@link Federation} instance.
 * @param parameters Parameters for initializing the instance.
 * @returns A new {@link Federation} instance.
 * @since 0.10.0
 */
export function createFederation<TContextData>(
  options: CreateFederationOptions<TContextData>,
): Federation<TContextData> {
  return new FederationImpl<TContextData>(options);
}

export class FederationImpl<TContextData>
  extends FederationBuilderImpl<TContextData>
  implements Federation<TContextData> {
  kv: KvStore;
  kvPrefixes: FederationKvPrefixes;
  inboxQueue?: MessageQueue;
  outboxQueue?: MessageQueue;
  fanoutQueue?: MessageQueue;
  inboxQueueStarted: boolean;
  outboxQueueStarted: boolean;
  fanoutQueueStarted: boolean;
  manuallyStartQueue: boolean;
  origin?: FederationOrigin;
  documentLoaderFactory: DocumentLoaderFactory;
  contextLoaderFactory: DocumentLoaderFactory;
  authenticatedDocumentLoaderFactory: AuthenticatedDocumentLoaderFactory;
  allowPrivateAddress: boolean;
  userAgent?: GetUserAgentOptions | string;
  onOutboxError?: OutboxErrorHandler;
  signatureTimeWindow: Temporal.Duration | Temporal.DurationLike | false;
  skipSignatureVerification: boolean;
  outboxRetryPolicy: RetryPolicy;
  inboxRetryPolicy: RetryPolicy;
  activityTransformers: readonly ActivityTransformer<TContextData>[];
  tracerProvider: TracerProvider;
  firstKnock?: HttpMessageSignaturesSpec;
  observers: FederationObserver<TContextData>[];

  constructor(options: FederationOptions<TContextData>) {
    super();
    const logger = getLogger(["fedify", "federation"]);
    this.kv = options.kv;
    this.kvPrefixes = {
      ...({
        activityIdempotence: ["_fedify", "activityIdempotence"],
        remoteDocument: ["_fedify", "remoteDocument"],
        publicKey: ["_fedify", "publicKey"],
        httpMessageSignaturesSpec: ["_fedify", "httpMessageSignaturesSpec"],
      } satisfies FederationKvPrefixes),
      ...(options.kvPrefixes ?? {}),
    };
    if (options.queue == null) {
      this.inboxQueue = undefined;
      this.outboxQueue = undefined;
      this.fanoutQueue = undefined;
    } else if ("enqueue" in options.queue && "listen" in options.queue) {
      this.inboxQueue = options.queue;
      this.outboxQueue = options.queue;
      this.fanoutQueue = options.queue;
    } else {
      this.inboxQueue = options.queue.inbox;
      this.outboxQueue = options.queue.outbox;
      this.fanoutQueue = options.queue.fanout;
    }
    this.inboxQueueStarted = false;
    this.outboxQueueStarted = false;
    this.fanoutQueueStarted = false;
    this.manuallyStartQueue = options.manuallyStartQueue ?? false;
    if (options.origin != null) {
      if (typeof options.origin === "string") {
        if (
          !URL.canParse(options.origin) || !options.origin.match(/^https?:\/\//)
        ) {
          throw new TypeError(
            `Invalid origin: ${JSON.stringify(options.origin)}`,
          );
        }
        const origin = new URL(options.origin);
        if (
          !origin.pathname.match(/^\/*$/) || origin.search !== "" ||
          origin.hash !== ""
        ) {
          throw new TypeError(
            `Invalid origin: ${JSON.stringify(options.origin)}`,
          );
        }
        this.origin = { handleHost: origin.host, webOrigin: origin.origin };
      } else {
        const { handleHost, webOrigin } = options.origin;
        if (
          !URL.canParse(`https://${handleHost}/`) || handleHost.includes("/")
        ) {
          throw new TypeError(
            `Invalid origin.handleHost: ${JSON.stringify(handleHost)}`,
          );
        }
        if (!URL.canParse(webOrigin) || !webOrigin.match(/^https?:\/\//)) {
          throw new TypeError(
            `Invalid origin.webOrigin: ${JSON.stringify(webOrigin)}`,
          );
        }
        const webOriginUrl = new URL(webOrigin);
        if (
          !webOriginUrl.pathname.match(/^\/*$/) || webOriginUrl.search !== "" ||
          webOriginUrl.hash !== ""
        ) {
          throw new TypeError(
            `Invalid origin.webOrigin: ${JSON.stringify(webOrigin)}`,
          );
        }
        this.origin = {
          handleHost: new URL(`https://${handleHost}/`).host,
          webOrigin: webOriginUrl.origin,
        };
      }
    }
    this.router.trailingSlashInsensitive = options.trailingSlashInsensitive ??
      false;
    this._initializeRouter();
    if (options.allowPrivateAddress || options.userAgent != null) {
      if (options.documentLoader != null) {
        throw new TypeError(
          "Cannot set documentLoader with allowPrivateAddress or " +
            "userAgent options.",
        );
      } else if (options.contextLoader != null) {
        throw new TypeError(
          "Cannot set contextLoader with allowPrivateAddress or " +
            "userAgent options.",
        );
      } else if (options.authenticatedDocumentLoaderFactory != null) {
        throw new TypeError(
          "Cannot set authenticatedDocumentLoaderFactory with " +
            "allowPrivateAddress or userAgent options.",
        );
      }
    }
    const { allowPrivateAddress, userAgent } = options;
    this.allowPrivateAddress = allowPrivateAddress ?? false;
    if (options.documentLoader != null) {
      if (options.documentLoaderFactory != null) {
        throw new TypeError(
          "Cannot set both documentLoader and documentLoaderFactory options " +
            "at a time; use documentLoaderFactory only.",
        );
      }
      this.documentLoaderFactory = () => options.documentLoader!;
      logger.warn(
        "The documentLoader option is deprecated; use documentLoaderFactory " +
          "option instead.",
      );
    } else {
      this.documentLoaderFactory = options.documentLoaderFactory ??
        ((opts) => {
          return kvCache({
            loader: getDocumentLoader({
              allowPrivateAddress: opts?.allowPrivateAddress ??
                allowPrivateAddress,
              userAgent: opts?.userAgent ?? userAgent,
            }),
            kv: options.kv,
            prefix: this.kvPrefixes.remoteDocument,
          });
        });
    }
    if (options.contextLoader != null) {
      if (options.contextLoaderFactory != null) {
        throw new TypeError(
          "Cannot set both contextLoader and contextLoaderFactory options " +
            "at a time; use contextLoaderFactory only.",
        );
      }
      this.contextLoaderFactory = () => options.contextLoader!;
      logger.warn(
        "The contextLoader option is deprecated; use contextLoaderFactory " +
          "option instead.",
      );
    } else {
      this.contextLoaderFactory = options.contextLoaderFactory ??
        this.documentLoaderFactory;
    }
    this.authenticatedDocumentLoaderFactory =
      options.authenticatedDocumentLoaderFactory ??
        ((identity) =>
          getAuthenticatedDocumentLoader(identity, {
            allowPrivateAddress,
            userAgent,
            specDeterminer: new KvSpecDeterminer(
              this.kv,
              this.kvPrefixes.httpMessageSignaturesSpec,
              options.firstKnock,
            ),
            tracerProvider: this.tracerProvider,
          }));
    this.userAgent = userAgent;
    this.onOutboxError = options.onOutboxError;
    this.signatureTimeWindow = options.signatureTimeWindow ?? { hours: 1 };
    this.skipSignatureVerification = options.skipSignatureVerification ?? false;
    this.outboxRetryPolicy = options.outboxRetryPolicy ??
      createExponentialBackoffPolicy();
    this.inboxRetryPolicy = options.inboxRetryPolicy ??
      createExponentialBackoffPolicy();
    this.activityTransformers = options.activityTransformers ??
      getDefaultActivityTransformers<TContextData>();
    this.tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
    this.firstKnock = options.firstKnock;
    this.observers = options.observers ?? [];
  }

  _initializeRouter() {
    this.router.add("/.well-known/webfinger", "webfinger");
    this.router.add("/.well-known/nodeinfo", "nodeInfoJrd");
  }

  private async notifyObservers(
    method: 'onInboundActivity' | 'onOutboundActivity',
    context: Context<TContextData>,
    activity: Activity
  ): Promise<void> {
    const logger = getLogger(["fedify", "federation", "observer"]);
    for (const observer of this.observers) {
      if (observer[method]) {
        try {
          await observer[method]!(context, activity);
        } catch (error) {
          // Log but don't fail the federation process
          logger.error(`Observer error in ${method}: {error}`, { error });
        }
      }
    }
  }

  override _getTracer() {
    return this.tracerProvider.getTracer(metadata.name, metadata.version);
  }

  async _startQueueInternal(
    ctxData: TContextData,
    signal?: AbortSignal,
    queue?: keyof FederationQueueOptions,
  ): Promise<void> {
    if (this.inboxQueue == null && this.outboxQueue == null) return;
    const logger = getLogger(["fedify", "federation", "queue"]);
    const promises: Promise<void>[] = [];
    if (
      this.inboxQueue != null && (queue == null || queue === "inbox") &&
      !this.inboxQueueStarted
    ) {
      logger.debug("Starting an inbox task worker.");
      this.inboxQueueStarted = true;
      promises.push(
        this.inboxQueue.listen(
          (msg) => this.processQueuedTask(ctxData, msg),
          { signal },
        ),
      );
    }
    if (
      this.outboxQueue != null &&
      this.outboxQueue !== this.inboxQueue &&
      (queue == null || queue === "outbox") &&
      !this.outboxQueueStarted
    ) {
      logger.debug("Starting an outbox task worker.");
      this.outboxQueueStarted = true;
      promises.push(
        this.outboxQueue.listen(
          (msg) => this.processQueuedTask(ctxData, msg),
          { signal },
        ),
      );
    }
    if (
      this.fanoutQueue != null &&
      this.fanoutQueue !== this.inboxQueue &&
      this.fanoutQueue !== this.outboxQueue &&
      (queue == null || queue === "fanout") &&
      !this.fanoutQueueStarted
    ) {
      logger.debug("Starting a fanout task worker.");
      this.fanoutQueueStarted = true;
      promises.push(
        this.fanoutQueue.listen(
          (msg) => this.processQueuedTask(ctxData, msg),
          { signal },
        ),
      );
    }
    await Promise.all(promises);
  }

  processQueuedTask(
    contextData: TContextData,
    message: Message,
  ): Promise<void> {
    const tracer = this._getTracer();
    const extractedContext = propagation.extract(
      context.active(),
      message.traceContext,
    );
    return withContext({ messageId: message.id }, async () => {
      if (message.type === "fanout") {
        await tracer.startActiveSpan(
          "activitypub.fanout",
          {
            kind: SpanKind.CONSUMER,
            attributes: {
              "activitypub.activity.type": message.activityType,
            },
          },
          extractedContext,
          async (span) => {
            if (message.activityId != null) {
              span.setAttribute("activitypub.activity.id", message.activityId);
            }
            try {
              await this.#listenFanoutMessage(contextData, message);
            } catch (e) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: String(e),
              });
              throw e;
            } finally {
              span.end();
            }
          },
        );
      } else if (message.type === "outbox") {
        await tracer.startActiveSpan(
          "activitypub.outbox",
          {
            kind: SpanKind.CONSUMER,
            attributes: {
              "activitypub.activity.type": message.activityType,
              "activitypub.activity.retries": message.attempt,
            },
          },
          extractedContext,
          async (span) => {
            if (message.activityId != null) {
              span.setAttribute("activitypub.activity.id", message.activityId);
            }
            try {
              await this.#listenOutboxMessage(contextData, message, span);
            } catch (e) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: String(e),
              });
              throw e;
            } finally {
              span.end();
            }
          },
        );
      } else if (message.type === "inbox") {
        await tracer.startActiveSpan(
          "activitypub.inbox",
          {
            kind: SpanKind.CONSUMER,
            attributes: {
              "activitypub.shared_inbox": message.identifier == null,
            },
          },
          extractedContext,
          async (span) => {
            try {
              await this.#listenInboxMessage(contextData, message, span);
            } catch (e) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: String(e),
              });
              throw e;
            } finally {
              span.end();
            }
          },
        );
      }
    });
  }

  async #listenFanoutMessage(
    data: TContextData,
    message: FanoutMessage,
  ): Promise<void> {
    const logger = getLogger(["fedify", "federation", "fanout"]);
    logger.debug(
      "Fanning out activity {activityId} to {inboxes} inbox(es)...",
      {
        activityId: message.activityId,
        inboxes: globalThis.Object.keys(message.inboxes).length,
      },
    );
    const keys: SenderKeyPair[] = await Promise.all(
      message.keys.map(async ({ keyId, privateKey }) => ({
        keyId: new URL(keyId),
        privateKey: await importJwk(privateKey, "private"),
      })),
    );
    const activity = await Activity.fromJsonLd(message.activity, {
      contextLoader: this.contextLoaderFactory({
        allowPrivateAddress: this.allowPrivateAddress,
        userAgent: this.userAgent,
      }),
      documentLoader: this.documentLoaderFactory({
        allowPrivateAddress: this.allowPrivateAddress,
        userAgent: this.userAgent,
      }),
      tracerProvider: this.tracerProvider,
    });
    const context = this.#createContext(
      new URL(message.baseUrl),
      data,
      {
        documentLoader: this.documentLoaderFactory({
          allowPrivateAddress: this.allowPrivateAddress,
          userAgent: this.userAgent,
        }),
      },
    );
    await this.sendActivity(keys, message.inboxes, activity, {
      collectionSync: message.collectionSync,
      context,
    });
  }

  async #listenOutboxMessage(
    _: TContextData,
    message: OutboxMessage,
    span: Span,
  ): Promise<void> {
    const logger = getLogger(["fedify", "federation", "outbox"]);
    const logData = {
      keyIds: message.keys.map((pair) => pair.keyId),
      inbox: message.inbox,
      activity: message.activity,
      activityId: message.activityId,
      attempt: message.attempt,
      headers: message.headers,
    };
    const keys: SenderKeyPair[] = [];
    let rsaKeyPair: SenderKeyPair | null = null;
    for (const { keyId, privateKey } of message.keys) {
      const pair: SenderKeyPair = {
        keyId: new URL(keyId),
        privateKey: await importJwk(privateKey, "private"),
      };
      if (
        rsaKeyPair == null &&
        pair.privateKey.algorithm.name === "RSASSA-PKCS1-v1_5"
      ) {
        rsaKeyPair = pair;
      }
      keys.push(pair);
    }
    try {
      await sendActivity({
        keys,
        activity: message.activity,
        activityId: message.activityId,
        activityType: message.activityType,
        inbox: new URL(message.inbox),
        sharedInbox: message.sharedInbox,
        headers: new Headers(message.headers),
        specDeterminer: new KvSpecDeterminer(
          this.kv,
          this.kvPrefixes.httpMessageSignaturesSpec,
          this.firstKnock,
        ),
        tracerProvider: this.tracerProvider,
      });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      const loaderOptions = this.#getLoaderOptions(message.baseUrl);
      const activity = await Activity.fromJsonLd(message.activity, {
        contextLoader: this.contextLoaderFactory(loaderOptions),
        documentLoader: rsaKeyPair == null
          ? this.documentLoaderFactory(loaderOptions)
          : this.authenticatedDocumentLoaderFactory(rsaKeyPair, loaderOptions),
        tracerProvider: this.tracerProvider,
      });
      try {
        this.onOutboxError?.(error as Error, activity);
      } catch (error) {
        logger.error(
          "An unexpected error occurred in onError handler:\n{error}",
          { ...logData, error },
        );
      }
      // Skip retry logic if the message queue backend handles retries automatically
      if (this.outboxQueue?.nativeRetrial) {
        logger.error(
          "Failed to send activity {activityId} to {inbox}; backend will handle retry:\n{error}",
          { ...logData, error },
        );
        throw error;
      }

      const delay = this.outboxRetryPolicy({
        elapsedTime: Temporal.Instant.from(message.started).until(
          Temporal.Now.instant(),
        ),
        attempts: message.attempt,
      });
      if (delay != null) {
        logger.error(
          "Failed to send activity {activityId} to {inbox} (attempt " +
            "#{attempt}); retry...:\n{error}",
          { ...logData, error },
        );
        await this.outboxQueue?.enqueue(
          {
            ...message,
            attempt: message.attempt + 1,
          } satisfies OutboxMessage,
          {
            delay: Temporal.Duration.compare(delay, { seconds: 0 }) < 0
              ? Temporal.Duration.from({ seconds: 0 })
              : delay,
          },
        );
      } else {
        logger.error(
          "Failed to send activity {activityId} to {inbox} after {attempt} " +
            "attempts; giving up:\n{error}",
          { ...logData, error },
        );
      }
      return;
    }
    logger.info(
      "Successfully sent activity {activityId} to {inbox}.",
      { ...logData },
    );
  }

  async #listenInboxMessage(
    ctxData: TContextData,
    message: InboxMessage,
    span: Span,
  ): Promise<void> {
    const logger = getLogger(["fedify", "federation", "inbox"]);
    const baseUrl = new URL(message.baseUrl);
    let context = this.#createContext(baseUrl, ctxData);
    if (message.identifier != null) {
      context = this.#createContext(baseUrl, ctxData, {
        documentLoader: await context.getDocumentLoader({
          identifier: message.identifier,
        }),
      });
    } else if (this.sharedInboxKeyDispatcher != null) {
      const identity = await this.sharedInboxKeyDispatcher(context);
      if (identity != null) {
        context = this.#createContext(baseUrl, ctxData, {
          documentLoader: "identifier" in identity || "username" in identity ||
              "handle" in identity
            ? await context.getDocumentLoader(identity)
            : context.getDocumentLoader(identity),
        });
      }
    }
    const activity = await Activity.fromJsonLd(message.activity, context);
    span.setAttribute("activitypub.activity.type", getTypeId(activity).href);
    if (activity.id != null) {
      span.setAttribute("activitypub.activity.id", activity.id.href);
    }
    const cacheKey = activity.id == null ? null : [
      ...this.kvPrefixes.activityIdempotence,
      context.origin,
      activity.id.href,
    ] satisfies KvKey;
    if (cacheKey != null) {
      const cached = await this.kv.get(cacheKey);
      if (cached === true) {
        logger.debug("Activity {activityId} has already been processed.", {
          activityId: activity.id?.href,
          activity: message.activity,
          recipient: message.identifier,
        });
        return;
      }
    }
    await this._getTracer().startActiveSpan(
      "activitypub.dispatch_inbox_listener",
      { kind: SpanKind.INTERNAL },
      async (span) => {
        const dispatched = this.inboxListeners?.dispatchWithClass(activity);
        if (dispatched == null) {
          logger.error(
            "Unsupported activity type:\n{activity}",
            {
              activityId: activity.id?.href,
              activity: message.activity,
              recipient: message.identifier,
              trial: message.attempt,
            },
          );
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `Unsupported activity type: ${getTypeId(activity).href}`,
          });
          span.end();
          return;
        }
        const { class: cls, listener } = dispatched;
        span.updateName(`activitypub.dispatch_inbox_listener ${cls.name}`);
        try {
          await listener(
            context.toInboxContext(
              message.identifier,
              message.activity,
              activity.id?.href,
              getTypeId(activity).href,
            ),
            activity,
          );
        } catch (error) {
          try {
            await this.inboxErrorHandler?.(context, error as Error);
          } catch (error) {
            logger.error(
              "An unexpected error occurred in inbox error handler:\n{error}",
              {
                error,
                trial: message.attempt,
                activityId: activity.id?.href,
                activity: message.activity,
                recipient: message.identifier,
              },
            );
          }
          // Skip retry logic if the message queue backend handles retries automatically
          if (this.inboxQueue?.nativeRetrial) {
            logger.error(
              "Failed to process the incoming activity {activityId}; backend will handle retry:\n{error}",
              {
                error,
                activityId: activity.id?.href,
                activity: message.activity,
                recipient: message.identifier,
              },
            );
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: String(error),
            });
            span.end();
            throw error;
          }

          const delay = this.inboxRetryPolicy({
            elapsedTime: Temporal.Instant.from(message.started).until(
              Temporal.Now.instant(),
            ),
            attempts: message.attempt,
          });
          if (delay != null) {
            logger.error(
              "Failed to process the incoming activity {activityId} (attempt " +
                "#{attempt}); retry...:\n{error}",
              {
                error,
                attempt: message.attempt,
                activityId: activity.id?.href,
                activity: message.activity,
                recipient: message.identifier,
              },
            );
            await this.inboxQueue?.enqueue(
              {
                ...message,
                attempt: message.attempt + 1,
              } satisfies InboxMessage,
              {
                delay: Temporal.Duration.compare(delay, { seconds: 0 }) < 0
                  ? Temporal.Duration.from({ seconds: 0 })
                  : delay,
              },
            );
          } else {
            logger.error(
              "Failed to process the incoming activity {activityId} after " +
                "{trial} attempts; giving up:\n{error}",
              {
                error,
                activityId: activity.id?.href,
                activity: message.activity,
                recipient: message.identifier,
              },
            );
          }
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(error),
          });
          span.end();
          return;
        }
        if (cacheKey != null) {
          await this.kv.set(cacheKey, true, {
            ttl: Temporal.Duration.from({ days: 1 }),
          });
        }
        logger.info(
          "Activity {activityId} has been processed.",
          {
            activityId: activity.id?.href,
            activity: message.activity,
            recipient: message.identifier,
          },
        );
        span.end();
      },
    );
  }

  startQueue(
    contextData: TContextData,
    options: FederationStartQueueOptions = {},
  ): Promise<void> {
    return this._startQueueInternal(contextData, options.signal, options.queue);
  }

  createContext(baseUrl: URL, contextData: TContextData): Context<TContextData>;
  createContext(
    request: Request,
    contextData: TContextData,
  ): RequestContext<TContextData>;
  createContext(
    urlOrRequest: Request | URL,
    contextData: TContextData,
  ): Context<TContextData> {
    return urlOrRequest instanceof Request
      ? this.#createContext(urlOrRequest, contextData)
      : this.#createContext(urlOrRequest, contextData);
  }

  #createContext(
    baseUrl: URL,
    contextData: TContextData,
    opts?: { documentLoader?: DocumentLoader },
  ): ContextImpl<TContextData>;

  #createContext(
    request: Request,
    contextData: TContextData,
    opts?: {
      documentLoader?: DocumentLoader;
      invokedFromActorDispatcher?: { identifier: string };
      invokedFromObjectDispatcher?: {
        // deno-lint-ignore no-explicit-any
        cls: (new (...args: any[]) => Object) & { typeId: URL };
        values: Record<string, string>;
      };
    },
  ): RequestContextImpl<TContextData>;

  #createContext(
    urlOrRequest: Request | URL,
    contextData: TContextData,
    opts: {
      documentLoader?: DocumentLoader;
      invokedFromActorDispatcher?: { identifier: string };
      invokedFromObjectDispatcher?: {
        // deno-lint-ignore no-explicit-any
        cls: (new (...args: any[]) => Object) & { typeId: URL };
        values: Record<string, string>;
      };
    } = {},
  ): ContextImpl<TContextData> | RequestContextImpl<TContextData> {
    const request = urlOrRequest instanceof Request ? urlOrRequest : null;
    const url = urlOrRequest instanceof URL
      ? new URL(urlOrRequest)
      : new URL(urlOrRequest.url);
    if (request == null) {
      url.pathname = "/";
      url.hash = "";
      url.search = "";
    }
    const loaderOptions = this.#getLoaderOptions(url.origin);
    const ctxOptions: ContextOptions<TContextData> = {
      url,
      federation: this,
      data: contextData,
      documentLoader: opts.documentLoader ??
        this.documentLoaderFactory(loaderOptions),
      contextLoader: this.contextLoaderFactory(loaderOptions),
    };
    if (request == null) return new ContextImpl(ctxOptions);
    return new RequestContextImpl({
      ...ctxOptions,
      request,
      invokedFromActorDispatcher: opts.invokedFromActorDispatcher,
      invokedFromObjectDispatcher: opts.invokedFromObjectDispatcher,
    });
  }

  #getLoaderOptions(origin: URL | string): DocumentLoaderFactoryOptions {
    origin = typeof origin === "string"
      ? new URL(origin).origin
      : origin.origin;
    return {
      allowPrivateAddress: this.allowPrivateAddress,
      userAgent: typeof this.userAgent === "string" ? this.userAgent : {
        url: origin,
        ...this.userAgent,
      },
    };
  }

  async sendActivity(
    keys: SenderKeyPair[],
    inboxes: Record<
      string,
      { actorIds: Iterable<string>; sharedInbox: boolean }
    >,
    activity: Activity,
    options: SendActivityInternalOptions<TContextData>,
  ): Promise<void> {
    const logger = getLogger(["fedify", "federation", "outbox"]);
    const { immediate, collectionSync, context: ctx } = options;
    
    // Notify observers about the outbound activity
    if (this.observers.length > 0) {
      await this.notifyObservers('onOutboundActivity', ctx, activity);
    }
    
    if (activity.id == null) {
      throw new TypeError("The activity to send must have an id.");
    }
    if (activity.actorId == null) {
      throw new TypeError(
        "The activity to send must have at least one actor property.",
      );
    } else if (keys.length < 1) {
      throw new TypeError("The keys must not be empty.");
    }
    const contextLoader = this.contextLoaderFactory(
      this.#getLoaderOptions(ctx.origin),
    );
    const activityId = activity.id.href;
    let proofCreated = false;
    let rsaKey: { keyId: URL; privateKey: CryptoKey } | null = null;
    for (const { keyId, privateKey } of keys) {
      validateCryptoKey(privateKey, "private");
      if (rsaKey == null && privateKey.algorithm.name === "RSASSA-PKCS1-v1_5") {
        rsaKey = { keyId, privateKey };
        continue;
      }
      if (privateKey.algorithm.name === "Ed25519") {
        activity = await signObject(activity, privateKey, keyId, {
          contextLoader,
          tracerProvider: this.tracerProvider,
        });
        proofCreated = true;
      }
    }
    let jsonLd = await activity.toJsonLd({
      format: "compact",
      contextLoader,
    });
    if (rsaKey == null) {
      logger.warn(
        "No supported key found to create a Linked Data signature for " +
          "the activity {activityId}.  The activity will be sent without " +
          "a Linked Data signature.  In order to create a Linked Data " +
          "signature, at least one RSASSA-PKCS1-v1_5 key must be provided.",
        {
          activityId,
          keys: keys.map((pair) => ({
            keyId: pair.keyId.href,
            privateKey: pair.privateKey,
          })),
        },
      );
    } else {
      jsonLd = await signJsonLd(jsonLd, rsaKey.privateKey, rsaKey.keyId, {
        contextLoader,
        tracerProvider: this.tracerProvider,
      });
    }
    if (!proofCreated) {
      logger.warn(
        "No supported key found to create a proof for the activity {activityId}.  " +
          "The activity will be sent without a proof.  " +
          "In order to create a proof, at least one Ed25519 key must be provided.",
        {
          activityId,
          keys: keys.map((pair) => ({
            keyId: pair.keyId.href,
            privateKey: pair.privateKey,
          })),
        },
      );
    }
    if (immediate || this.outboxQueue == null) {
      if (immediate) {
        logger.debug(
          "Sending activity immediately without queue since immediate option " +
            "is set.",
          { activityId: activity.id!.href, activity: jsonLd },
        );
      } else {
        logger.debug(
          "Sending activity immediately without queue since queue is not set.",
          { activityId: activity.id!.href, activity: jsonLd },
        );
      }
      const promises: Promise<void>[] = [];
      for (const inbox in inboxes) {
        promises.push(
          sendActivity({
            keys,
            activity: jsonLd,
            activityId: activity.id?.href,
            activityType: getTypeId(activity).href,
            inbox: new URL(inbox),
            sharedInbox: inboxes[inbox].sharedInbox,
            headers: collectionSync == null ? undefined : new Headers({
              "Collection-Synchronization":
                await buildCollectionSynchronizationHeader(
                  collectionSync,
                  inboxes[inbox].actorIds,
                ),
            }),
            specDeterminer: new KvSpecDeterminer(
              this.kv,
              this.kvPrefixes.httpMessageSignaturesSpec,
              this.firstKnock,
            ),
            tracerProvider: this.tracerProvider,
          }),
        );
      }
      await Promise.all(promises);
      return;
    }
    logger.debug(
      "Enqueuing activity {activityId} to send later.",
      { activityId: activity.id!.href, activity: jsonLd },
    );
    const keyJwkPairs: SenderKeyJwkPair[] = [];
    for (const { keyId, privateKey } of keys) {
      const privateKeyJwk = await exportJwk(privateKey);
      keyJwkPairs.push({ keyId: keyId.href, privateKey: privateKeyJwk });
    }
    if (!this.manuallyStartQueue) this._startQueueInternal(ctx.data);
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    const messages: OutboxMessage[] = [];
    for (const inbox in inboxes) {
      const message: OutboxMessage = {
        type: "outbox",
        id: crypto.randomUUID(),
        baseUrl: ctx.origin,
        keys: keyJwkPairs,
        activity: jsonLd,
        activityId: activity.id?.href,
        activityType: getTypeId(activity).href,
        inbox,
        sharedInbox: inboxes[inbox].sharedInbox,
        started: new Date().toISOString(),
        attempt: 0,
        headers: collectionSync == null ? {} : {
          "Collection-Synchronization":
            await buildCollectionSynchronizationHeader(
              collectionSync,
              inboxes[inbox].actorIds,
            ),
        },
        traceContext: carrier,
      };
      messages.push(message);
    }
    const { outboxQueue } = this;
    if (outboxQueue.enqueueMany == null) {
      const promises: Promise<void>[] = messages.map((m) =>
        outboxQueue.enqueue(m)
      );
      const results = await Promise.allSettled(promises);
      const errors = results
        .filter((r) => r.status === "rejected")
        .map((r) => (r as PromiseRejectedResult).reason);
      if (errors.length > 0) {
        logger.error(
          "Failed to enqueue activity {activityId} to send later: {errors}",
          { activityId: activity.id!.href, errors },
        );
        if (errors.length > 1) {
          throw new AggregateError(
            errors,
            `Failed to enqueue activity ${activityId} to send later.`,
          );
        }
        throw errors[0];
      }
    } else {
      try {
        await outboxQueue.enqueueMany(messages);
      } catch (error) {
        logger.error(
          "Failed to enqueue activity {activityId} to send later: {error}",
          { activityId: activity.id!.href, error },
        );
        throw error;
      }
    }
  }

  fetch(
    request: Request,
    options: FederationFetchOptions<TContextData>,
  ): Promise<Response> {
    const requestId = getRequestId(request);
    return withContext({ requestId }, async () => {
      const tracer = this._getTracer();
      return await tracer.startActiveSpan(
        request.method,
        {
          kind: SpanKind.SERVER,
          attributes: {
            [ATTR_HTTP_REQUEST_METHOD]: request.method,
            [ATTR_URL_FULL]: request.url,
          },
        },
        async (span) => {
          const logger = getLogger(["fedify", "federation", "http"]);
          if (span.isRecording()) {
            for (const [k, v] of request.headers) {
              span.setAttribute(ATTR_HTTP_REQUEST_HEADER(k), [v]);
            }
          }
          let response: Response;
          try {
            response = await this.#fetch(request, { ...options, span, tracer });
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `${error}`,
            });
            span.end();
            logger.error(
              "An error occurred while serving request {method} {url}: {error}",
              { method: request.method, url: request.url, error },
            );
            throw error;
          }
          if (span.isRecording()) {
            span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, response.status);
            for (const [k, v] of response.headers) {
              span.setAttribute(ATTR_HTTP_RESPONSE_HEADER(k), [v]);
            }
            span.setStatus({
              code: response.status >= 500
                ? SpanStatusCode.ERROR
                : SpanStatusCode.UNSET,
              message: response.statusText,
            });
          }
          span.end();
          const url = new URL(request.url);
          const logTpl = "{method} {path}: {status}";
          const values = {
            method: request.method,
            path: `${url.pathname}${url.search}`,
            url: request.url,
            status: response.status,
          };
          if (response.status >= 500) logger.error(logTpl, values);
          else if (response.status >= 400) logger.warn(logTpl, values);
          else logger.info(logTpl, values);
          return response;
        },
      );
    });
  }

  async #fetch(
    request: Request,
    {
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
      contextData,
      span,
      tracer,
    }: FederationFetchOptions<TContextData> & { span: Span; tracer: Tracer },
  ): Promise<Response> {
    onNotFound ??= notFound;
    onNotAcceptable ??= notAcceptable;
    onUnauthorized ??= unauthorized;
    const url = new URL(request.url);
    const route = this.router.route(url.pathname);
    if (route == null) return await onNotFound(request);
    span.updateName(`${request.method} ${route.template}`);
    let context = this.#createContext(request, contextData);
    const routeName = route.name.replace(/:.*$/, "");
    switch (routeName) {
      case "webfinger":
        return await handleWebFinger(request, {
          context,
          host: this.origin?.handleHost,
          actorDispatcher: this.actorCallbacks?.dispatcher,
          actorHandleMapper: this.actorCallbacks?.handleMapper,
          actorAliasMapper: this.actorCallbacks?.aliasMapper,
          onNotFound,
          tracer,
        });
      case "nodeInfoJrd":
        return await handleNodeInfoJrd(request, context);
      case "nodeInfo":
        return await handleNodeInfo(request, {
          context,
          nodeInfoDispatcher: this.nodeInfoDispatcher!,
        });
      case "actor":
        context = this.#createContext(request, contextData, {
          invokedFromActorDispatcher: {
            identifier: route.values.identifier ?? route.values.handle,
          },
        });
        return await handleActor(request, {
          identifier: route.values.identifier ?? route.values.handle,
          context,
          actorDispatcher: this.actorCallbacks?.dispatcher,
          authorizePredicate: this.actorCallbacks?.authorizePredicate,
          onUnauthorized,
          onNotFound,
          onNotAcceptable,
        });
      case "object": {
        const typeId = route.name.replace(/^object:/, "");
        const callbacks = this.objectCallbacks[typeId];
        const cls = this.objectTypeIds[typeId];
        context = this.#createContext(request, contextData, {
          invokedFromObjectDispatcher: { cls, values: route.values },
        });
        return await handleObject(request, {
          values: route.values,
          context,
          objectDispatcher: callbacks?.dispatcher,
          authorizePredicate: callbacks?.authorizePredicate,
          onUnauthorized,
          onNotFound,
          onNotAcceptable,
        });
      }
      case "outbox":
        return await handleCollection(request, {
          name: "outbox",
          identifier: route.values.identifier ?? route.values.handle,
          uriGetter: context.getOutboxUri.bind(context),
          context,
          collectionCallbacks: this.outboxCallbacks,
          tracerProvider: this.tracerProvider,
          onUnauthorized,
          onNotFound,
          onNotAcceptable,
        });
      case "inbox":
        if (request.method !== "POST") {
          return await handleCollection(request, {
            name: "inbox",
            identifier: route.values.identifier ?? route.values.handle,
            uriGetter: context.getInboxUri.bind(context),
            context,
            collectionCallbacks: this.inboxCallbacks,
            tracerProvider: this.tracerProvider,
            onUnauthorized,
            onNotFound,
            onNotAcceptable,
          });
        }
        context = this.#createContext(request, contextData, {
          documentLoader: await context.getDocumentLoader({
            identifier: route.values.identifier ?? route.values.handle,
          }),
        });
        // falls through
      case "sharedInbox":
        if (routeName !== "inbox" && this.sharedInboxKeyDispatcher != null) {
          const identity = await this.sharedInboxKeyDispatcher(context);
          if (identity != null) {
            context = this.#createContext(request, contextData, {
              documentLoader:
                "identifier" in identity || "username" in identity ||
                  "handle" in identity
                  ? await context.getDocumentLoader(identity)
                  : context.getDocumentLoader(identity),
            });
          }
        }
        if (!this.manuallyStartQueue) this._startQueueInternal(contextData);
        return await handleInbox(request, {
          recipient: route.values.identifier ?? route.values.handle ?? null,
          context,
          inboxContextFactory: context.toInboxContext.bind(context),
          kv: this.kv,
          kvPrefixes: this.kvPrefixes,
          queue: this.inboxQueue,
          actorDispatcher: this.actorCallbacks?.dispatcher,
          inboxListeners: this.inboxListeners,
          inboxErrorHandler: this.inboxErrorHandler,
          onNotFound,
          signatureTimeWindow: this.signatureTimeWindow,
          skipSignatureVerification: this.skipSignatureVerification,
          tracerProvider: this.tracerProvider,
          notifyInboundActivity: this.observers.length > 0
            ? (ctx, activity) => this.notifyObservers('onInboundActivity', ctx, activity)
            : undefined,
        });
      case "following":
        return await handleCollection(request, {
          name: "following",
          identifier: route.values.identifier ?? route.values.handle,
          uriGetter: context.getFollowingUri.bind(context),
          context,
          collectionCallbacks: this.followingCallbacks,
          tracerProvider: this.tracerProvider,
          onUnauthorized,
          onNotFound,
          onNotAcceptable,
        });
      case "followers": {
        let baseUrl = url.searchParams.get("base-url");
        if (baseUrl != null) {
          try {
            baseUrl = `${new URL(baseUrl).origin}/`;
          } catch {
            // If base-url is invalid, set to null to behave as if it wasn't provided
            baseUrl = null;
          }
        }
        return await handleCollection(request, {
          name: "followers",
          identifier: route.values.identifier ?? route.values.handle,
          uriGetter: baseUrl == null
            ? context.getFollowersUri.bind(context)
            : (identifier) => {
              const uri = context.getFollowersUri(identifier);
              uri.searchParams.set("base-url", baseUrl!);
              return uri;
            },
          context,
          filter: baseUrl != null ? new URL(baseUrl) : undefined,
          filterPredicate: baseUrl != null
            ? ((i) =>
              (i instanceof URL ? i.href : i.id?.href ?? "").startsWith(
                baseUrl!,
              ))
            : undefined,
          collectionCallbacks: this.followersCallbacks,
          tracerProvider: this.tracerProvider,
          onUnauthorized,
          onNotFound,
          onNotAcceptable,
        });
      }
      case "liked":
        return await handleCollection(request, {
          name: "liked",
          identifier: route.values.identifier ?? route.values.handle,
          uriGetter: context.getLikedUri.bind(context),
          context,
          collectionCallbacks: this.likedCallbacks,
          tracerProvider: this.tracerProvider,
          onUnauthorized,
          onNotFound,
          onNotAcceptable,
        });
      case "featured":
        return await handleCollection(request, {
          name: "featured",
          identifier: route.values.identifier ?? route.values.handle,
          uriGetter: context.getFeaturedUri.bind(context),
          context,
          collectionCallbacks: this.featuredCallbacks,
          tracerProvider: this.tracerProvider,
          onUnauthorized,
          onNotFound,
          onNotAcceptable,
        });
      case "featuredTags":
        return await handleCollection(request, {
          name: "featured tags",
          identifier: route.values.identifier ?? route.values.handle,
          uriGetter: context.getFeaturedTagsUri.bind(context),
          context,
          collectionCallbacks: this.featuredTagsCallbacks,
          tracerProvider: this.tracerProvider,
          onUnauthorized,
          onNotFound,
          onNotAcceptable,
        });
      default: {
        const response = onNotFound(request);
        return response instanceof Promise ? await response : response;
      }
    }
  }
}

interface ContextOptions<TContextData> {
  url: URL;
  federation: FederationImpl<TContextData>;
  data: TContextData;
  documentLoader: DocumentLoader;
  contextLoader: DocumentLoader;
  invokedFromActorKeyPairsDispatcher?: { identifier: string };
}

const FANOUT_THRESHOLD = 5;

export class ContextImpl<TContextData> implements Context<TContextData> {
  readonly url: URL;
  readonly federation: FederationImpl<TContextData>;
  readonly data: TContextData;
  readonly documentLoader: DocumentLoader;
  readonly contextLoader: DocumentLoader;
  readonly invokedFromActorKeyPairsDispatcher?: { identifier: string };

  constructor(
    {
      url,
      federation,
      data,
      documentLoader,
      contextLoader,
      invokedFromActorKeyPairsDispatcher,
    }: ContextOptions<TContextData>,
  ) {
    this.url = url;
    this.federation = federation;
    this.data = data;
    this.documentLoader = documentLoader;
    this.contextLoader = contextLoader;
    this.invokedFromActorKeyPairsDispatcher =
      invokedFromActorKeyPairsDispatcher;
  }

  clone(data: TContextData): Context<TContextData> {
    return new ContextImpl<TContextData>({
      url: this.url,
      federation: this.federation,
      data,
      documentLoader: this.documentLoader,
      contextLoader: this.contextLoader,
      invokedFromActorKeyPairsDispatcher:
        this.invokedFromActorKeyPairsDispatcher,
    });
  }

  toInboxContext(
    recipient: string | null,
    activity: unknown,
    activityId: string | undefined,
    activityType: string,
  ): InboxContextImpl<TContextData> {
    return new InboxContextImpl(recipient, activity, activityId, activityType, {
      url: this.url,
      federation: this.federation,
      data: this.data,
      documentLoader: this.documentLoader,
      contextLoader: this.contextLoader,
      invokedFromActorKeyPairsDispatcher:
        this.invokedFromActorKeyPairsDispatcher,
    });
  }

  get hostname(): string {
    return this.url.hostname;
  }

  get host(): string {
    return this.url.host;
  }

  get origin(): string {
    return this.url.origin;
  }

  get canonicalOrigin(): string {
    return this.federation.origin?.webOrigin ?? this.origin;
  }

  get tracerProvider(): TracerProvider {
    return this.federation.tracerProvider;
  }

  getNodeInfoUri(): URL {
    const path = this.federation.router.build("nodeInfo", {});
    if (path == null) {
      throw new RouterError("No NodeInfo dispatcher registered.");
    }
    return new URL(path, this.canonicalOrigin);
  }

  getActorUri(identifier: string): URL {
    const path = this.federation.router.build(
      "actor",
      { identifier, handle: identifier },
    );
    if (path == null) {
      throw new RouterError("No actor dispatcher registered.");
    }
    return new URL(path, this.canonicalOrigin);
  }

  getObjectUri<TObject extends Object>(
    // deno-lint-ignore no-explicit-any
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    values: Record<string, string>,
  ): URL {
    const callbacks = this.federation.objectCallbacks[cls.typeId.href];
    if (callbacks == null) {
      throw new RouterError("No object dispatcher registered.");
    }
    for (const param of callbacks.parameters) {
      if (!(param in values)) {
        throw new TypeError(`Missing parameter: ${param}`);
      }
    }
    const path = this.federation.router.build(
      `object:${cls.typeId.href}`,
      values,
    );
    if (path == null) {
      throw new RouterError("No object dispatcher registered.");
    }
    return new URL(path, this.canonicalOrigin);
  }

  getOutboxUri(identifier: string): URL {
    const path = this.federation.router.build(
      "outbox",
      { identifier, handle: identifier },
    );
    if (path == null) {
      throw new RouterError("No outbox dispatcher registered.");
    }
    return new URL(path, this.canonicalOrigin);
  }

  getInboxUri(): URL;
  getInboxUri(identifier: string): URL;
  getInboxUri(identifier?: string): URL {
    if (identifier == null) {
      const path = this.federation.router.build("sharedInbox", {});
      if (path == null) {
        throw new RouterError("No shared inbox path registered.");
      }
      return new URL(path, this.canonicalOrigin);
    }
    const path = this.federation.router.build(
      "inbox",
      { identifier, handle: identifier },
    );
    if (path == null) {
      throw new RouterError("No inbox path registered.");
    }
    return new URL(path, this.canonicalOrigin);
  }

  getFollowingUri(identifier: string): URL {
    const path = this.federation.router.build(
      "following",
      { identifier, handle: identifier },
    );
    if (path == null) {
      throw new RouterError("No following collection path registered.");
    }
    return new URL(path, this.canonicalOrigin);
  }

  getFollowersUri(identifier: string): URL {
    const path = this.federation.router.build(
      "followers",
      { identifier, handle: identifier },
    );
    if (path == null) {
      throw new RouterError("No followers collection path registered.");
    }
    return new URL(path, this.canonicalOrigin);
  }

  getLikedUri(identifier: string): URL {
    const path = this.federation.router.build(
      "liked",
      { identifier, handle: identifier },
    );
    if (path == null) {
      throw new RouterError("No liked collection path registered.");
    }
    return new URL(path, this.canonicalOrigin);
  }

  getFeaturedUri(identifier: string): URL {
    const path = this.federation.router.build(
      "featured",
      { identifier, handle: identifier },
    );
    if (path == null) {
      throw new RouterError("No featured collection path registered.");
    }
    return new URL(path, this.canonicalOrigin);
  }

  getFeaturedTagsUri(identifier: string): URL {
    const path = this.federation.router.build(
      "featuredTags",
      { identifier, handle: identifier },
    );
    if (path == null) {
      throw new RouterError("No featured tags collection path registered.");
    }
    return new URL(path, this.canonicalOrigin);
  }

  parseUri(uri: URL | null): ParseUriResult | null {
    if (uri == null) return null;
    if (uri.origin !== this.origin && uri.origin !== this.canonicalOrigin) {
      return null;
    }
    const route = this.federation.router.route(uri.pathname);
    const logger = getLogger(["fedify", "federation"]);
    if (route == null) return null;
    else if (route.name === "sharedInbox") {
      return {
        type: "inbox",
        identifier: undefined,
        get handle() {
          logger.warn(
            "The ParseUriResult.handle property is deprecated; " +
              "use ParseUriResult.identifier instead.",
          );
          return undefined;
        },
      };
    }
    const identifier = "identifier" in route.values
      ? route.values.identifier
      : route.values.handle;
    if (route.name === "actor") {
      return {
        type: "actor",
        identifier,
        get handle() {
          logger.warn(
            "The ParseUriResult.handle property is deprecated; " +
              "use ParseUriResult.identifier instead.",
          );
          return identifier;
        },
      };
    } else if (route.name.startsWith("object:")) {
      const typeId = route.name.replace(/^object:/, "");
      return {
        type: "object",
        class: this.federation.objectTypeIds[typeId],
        typeId: new URL(typeId),
        values: route.values,
      };
    } else if (route.name === "inbox") {
      return {
        type: "inbox",
        identifier,
        get handle() {
          logger.warn(
            "The ParseUriResult.handle property is deprecated; " +
              "use ParseUriResult.identifier instead.",
          );
          return identifier;
        },
      };
    } else if (route.name === "outbox") {
      return {
        type: "outbox",
        identifier,
        get handle() {
          logger.warn(
            "The ParseUriResult.handle property is deprecated; " +
              "use ParseUriResult.identifier instead.",
          );
          return identifier;
        },
      };
    } else if (route.name === "following") {
      return {
        type: "following",
        identifier,
        get handle() {
          logger.warn(
            "The ParseUriResult.handle property is deprecated; " +
              "use ParseUriResult.identifier instead.",
          );
          return identifier;
        },
      };
    } else if (route.name === "followers") {
      return {
        type: "followers",
        identifier,
        get handle() {
          logger.warn(
            "The ParseUriResult.handle property is deprecated; " +
              "use ParseUriResult.identifier instead.",
          );
          return identifier;
        },
      };
    } else if (route.name === "liked") {
      return {
        type: "liked",
        identifier,
        get handle() {
          logger.warn(
            "The ParseUriResult.handle property is deprecated; " +
              "use ParseUriResult.identifier instead.",
          );
          return identifier;
        },
      };
    } else if (route.name === "featured") {
      return {
        type: "featured",
        identifier,
        get handle() {
          logger.warn(
            "The ParseUriResult.handle property is deprecated; " +
              "use ParseUriResult.identifier instead.",
          );
          return identifier;
        },
      };
    } else if (route.name === "featuredTags") {
      return {
        type: "featuredTags",
        identifier,
        get handle() {
          logger.warn(
            "The ParseUriResult.handle property is deprecated; " +
              "use ParseUriResult.identifier instead.",
          );
          return identifier;
        },
      };
    }
    return null;
  }

  async getActorKeyPairs(identifier: string): Promise<ActorKeyPair[]> {
    const logger = getLogger(["fedify", "federation", "actor"]);
    if (this.invokedFromActorKeyPairsDispatcher != null) {
      logger.warn(
        "Context.getActorKeyPairs({getActorKeyPairsIdentifier}) method is " +
          "invoked from the actor key pairs dispatcher " +
          "({actorKeyPairsDispatcherIdentifier}); this may cause " +
          "an infinite loop.",
        {
          getActorKeyPairsIdentifier: identifier,
          actorKeyPairsDispatcherIdentifier:
            this.invokedFromActorKeyPairsDispatcher.identifier,
        },
      );
    }
    let keyPairs: (CryptoKeyPair & { keyId: URL })[];
    try {
      keyPairs = await this.getKeyPairsFromIdentifier(identifier);
    } catch (_) {
      logger.warn("No actor key pairs dispatcher registered.");
      return [];
    }
    const owner = this.getActorUri(identifier);
    const result = [];
    for (const keyPair of keyPairs) {
      const newPair: ActorKeyPair = {
        ...keyPair,
        cryptographicKey: new CryptographicKey({
          id: keyPair.keyId,
          owner,
          publicKey: keyPair.publicKey,
        }),
        multikey: new Multikey({
          id: keyPair.keyId,
          controller: owner,
          publicKey: keyPair.publicKey,
        }),
      };
      result.push(newPair);
    }
    return result;
  }

  protected async getKeyPairsFromIdentifier(
    identifier: string,
  ): Promise<(CryptoKeyPair & { keyId: URL })[]> {
    const logger = getLogger(["fedify", "federation", "actor"]);
    if (this.federation.actorCallbacks?.keyPairsDispatcher == null) {
      throw new Error("No actor key pairs dispatcher registered.");
    }
    const path = this.federation.router.build(
      "actor",
      { identifier, handle: identifier },
    );
    if (path == null) {
      logger.warn("No actor dispatcher registered.");
      return [];
    }
    const actorUri = new URL(path, this.canonicalOrigin);
    const keyPairs = await this.federation.actorCallbacks?.keyPairsDispatcher(
      new ContextImpl({
        ...this,
        invokedFromActorKeyPairsDispatcher: { identifier },
      }),
      identifier,
    );
    if (keyPairs.length < 1) {
      logger.warn("No key pairs found for actor {identifier}.", { identifier });
    }
    let i = 0;
    const result = [];
    for (const keyPair of keyPairs) {
      result.push({
        ...keyPair,
        keyId: new URL(
          // For backwards compatibility, the first key is always the #main-key:
          i == 0 ? `#main-key` : `#key-${i + 1}`,
          actorUri,
        ),
      });
      i++;
    }
    return result;
  }

  protected async getRsaKeyPairFromIdentifier(
    identifier: string,
  ): Promise<CryptoKeyPair & { keyId: URL } | null> {
    const keyPairs = await this.getKeyPairsFromIdentifier(identifier);
    for (const keyPair of keyPairs) {
      const { privateKey } = keyPair;
      if (
        privateKey.algorithm.name === "RSASSA-PKCS1-v1_5" &&
        (privateKey.algorithm as unknown as { hash: { name: string } }).hash
            .name ===
          "SHA-256"
      ) {
        return keyPair;
      }
    }
    getLogger(["fedify", "federation", "actor"]).warn(
      "No RSA-PKCS#1-v1.5 SHA-256 key found for actor {identifier}.",
      { identifier },
    );
    return null;
  }

  getDocumentLoader(
    identity:
      | { identifier: string }
      | { username: string }
      | { handle: string },
  ): Promise<DocumentLoader>;
  getDocumentLoader(identity: SenderKeyPair): DocumentLoader;
  getDocumentLoader(
    identity:
      | SenderKeyPair
      | { identifier: string }
      | { username: string }
      | { handle: string },
  ): DocumentLoader | Promise<DocumentLoader> {
    if (
      "identifier" in identity || "username" in identity || "handle" in identity
    ) {
      let identifierPromise: Promise<string | null>;
      if ("username" in identity || "handle" in identity) {
        let username: string;
        if ("username" in identity) {
          username = identity.username;
        } else {
          username = identity.handle;
          getLogger(["fedify", "runtime", "docloader"]).warn(
            'The "handle" property is deprecated; use "identifier" or ' +
              '"username" instead.',
            { identity },
          );
        }
        const mapper = this.federation.actorCallbacks?.handleMapper;
        if (mapper == null) {
          identifierPromise = Promise.resolve(username);
        } else {
          const identifier = mapper(this, username);
          identifierPromise = identifier instanceof Promise
            ? identifier
            : Promise.resolve(identifier);
        }
      } else {
        identifierPromise = Promise.resolve(identity.identifier);
      }
      return identifierPromise.then((identifier) => {
        if (identifier == null) return this.documentLoader;
        const keyPair = this.getRsaKeyPairFromIdentifier(identifier);
        return keyPair.then((pair) =>
          pair == null
            ? this.documentLoader
            : this.federation.authenticatedDocumentLoaderFactory(pair)
        );
      });
    }
    return this.federation.authenticatedDocumentLoaderFactory(identity);
  }

  lookupObject(
    identifier: string | URL,
    options: LookupObjectOptions = {},
  ): Promise<Object | null> {
    return lookupObject(identifier, {
      ...options,
      documentLoader: options.documentLoader ?? this.documentLoader,
      contextLoader: options.contextLoader ?? this.contextLoader,
      userAgent: options.userAgent ?? this.federation.userAgent,
      tracerProvider: options.tracerProvider ?? this.tracerProvider,
      // @ts-ignore: `allowPrivateAddress` is not in the type definition.
      allowPrivateAddress: this.federation.allowPrivateAddress,
    });
  }

  traverseCollection(
    collection: Collection,
    options: TraverseCollectionOptions = {},
  ): AsyncIterable<Object | Link> {
    return traverseCollection(collection, {
      ...options,
      documentLoader: options.documentLoader ?? this.documentLoader,
      contextLoader: options.contextLoader ?? this.contextLoader,
    });
  }

  lookupNodeInfo(
    url: URL | string,
    options?: GetNodeInfoOptions & { parse?: "strict" | "best-effort" },
  ): Promise<NodeInfo | undefined>;

  lookupNodeInfo(
    url: URL | string,
    options?: GetNodeInfoOptions & { parse: "none" },
  ): Promise<JsonValue | undefined>;

  lookupNodeInfo(
    url: URL | string,
    options: GetNodeInfoOptions = {},
  ): Promise<NodeInfo | JsonValue | undefined> {
    return options.parse === "none"
      ? getNodeInfo(url, {
        parse: "none",
        direct: options.direct,
        userAgent: options?.userAgent ?? this.federation.userAgent,
      })
      : getNodeInfo(url, {
        parse: options.parse,
        direct: options.direct,
        userAgent: options?.userAgent ?? this.federation.userAgent,
      });
  }

  lookupWebFinger(
    resource: URL | string,
    options: LookupWebFingerOptions = {},
  ): Promise<ResourceDescriptor | null> {
    return lookupWebFinger(resource, {
      ...options,
      userAgent: options.userAgent ?? this.federation.userAgent,
      tracerProvider: options.tracerProvider ?? this.tracerProvider,
      allowPrivateAddress: this.federation.allowPrivateAddress,
    });
  }

  sendActivity(
    sender:
      | SenderKeyPair
      | SenderKeyPair[]
      | { identifier: string }
      | { username: string }
      | { handle: string },
    recipients: Recipient | Recipient[] | "followers",
    activity: Activity,
    options: SendActivityOptionsForCollection = {},
  ): Promise<void> {
    const tracer = this.tracerProvider.getTracer(
      metadata.name,
      metadata.version,
    );
    return tracer.startActiveSpan(
      this.federation.outboxQueue == null || options.immediate
        ? "activitypub.outbox"
        : "activitypub.fanout",
      {
        kind: this.federation.outboxQueue == null || options.immediate
          ? SpanKind.CLIENT
          : SpanKind.PRODUCER,
        attributes: {
          "activitypub.activity.type": getTypeId(activity).href,
          "activitypub.activity.to": activity.toIds.map((to) => to.href),
          "activitypub.activity.cc": activity.toIds.map((cc) => cc.href),
          "activitypub.activity.bto": activity.btoIds.map((bto) => bto.href),
          "activitypub.activity.bcc": activity.toIds.map((bcc) => bcc.href),
        },
      },
      async (span) => {
        try {
          if (activity.id != null) {
            span.setAttribute("activitypub.activity.id", activity.id.href);
          }
          await this.sendActivityInternal(
            sender,
            recipients,
            activity,
            options,
            span,
          );
        } catch (e) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
          throw e;
        } finally {
          span.end();
        }
      },
    );
  }

  protected async sendActivityInternal(
    sender:
      | SenderKeyPair
      | SenderKeyPair[]
      | { identifier: string }
      | { username: string }
      | { handle: string },
    recipients: Recipient | Recipient[] | "followers",
    activity: Activity,
    options: SendActivityOptionsForCollection,
    span: Span,
  ): Promise<void> {
    const logger = getLogger(["fedify", "federation", "outbox"]);
    let keys: SenderKeyPair[];
    let identifier: string | null = null;
    if ("identifier" in sender || "username" in sender || "handle" in sender) {
      if ("identifier" in sender) {
        identifier = sender.identifier;
      } else {
        let username: string;
        if ("username" in sender) {
          username = sender.username;
        } else {
          username = sender.handle;
          logger.warn(
            'The "handle" property for the sender parameter is deprecated; ' +
              'use "identifier" or "username" instead.',
            { sender },
          );
        }
        if (this.federation.actorCallbacks?.handleMapper == null) {
          identifier = username;
        } else {
          const mapped = await this.federation.actorCallbacks.handleMapper(
            this,
            username,
          );
          if (mapped == null) {
            throw new Error(
              `No actor found for the given username ${
                JSON.stringify(username)
              }.`,
            );
          }
          identifier = mapped;
        }
      }
      span.setAttribute("fedify.actor.identifier", identifier);
      keys = await this.getKeyPairsFromIdentifier(identifier);
      if (keys.length < 1) {
        throw new Error(
          `No key pair found for actor ${JSON.stringify(identifier)}.`,
        );
      }
    } else if (Array.isArray(sender)) {
      if (sender.length < 1) {
        throw new Error("The sender's key pairs are empty.");
      }
      keys = sender;
    } else {
      keys = [sender];
    }
    if (keys.length < 1) {
      throw new TypeError("The sender's keys must not be empty.");
    }
    for (const { privateKey } of keys) {
      validateCryptoKey(privateKey, "private");
    }
    const opts: SendActivityInternalOptions<TContextData> = { context: this };
    let expandedRecipients: Recipient[];
    if (Array.isArray(recipients)) {
      expandedRecipients = recipients;
    } else if (recipients === "followers") {
      if (identifier == null) {
        throw new Error(
          'If recipients is "followers", ' +
            "sender must be an actor identifier or username.",
        );
      }
      expandedRecipients = [];
      for await (
        const recipient of this.getFollowers(identifier)
      ) {
        expandedRecipients.push(recipient);
      }
      if (options.syncCollection) {
        const collectionId = this.federation.router.build(
          "followers",
          { identifier, handle: identifier },
        );
        opts.collectionSync = collectionId == null
          ? undefined
          : new URL(collectionId, this.canonicalOrigin).href;
      }
    } else {
      expandedRecipients = [recipients];
    }
    span.setAttribute("activitypub.inboxes", expandedRecipients.length);
    for (const activityTransformer of this.federation.activityTransformers) {
      activity = activityTransformer(activity, this);
    }
    span?.setAttribute("activitypub.activity.id", activity?.id?.href ?? "");
    if (activity.actorId == null) {
      logger.error(
        "Activity {activityId} to send does not have an actor.",
        { activity, activityId: activity?.id?.href },
      );
      throw new TypeError(
        "The activity to send must have at least one actor property.",
      );
    }
    const inboxes = extractInboxes({
      recipients: expandedRecipients,
      preferSharedInbox: options.preferSharedInbox,
      excludeBaseUris: options.excludeBaseUris,
    });
    logger.debug("Sending activity {activityId} to inboxes:\n{inboxes}", {
      inboxes: globalThis.Object.keys(inboxes),
      activityId: activity.id?.href,
      activity,
    });
    if (
      this.federation.fanoutQueue == null || options.immediate ||
      options.fanout === "skip" || (options.fanout ?? "auto") === "auto" &&
        globalThis.Object.keys(inboxes).length < FANOUT_THRESHOLD
    ) {
      await this.federation.sendActivity(keys, inboxes, activity, opts);
      return;
    }
    const keyJwkPairs = await Promise.all(
      keys.map(async ({ keyId, privateKey }) => ({
        keyId: keyId.href,
        privateKey: await exportJwk(privateKey),
      })),
    );
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    const message: FanoutMessage = {
      type: "fanout",
      id: crypto.randomUUID(),
      baseUrl: this.origin,
      keys: keyJwkPairs,
      inboxes: globalThis.Object.fromEntries(
        globalThis.Object.entries(inboxes).map((
          [k, { actorIds, sharedInbox }],
        ) => [k, { actorIds: [...actorIds], sharedInbox }]),
      ),
      activity: await activity.toJsonLd({
        format: "compact",
        contextLoader: this.contextLoader,
      }),
      activityId: activity.id?.href,
      activityType: getTypeId(activity).href,
      collectionSync: opts.collectionSync,
      traceContext: carrier,
    };
    if (!this.federation.manuallyStartQueue) {
      this.federation._startQueueInternal(this.data);
    }
    this.federation.fanoutQueue.enqueue(message);
  }

  async *getFollowers(identifier: string): AsyncIterable<Recipient> {
    if (this.federation.followersCallbacks == null) {
      throw new Error("No followers collection dispatcher registered.");
    }
    const result = await this.federation.followersCallbacks.dispatcher(
      this,
      identifier,
      null,
    );
    if (result != null) {
      for (const recipient of result.items) yield recipient;
      return;
    }
    if (this.federation.followersCallbacks.firstCursor == null) {
      throw new Error(
        "No first cursor dispatcher registered for followers collection.",
      );
    }
    let cursor = await this.federation.followersCallbacks.firstCursor(
      this,
      identifier,
    );
    if (cursor != null) {
      getLogger(["fedify", "federation", "outbox"]).warn(
        "Since the followers collection dispatcher returned null for no " +
          "cursor (i.e., one-shot dispatcher), the pagination is used to fetch " +
          '"followers".  However, it is recommended to implement the one-shot ' +
          "dispatcher for better performance.",
        { identifier },
      );
    }
    while (cursor != null) {
      const result = await this.federation.followersCallbacks.dispatcher(
        this,
        identifier,
        cursor,
      );
      if (result == null) break;
      for (const recipient of result.items) yield recipient;
      cursor = result.nextCursor ?? null;
    }
  }

  routeActivity(
    recipient: string | null,
    activity: Activity,
    options: RouteActivityOptions = {},
  ): Promise<boolean> {
    const tracerProvider = this.tracerProvider ?? this.tracerProvider;
    const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
    return tracer.startActiveSpan(
      "activitypub.inbox",
      {
        kind: this.federation.inboxQueue == null || options.immediate
          ? SpanKind.INTERNAL
          : SpanKind.PRODUCER,
        attributes: {
          "activitypub.activity.type": getTypeId(activity).href,
        },
      },
      async (span) => {
        if (activity.id != null) {
          span.setAttribute("activitypub.activity.id", activity.id.href);
        }
        if (activity.toIds.length > 0) {
          span.setAttribute(
            "activitypub.activity.to",
            activity.toIds.map((to) => to.href),
          );
        }
        if (activity.ccIds.length > 0) {
          span.setAttribute(
            "activitypub.activity.cc",
            activity.ccIds.map((cc) => cc.href),
          );
        }
        if (activity.btoIds.length > 0) {
          span.setAttribute(
            "activitypub.activity.bto",
            activity.btoIds.map((bto) => bto.href),
          );
        }
        if (activity.bccIds.length > 0) {
          span.setAttribute(
            "activitypub.activity.bcc",
            activity.bccIds.map((bcc) => bcc.href),
          );
        }
        try {
          const ok = await this.routeActivityInternal(
            recipient,
            activity,
            options,
            span,
          );
          if (ok) {
            span.setAttribute("activitypub.shared_inbox", recipient == null);
            if (recipient != null) {
              span.setAttribute("fedify.inbox.recipient", recipient);
            }
          } else {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          return ok;
        } catch (e) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
          throw e;
        } finally {
          span.end();
        }
      },
    );
  }

  protected async routeActivityInternal(
    recipient: string | null,
    activity: Activity,
    options: RouteActivityOptions = {},
    span: Span,
  ): Promise<boolean> {
    const logger = getLogger(["fedify", "federation", "inbox"]);
    const contextLoader = options.contextLoader ?? this.contextLoader;
    const json = await activity.toJsonLd({ contextLoader });
    const keyCache = new KvKeyCache(
      this.federation.kv,
      this.federation.kvPrefixes.publicKey,
      this,
    );
    const verified = await verifyObject(
      Activity,
      json,
      {
        contextLoader,
        documentLoader: options.documentLoader ?? this.documentLoader,
        tracerProvider: options.tracerProvider ?? this.tracerProvider,
        keyCache,
      },
    );
    if (verified == null) {
      logger.debug(
        "Object Integrity Proofs are not verified.",
        { recipient, activity: json },
      );
      if (activity.id == null) {
        logger.debug(
          "Activity is missing an ID; unable to fetch.",
          { recipient, activity: json },
        );
        return false;
      }
      const fetched = await this.lookupObject(activity.id, options);
      if (fetched == null) {
        logger.debug(
          "Failed to fetch the remote activity object {activityId}.",
          { recipient, activity: json, activityId: activity.id.href },
        );
        return false;
      } else if (!(fetched instanceof Activity)) {
        logger.debug(
          "Fetched object is not an Activity.",
          { recipient, activity: await fetched.toJsonLd({ contextLoader }) },
        );
        return false;
      } else if (fetched.id?.href !== activity.id.href) {
        logger.debug(
          "Fetched activity object has a different ID; failed to verify.",
          { recipient, activity: await fetched.toJsonLd({ contextLoader }) },
        );
        return false;
      } else if (fetched.actorIds.length < 1) {
        logger.debug(
          "Fetched activity object is missing an actor; unable to verify.",
          { recipient, activity: await fetched.toJsonLd({ contextLoader }) },
        );
        return false;
      }
      const activityId = fetched.id;
      if (
        !fetched.actorIds.every((actor) => actor.origin === activityId.origin)
      ) {
        logger.debug(
          "Fetched activity object has actors from different origins; " +
            "unable to verify.",
          { recipient, activity: await fetched.toJsonLd({ contextLoader }) },
        );
        return false;
      }
      logger.debug(
        "Successfully fetched the remote activity object {activityId}; " +
          "ignore the original activity and use the fetched one, which is trustworthy.",
      );
      activity = fetched;
    } else {
      logger.debug(
        "Object Integrity Proofs are verified.",
        { recipient, activity: json },
      );
    }
    const routeResult = await routeActivity({
      context: this,
      json,
      activity,
      recipient,
      inboxListeners: this.federation.inboxListeners,
      inboxContextFactory: this.toInboxContext.bind(this),
      inboxErrorHandler: this.federation.inboxErrorHandler,
      kv: this.federation.kv,
      kvPrefixes: this.federation.kvPrefixes,
      queue: this.federation.inboxQueue,
      span,
      tracerProvider: options.tracerProvider ?? this.tracerProvider,
    });
    return routeResult === "alreadyProcessed" || routeResult === "enqueued" ||
      routeResult === "unsupportedActivity" || routeResult === "success";
  }
}

interface RequestContextOptions<TContextData>
  extends ContextOptions<TContextData> {
  request: Request;
  invokedFromActorDispatcher?: { identifier: string };
  invokedFromObjectDispatcher?: {
    // deno-lint-ignore no-explicit-any
    cls: (new (...args: any[]) => Object) & { typeId: URL };
    values: Record<string, string>;
  };
}

class RequestContextImpl<TContextData> extends ContextImpl<TContextData>
  implements RequestContext<TContextData> {
  readonly #invokedFromActorDispatcher?: { identifier: string };
  readonly #invokedFromObjectDispatcher?: {
    // deno-lint-ignore no-explicit-any
    cls: (new (...args: any[]) => Object) & { typeId: URL };
    values: Record<string, string>;
  };
  readonly request: Request;
  // deno-lint-ignore no-explicit-any
  override readonly url: URL = undefined as any;

  constructor(options: RequestContextOptions<TContextData>) {
    super(options);
    this.#invokedFromActorDispatcher = options.invokedFromActorDispatcher;
    this.#invokedFromObjectDispatcher = options.invokedFromObjectDispatcher;
    this.request = options.request;
    this.url = options.url;
  }

  override clone(data: TContextData): RequestContext<TContextData> {
    return new RequestContextImpl<TContextData>({
      url: this.url,
      federation: this.federation,
      data,
      documentLoader: this.documentLoader,
      contextLoader: this.contextLoader,
      invokedFromActorKeyPairsDispatcher:
        this.invokedFromActorKeyPairsDispatcher,
      invokedFromActorDispatcher: this.#invokedFromActorDispatcher,
      invokedFromObjectDispatcher: this.#invokedFromObjectDispatcher,
      request: this.request,
    });
  }

  async getActor(identifier: string): Promise<Actor | null> {
    if (
      this.federation.actorCallbacks == null ||
      this.federation.actorCallbacks.dispatcher == null
    ) {
      throw new Error("No actor dispatcher registered.");
    }
    if (this.#invokedFromActorDispatcher != null) {
      getLogger(["fedify", "federation", "actor"]).warn(
        "RequestContext.getActor({getActorIdentifier}) is invoked from " +
          "the actor dispatcher ({actorDispatcherIdentifier}); " +
          "this may cause an infinite loop.",
        {
          getActorIdentifier: identifier,
          actorDispatcherIdentifier:
            this.#invokedFromActorDispatcher.identifier,
        },
      );
    }
    return await this.federation.actorCallbacks.dispatcher(
      new RequestContextImpl({
        ...this,
        invokedFromActorDispatcher: { identifier },
      }),
      identifier,
    );
  }

  async getObject<TObject extends Object>(
    // deno-lint-ignore no-explicit-any
    cls: (new (...args: any[]) => TObject) & { typeId: URL },
    values: Record<string, string>,
  ): Promise<TObject | null> {
    const callbacks = this.federation.objectCallbacks[cls.typeId.href];
    if (callbacks == null) {
      throw new Error("No object dispatcher registered.");
    }
    for (const param of callbacks.parameters) {
      if (!(param in values)) {
        throw new TypeError(`Missing parameter: ${param}`);
      }
    }
    if (this.#invokedFromObjectDispatcher != null) {
      getLogger(["fedify", "federation"]).warn(
        "RequestContext.getObject({getObjectClass}, " +
          "{getObjectValues}) is invoked from the object dispatcher " +
          "({actorDispatcherClass}, {actorDispatcherValues}); " +
          "this may cause an infinite loop.",
        {
          getObjectClass: cls.name,
          getObjectValues: values,
          actorDispatcherClass: this.#invokedFromObjectDispatcher.cls.name,
          actorDispatcherValues: this.#invokedFromObjectDispatcher.values,
        },
      );
    }
    return await callbacks.dispatcher(
      new RequestContextImpl({
        ...this,
        invokedFromObjectDispatcher: { cls, values },
      }),
      values,
      // deno-lint-ignore no-explicit-any
    ) as any;
  }

  #signedKey: CryptographicKey | null | undefined = undefined;

  async getSignedKey(
    options: GetSignedKeyOptions = {},
  ): Promise<CryptographicKey | null> {
    if (this.#signedKey != null) return this.#signedKey;
    return this.#signedKey = await verifyRequest(this.request, {
      ...this,
      contextLoader: options.contextLoader ?? this.contextLoader,
      documentLoader: options.documentLoader ?? this.documentLoader,
      timeWindow: this.federation.signatureTimeWindow,
      tracerProvider: options.tracerProvider ?? this.tracerProvider,
    });
  }

  #signedKeyOwner: Actor | null | undefined = undefined;

  async getSignedKeyOwner(
    options: GetKeyOwnerOptions = {},
  ): Promise<Actor | null> {
    if (this.#signedKeyOwner != null) return this.#signedKeyOwner;
    const key = await this.getSignedKey(options);
    if (key == null) return this.#signedKeyOwner = null;
    return this.#signedKeyOwner = await getKeyOwner(key, {
      contextLoader: options.contextLoader ?? this.contextLoader,
      documentLoader: options.documentLoader ?? this.documentLoader,
      tracerProvider: options.tracerProvider ?? this.tracerProvider,
    });
  }
}

export class InboxContextImpl<TContextData> extends ContextImpl<TContextData>
  implements InboxContext<TContextData> {
  readonly recipient: string | null;
  readonly activity: unknown;
  readonly activityId?: string;
  readonly activityType: string;

  constructor(
    recipient: string | null,
    activity: unknown,
    activityId: string | undefined,
    activityType: string,
    options: ContextOptions<TContextData>,
  ) {
    super(options);
    this.recipient = recipient;
    this.activity = activity;
    this.activityId = activityId;
    this.activityType = activityType;
  }

  override clone(data: TContextData): InboxContext<TContextData> {
    return new InboxContextImpl<TContextData>(
      this.recipient,
      this.activity,
      this.activityId,
      this.activityType,
      {
        url: this.url,
        federation: this.federation,
        data,
        documentLoader: this.documentLoader,
        contextLoader: this.contextLoader,
        invokedFromActorKeyPairsDispatcher:
          this.invokedFromActorKeyPairsDispatcher,
      },
    );
  }

  forwardActivity(
    forwarder:
      | SenderKeyPair
      | SenderKeyPair[]
      | { identifier: string }
      | { username: string }
      | { handle: string },
    recipients: Recipient | Recipient[],
    options?: ForwardActivityOptions,
  ): Promise<void>;
  forwardActivity(
    forwarder:
      | { identifier: string }
      | { username: string }
      | { handle: string },
    recipients: "followers",
    options?: ForwardActivityOptions,
  ): Promise<void>;
  forwardActivity(
    forwarder:
      | SenderKeyPair
      | SenderKeyPair[]
      | { identifier: string }
      | { username: string }
      | { handle: string },
    recipients: Recipient | Recipient[] | "followers",
    options?: ForwardActivityOptions,
  ): Promise<void> {
    const tracer = this.tracerProvider.getTracer(
      metadata.name,
      metadata.version,
    );
    return tracer.startActiveSpan(
      "activitypub.outbox",
      {
        kind: this.federation.outboxQueue == null || options?.immediate
          ? SpanKind.CLIENT
          : SpanKind.PRODUCER,
        attributes: { "activitypub.activity.type": this.activityType },
      },
      async (span) => {
        try {
          if (this.activityId != null) {
            span.setAttribute("activitypub.activity.id", this.activityId);
          }
          await this.forwardActivityInternal(forwarder, recipients, options);
        } catch (e) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
          throw e;
        } finally {
          span.end();
        }
      },
    );
  }

  private async forwardActivityInternal(
    forwarder:
      | SenderKeyPair
      | SenderKeyPair[]
      | { identifier: string }
      | { username: string }
      | { handle: string },
    recipients: Recipient | Recipient[] | "followers",
    options?: ForwardActivityOptions,
  ): Promise<void> {
    const logger = getLogger(["fedify", "federation", "inbox"]);
    let keys: SenderKeyPair[];
    let identifier: string | null = null;
    if (
      "identifier" in forwarder || "username" in forwarder ||
      "handle" in forwarder
    ) {
      if ("identifier" in forwarder) {
        identifier = forwarder.identifier;
      } else {
        let username: string;
        if ("username" in forwarder) {
          username = forwarder.username;
        } else {
          username = forwarder.handle;
          logger.warn(
            'The "handle" property for the forwarder parameter is deprecated; ' +
              'use "identifier" or "username" instead.',
            { forwarder },
          );
        }
        if (this.federation.actorCallbacks?.handleMapper == null) {
          identifier = username;
        } else {
          const mapped = await this.federation.actorCallbacks.handleMapper(
            this,
            username,
          );
          if (mapped == null) {
            throw new Error(
              `No actor found for the given username ${
                JSON.stringify(username)
              }.`,
            );
          }
          identifier = mapped;
        }
      }
      keys = await this.getKeyPairsFromIdentifier(identifier);
      if (keys.length < 1) {
        throw new Error(
          `No key pair found for actor ${JSON.stringify(identifier)}.`,
        );
      }
    } else if (Array.isArray(forwarder)) {
      if (forwarder.length < 1) {
        throw new Error("The forwarder's key pairs are empty.");
      }
      keys = forwarder;
    } else {
      keys = [forwarder];
    }
    if (!hasSignature(this.activity)) {
      let hasProof: boolean;
      try {
        const activity = await Activity.fromJsonLd(this.activity, this);
        hasProof = await activity.getProof() != null;
      } catch {
        hasProof = false;
      }
      if (!hasProof) {
        if (options?.skipIfUnsigned) return;
        logger.warn(
          "The received activity {activityId} is not signed; even if it is " +
            "forwarded to other servers as is, it may not be accepted by " +
            "them due to the lack of a signature/proof.",
        );
      }
    }
    if (recipients === "followers") {
      if (identifier == null) {
        throw new Error(
          'If recipients is "followers", ' +
            "forwarder must be an actor identifier or username.",
        );
      }
      const followers: Recipient[] = [];
      for await (const recipient of this.getFollowers(identifier)) {
        followers.push(recipient);
      }
      recipients = followers;
    }
    const inboxes = extractInboxes({
      recipients: Array.isArray(recipients) ? recipients : [recipients],
      preferSharedInbox: options?.preferSharedInbox,
      excludeBaseUris: options?.excludeBaseUris,
    });
    logger.debug("Forwarding activity {activityId} to inboxes:\n{inboxes}", {
      inboxes: globalThis.Object.keys(inboxes),
      activityId: this.activityId,
      activity: this.activity,
    });
    if (options?.immediate || this.federation.outboxQueue == null) {
      if (options?.immediate) {
        logger.debug(
          "Forwarding activity immediately without queue since immediate " +
            "option is set.",
        );
      } else {
        logger.debug(
          "Forwarding activity immediately without queue since queue is not " +
            "set.",
        );
      }
      const promises: Promise<void>[] = [];
      for (const inbox in inboxes) {
        promises.push(
          sendActivity({
            keys,
            activity: this.activity,
            activityId: this.activityId,
            activityType: this.activityType,
            inbox: new URL(inbox),
            sharedInbox: inboxes[inbox].sharedInbox,
            tracerProvider: this.tracerProvider,
            specDeterminer: new KvSpecDeterminer(
              this.federation.kv,
              this.federation.kvPrefixes.httpMessageSignaturesSpec,
              this.federation.firstKnock,
            ),
          }),
        );
      }
      await Promise.all(promises);
      return;
    }
    logger.debug(
      "Enqueuing activity {activityId} to forward later.",
      { activityId: this.activityId, activity: this.activity },
    );
    const keyJwkPairs: SenderKeyJwkPair[] = [];
    for (const { keyId, privateKey } of keys) {
      const privateKeyJwk = await exportJwk(privateKey);
      keyJwkPairs.push({ keyId: keyId.href, privateKey: privateKeyJwk });
    }
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    const messages: OutboxMessage[] = [];
    for (const inbox in inboxes) {
      const message: OutboxMessage = {
        type: "outbox",
        id: crypto.randomUUID(),
        baseUrl: this.origin,
        keys: keyJwkPairs,
        activity: this.activity,
        activityId: this.activityId,
        activityType: this.activityType,
        inbox,
        sharedInbox: inboxes[inbox].sharedInbox,
        started: new Date().toISOString(),
        attempt: 0,
        headers: {},
        traceContext: carrier,
      };
      messages.push(message);
    }
    const { outboxQueue } = this.federation;
    if (outboxQueue.enqueueMany == null) {
      const promises: Promise<void>[] = messages.map((m) =>
        outboxQueue.enqueue(m)
      );
      const results = await Promise.allSettled(promises);
      const errors: unknown[] = results
        .filter((r) => r.status === "rejected")
        .map((r) => (r as PromiseRejectedResult).reason);
      if (errors.length > 0) {
        logger.error(
          "Failed to enqueue activity {activityId} to forward later:\n{errors}",
          { activityId: this.activityId, errors },
        );
        if (errors.length > 1) {
          throw new AggregateError(
            errors,
            `Failed to enqueue activity ${this.activityId} to forward later.`,
          );
        }
        throw errors[0];
      }
    } else {
      try {
        await outboxQueue.enqueueMany(messages);
      } catch (error) {
        logger.error(
          "Failed to enqueue activity {activityId} to forward later:\n{error}",
          { activityId: this.activityId, error },
        );
        throw error;
      }
    }
  }
}

interface SendActivityInternalOptions<TContextData> {
  immediate?: boolean;
  collectionSync?: string;
  context: Context<TContextData>;
}

export class KvSpecDeterminer implements HttpMessageSignaturesSpecDeterminer {
  kv: KvStore;
  prefix: KvKey;
  defaultSpec: HttpMessageSignaturesSpec;

  constructor(
    kv: KvStore,
    prefix: KvKey,
    defaultSpec: HttpMessageSignaturesSpec = "rfc9421",
  ) {
    this.kv = kv;
    this.prefix = prefix;
    this.defaultSpec = defaultSpec;
  }

  async determineSpec(
    origin: string,
  ): Promise<HttpMessageSignaturesSpec> {
    return await this.kv.get<HttpMessageSignaturesSpec>([
      ...this.prefix,
      origin,
    ]) ?? this.defaultSpec;
  }

  async rememberSpec(
    origin: string,
    spec: HttpMessageSignaturesSpec,
  ): Promise<void> {
    await this.kv.set([...this.prefix, origin], spec);
  }
}

function notFound(_request: Request): Response {
  return new Response("Not Found", { status: 404 });
}

function notAcceptable(_request: Request): Response {
  return new Response("Not Acceptable", {
    status: 406,
    headers: {
      Vary: "Accept, Signature",
    },
  });
}

function unauthorized(_request: Request): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      Vary: "Accept, Signature",
    },
  });
}

/**
 * Generates or extracts a unique identifier for a request.
 *
 * This function first attempts to extract an existing request ID from standard
 * tracing headers. If none exists, it generates a new one. The ID format is:
 *
 *  -  If from headers, uses the existing ID.
 *  -  If generated, uses format `req_` followed by a base36 timestamp and
 *     6 random chars.
 *
 * @param request The incoming HTTP request.
 * @returns A string identifier unique to this request.
 */
function getRequestId(request: Request): string {
  // First try to get existing trace ID from standard headers:
  const traceId = request.headers.get("X-Request-Id") ||
    request.headers.get("X-Correlation-Id") ||
    request.headers.get("Traceparent")?.split("-")[1];
  if (traceId != null) return traceId;
  // Generate new ID if none exists:
  // - Use timestamp for rough chronological ordering
  // - Add random suffix for uniqueness within same millisecond
  // - Prefix to distinguish from potential existing IDs
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `req_${timestamp}${random}`;
}
