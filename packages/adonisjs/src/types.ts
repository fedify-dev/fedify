/**
 * Types for `@fedify/adonisjs`.
 *
 * This module also carries the *module augmentations* that teach AdonisJS about
 * Fedify: the `ctx.federation` property on `HttpContext` and the three IoC
 * container bindings.  Importing this module (directly or, more usually, via
 * the package entry point) is what makes those types visible to an
 * application's TypeScript project.
 *
 * @module
 */
import type { HttpContext } from "@adonisjs/core/http";
// TypeScript only binds a `declare module` augmentation when the target module
// is part of the program, so the module has to be imported even though nothing
// is used from it directly.
import type {} from "@adonisjs/core/types";
import type {
  Federation,
  FederationBuilder,
  FederationOptions,
  FederationOrigin,
  KvStore,
  RequestContext,
} from "@fedify/fedify";

/**
 * The "register pattern" interface used to configure the context data type of
 * an application, in the same spirit as AdonisJS's own `ContainerBindings` or
 * `EventsList` interfaces.
 *
 * Fedify threads an application-defined value — `TContextData` — through every
 * dispatcher, collection callback and inbox listener.  Because a package cannot
 * know that type in advance, an application declares it by augmenting this
 * interface once, usually in `config/fedify.ts`:
 *
 * ```ts
 * declare module '@fedify/adonisjs/types' {
 *   interface FedifyTypes {
 *     contextData: { user: User | null }
 *   }
 * }
 * ```
 *
 * After that augmentation, {@link ContextData} resolves to the declared type
 * everywhere in the application, including inside `ctx.federation`.
 */
// The empty interface is intentional: it is the extension point applications
// augment, so it has to start out with no members.
// deno-lint-ignore no-empty-interface
export interface FedifyTypes {}

/**
 * The context data type of the current application.
 *
 * Resolves to whatever {@link FedifyTypes.contextData} was augmented to, and
 * falls back to `HttpContext | null` when the application has not augmented
 * anything.
 *
 * The `| null` half of the default is deliberate and important.  Fedify invokes
 * dispatchers and inbox listeners from two very different places:
 *
 * - During an HTTP request, where an `HttpContext` exists, and
 * - From a background queue worker or an Ace command, where one does *not*.
 *
 * Defaulting to a non-nullable `HttpContext` would let application code write
 * `ctx.data.auth.user` in an inbox listener and only discover at 3 a.m. in
 * production — once a real server delivers an activity through the queue — that
 * there was never an HTTP context to read.  The nullable default forces that
 * case to be handled at compile time.
 */
export type ContextData = FedifyTypes extends
  { contextData: infer TContextData } ? TContextData
  : HttpContext | null;

/**
 * A callback that produces the Fedify context data for a single HTTP request.
 *
 * This mirrors the `ContextDataFactory` type exported by the other Fedify
 * integration packages (`@fedify/express`, `@fedify/hono`, `@fedify/koa`, …).
 * Like Hono's and Koa's variants — and unlike Express's, which only receives
 * the request — it is handed the whole framework context, so it can read the
 * authenticated user, the request-scoped container resolver, or anything else
 * hanging off `HttpContext`.
 *
 * It may be synchronous or asynchronous, and it is invoked at most once per
 * request.
 */
export type ContextDataFactory<TContextData> = (
  ctx: HttpContext,
) => TContextData | Promise<TContextData>;

/**
 * Options for bridging Fedify's LogTape logs into the AdonisJS logger.
 */
export interface FedifyLoggingConfig {
  /**
   * The LogTape categories to route into the AdonisJS logger.
   *
   * Defaults to Fedify's own category plus LogTape's meta category, which is
   * where LogTape reports its own configuration problems.
   *
   * @default `[['logtape', 'meta'], ['fedify']]`
   */
  categories?: (string | string[])[];
}

/**
 * The shape of the object passed to {@link defineConfig} in `config/fedify.ts`.
 *
 * It is Fedify's own {@link FederationOptions} — so every Fedify option is
 * available and documented in Fedify's own reference — plus a handful of
 * AdonisJS-specific keys, and with two differences:
 *
 * - `origin` is **required** (Fedify treats it as optional and derives the
 *   origin from the incoming request, which produces wrong actor URIs the
 *   moment the app sits behind a proxy or a tunnel), and
 * - `kv` is **optional** (it falls back to an in-memory store in development).
 */
export interface FedifyConfig
  extends Omit<FederationOptions<ContextData>, "kv" | "origin"> {
  /**
   * The canonical public origin of this server, for example
   * `https://social.example.com`.
   *
   * Fedify mints actor URIs, activity IDs and collection URLs from this value,
   * so it must be the address remote servers can reach — not the address the
   * Node process happens to be listening on.  Read it from an environment
   * variable (the `configure` hook adds `PUBLIC_URL` for exactly this purpose).
   *
   * Pass a {@link FederationOrigin} object when the WebFinger handle domain
   * differs from the web origin, for example handles `@me@example.com` served
   * from `https://social.example.com`.
   */
  origin: string | FederationOrigin;

  /**
   * The key–value store Fedify uses for caching remote documents, tracking
   * inbox idempotency, and holding outbox state.
   *
   * Defaults to an in-memory store, which is fine for development and tests but
   * loses all state on restart and cannot be shared between processes.  A
   * warning is logged if the default is used in production.  Use a persistent
   * implementation such as `@fedify/sqlite`, `@fedify/postgres`,
   * `@fedify/redis`, or `@fedify/mysql` in production.
   */
  kv?: KvStore;

  /**
   * Produces the {@link ContextData} for each incoming HTTP request.
   *
   * Defaults to `(ctx) => ctx`, i.e. the `HttpContext` itself, which matches the
   * default of {@link ContextData}.  Override it whenever the application has
   * augmented {@link FedifyTypes}.
   */
  contextDataFactory?: ContextDataFactory<ContextData>;

  /**
   * URL path prefixes that Fedify should never see.
   *
   * Requests whose path starts with one of these prefixes skip the Fedify
   * middleware entirely and go straight to the AdonisJS router.  This is a pure
   * performance escape hatch for hot paths that can never be federation
   * endpoints — Vite's dev-server routes are the usual example.
   *
   * Accessing `ctx.federation` inside a request that matched one of these
   * prefixes throws, because no Fedify context was created for it.
   *
   * @default `[]`
   */
  ignoreRoutePrefixes?: string[];

  /**
   * Whether to pipe Fedify's LogTape logs into the AdonisJS logger.
   *
   * Fedify logs a great deal of useful diagnostic detail (signature
   * verification, delivery attempts, WebFinger lookups) through LogTape.
   * Without this bridge, none of it appears in the application's log output.
   *
   * Set to `false` if the application configures LogTape itself.
   *
   * @default `true`
   */
  logging?: boolean | FedifyLoggingConfig;

  /**
   * Who drains Fedify's task queue, and with what context data.
   *
   * Required whenever {@link FederationOptions.queue} is set, because there is
   * no safe default.  Letting Fedify start the queue lazily — which is what it
   * does out of the box — captures the context data of whichever HTTP request
   * happened to enqueue the first task, and every background job for the rest
   * of the process then runs with that one stale request's `HttpContext`.
   *
   * Pass a callback to have the **web process** drain the queue: the service
   * provider starts the worker in the `ready` lifecycle hook and stops it on
   * shutdown.  There is no `HttpContext` behind a queued task, hence the
   * callback takes no arguments.
   *
   * Pass `false` when a **separate worker process** owns the queue.  Nothing is
   * started in-process, and it is then that worker's job to call
   * `federation.startQueue()`.
   */
  queueContextData?: (() => ContextData | Promise<ContextData>) | false;
}

/**
 * The fully-resolved configuration held by the `fedify.config` container
 * binding: {@link FedifyConfig} with every optional AdonisJS-specific key
 * filled in.
 */
export interface ResolvedFedifyConfig extends FederationOptions<ContextData> {
  contextDataFactory: ContextDataFactory<ContextData>;
  ignoreRoutePrefixes: string[];
  logging: boolean | FedifyLoggingConfig;
  queueContextData?: (() => ContextData | Promise<ContextData>) | false;
}

declare module "@adonisjs/core/types" {
  interface ContainerBindings {
    /**
     * The built {@link Federation} instance.  Resolvable only once the
     * application is ready — see the service provider for why.
     */
    "fedify": Federation<ContextData>;

    /**
     * The {@link FederationBuilder} that dispatchers and inbox listeners are
     * registered on, before the `Federation` instance is built.
     */
    "fedify.builder": FederationBuilder<ContextData>;

    /**
     * The resolved contents of `config/fedify.ts`.
     */
    "fedify.config": ResolvedFedifyConfig;
  }
}

declare module "@adonisjs/core/http" {
  interface HttpContext {
    /**
     * The Fedify {@link RequestContext} for the current request.
     *
     * Use it to mint canonical URIs (`ctx.federation.getActorUri('me')`), look
     * remote objects up (`ctx.federation.lookupObject('@user@example.com')`),
     * or send activities (`ctx.federation.sendActivity(...)`) from ordinary
     * AdonisJS controllers.
     *
     * The context is created lazily on first access, so requests that never
     * touch it pay nothing.  Accessing it throws if the request path matched
     * {@link FedifyConfig.ignoreRoutePrefixes}, or if the Fedify server
     * middleware is not registered in `start/kernel.ts`.
     */
    federation: RequestContext<ContextData>;
  }
}
