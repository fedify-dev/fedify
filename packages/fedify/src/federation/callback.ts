import type { Activity, CryptographicKey, Object } from "@fedify/vocab";
import type { NodeInfo } from "../nodeinfo/types.ts";
import type { Actor } from "../vocab/actor.ts";
import type { Link } from "../webfinger/mod.ts";
import type { PageItems } from "./collection.ts";
import type { Context, InboxContext, RequestContext } from "./context.ts";
import type { SenderKeyPair } from "./send.ts";

/**
 * A callback that dispatches a {@link NodeInfo} object.
 *
 * @template TContextData The context data to pass to the {@link Context}.
 */
export type NodeInfoDispatcher<TContextData> = (
  context: RequestContext<TContextData>,
) => NodeInfo | Promise<NodeInfo>;

/**
 * A callback that dispatches a array of {@link Link}.
 *
 * @template TContextData The context data to pass to the {@link Context}.
 * @param resource The URL queried via WebFinger.
 * @returns Links related to the queried resource.
 */
export type WebFingerLinksDispatcher<TContextData> = (
  context: RequestContext<TContextData>,
  resource: URL,
) => readonly Link[] | Promise<readonly Link[]>;

/**
 * A callback that dispatches an {@link Actor} object.
 *
 * @template TContextData The context data to pass to the {@link Context}.
 * @param context The request context.
 * @param identifier The actor's internal identifier or username.
 */
export type ActorDispatcher<TContextData> = (
  context: RequestContext<TContextData>,
  identifier: string,
) => Actor | null | Promise<Actor | null>;

/**
 * A callback that dispatches key pairs for an actor.
 *
 * @template TContextData The context data to pass to the {@link Context}.
 * @param context The context.
 * @param identifier The actor's internal identifier or username.
 * @returns The key pairs.
 * @since 0.10.0
 */
export type ActorKeyPairsDispatcher<TContextData> = (
  context: Context<TContextData>,
  identifier: string,
) => CryptoKeyPair[] | Promise<CryptoKeyPair[]>;

/**
 * A callback that maps a WebFinger username to the corresponding actor's
 * internal identifier, or `null` if the username is not found.
 * @template TContextData The context data to pass to the {@link Context}.
 * @param context The context.
 * @param username The WebFinger username.
 * @returns The actor's internal identifier, or `null` if the username is not
 *          found.
 * @since 0.15.0
 */
export type ActorHandleMapper<TContextData> = (
  context: Context<TContextData>,
  username: string,
) => string | null | Promise<string | null>;

/**
 * A callback that maps a WebFinger query to the corresponding actor's
 * internal identifier or username, or `null` if the query is not found.
 * @template TContextData The context data to pass to the {@link Context}.
 * @param context The request context.
 * @param resource The URL that was queried through WebFinger.
 * @returns The actor's internal identifier or username, or `null` if the query
 *          is not found.
 * @since 1.4.0
 */
export type ActorAliasMapper<TContextData> = (
  context: RequestContext<TContextData>,
  resource: URL,
) =>
  | { identifier: string }
  | { username: string }
  | null
  | Promise<{ identifier: string } | { username: string } | null>;

/**
 * A callback that dispatches an object.
 *
 * @template TContextData The context data to pass to the {@link Context}.
 * @template TObject The type of object to dispatch.
 * @template TParam The parameter names of the requested URL.
 * @since 0.7.0
 */
export type ObjectDispatcher<
  TContextData,
  TObject extends Object,
  TParam extends string,
> = (
  context: RequestContext<TContextData>,
  values: Record<TParam, string>,
) => TObject | null | Promise<TObject | null>;

/**
 * A callback that dispatches a collection.
 *
 * @template TItem The type of items in the collection.
 * @template TContext The type of the context. {@link Context} or
 *                     {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @template TFilter The type of the filter, if any.
 * @param context The context.
 * @param identifier The internal identifier or the username of the collection
 *                   owner.
 * @param cursor The cursor to start the collection from, or `null` to dispatch
 *               the entire collection without pagination.
 * @param filter The filter to apply to the collection, if any.
 */
export type CollectionDispatcher<
  TItem,
  TContext extends Context<TContextData>,
  TContextData,
  TFilter,
> = (
  context: TContext,
  identifier: string,
  cursor: string | null,
  filter?: TFilter,
) => PageItems<TItem> | null | Promise<PageItems<TItem> | null>;

/**
 * A callback that counts the number of items in a collection.
 *
 * @template TContextData The context data to pass to the {@link Context}.
 * @param context The context.
 * @param identifier The internal identifier or the username of the collection
 *                   owner.
 * @param filter The filter to apply to the collection, if any.
 */
export type CollectionCounter<TContextData, TFilter> = (
  context: RequestContext<TContextData>,
  identifier: string,
  filter?: TFilter,
) => number | bigint | null | Promise<number | bigint | null>;

/**
 * A callback that returns a cursor for a collection.
 *
 * @template TContext The type of the context. {@link Context} or
 *                     {@link RequestContext}.
 * @template TContextData The context data to pass to the {@link Context}.
 * @template TFilter The type of the filter, if any.
 * @param context The context.
 * @param identifier The internal identifier or the username of the collection
 *                   owner.
 * @param filter The filter to apply to the collection, if any.
 */
export type CollectionCursor<
  TContext extends Context<TContextData>,
  TContextData,
  TFilter,
> = (
  context: TContext,
  identifier: string,
  filter?: TFilter,
) => string | null | Promise<string | null>;

/**
 * A callback that listens for activities in an inbox.
 *
 * @template TContextData The context data to pass to the {@link Context}.
 * @template TActivity The type of activity to listen for.
 * @param context The inbox context.
 * @param activity The activity that was received.
 */
export type InboxListener<TContextData, TActivity extends Activity> = (
  context: InboxContext<TContextData>,
  activity: TActivity,
) => void | Promise<void>;

/**
 * A callback that handles errors in an inbox.
 *
 * @template TContextData The context data to pass to the {@link Context}.
 * @param context The inbox context.
 */
export type InboxErrorHandler<TContextData> = (
  context: Context<TContextData>,
  error: Error,
) => void | Promise<void>;

/**
 * A callback that dispatches the key pair for the authenticated document loader
 * of the {@link Context} passed to the shared inbox listener.
 *
 * @template TContextData The context data to pass to the {@link Context}.
 * @param context The context.
 * @returns The username or the internal identifier of the actor or the key pair
 *          for the authenticated document loader of the {@link Context} passed
 *          to the shared inbox listener.  If `null` is returned, the request is
 *          not authorized.
 * @since 0.11.0
 */
export type SharedInboxKeyDispatcher<TContextData> = (
  context: Context<TContextData>,
) =>
  | SenderKeyPair
  | { identifier: string }
  | { username: string }
  | { handle: string }
  | null
  | Promise<
    | SenderKeyPair
    | { identifier: string }
    | { username: string }
    | { handle: string }
    | null
  >;

/**
 * A callback that handles errors during outbox processing.
 *
 * @param error The error that occurred.
 * @param activity The activity that caused the error.  If it is `null`, the
 *                 error occurred during deserializing the activity.
 * @since 0.6.0
 */
export type OutboxErrorHandler = (
  error: Error,
  activity: Activity | null,
) => void | Promise<void>;

/**
 * A callback that determines if a request is authorized or not.
 *
 * @template TContextData The context data to pass to the {@link Context}.
 * @param context The request context.
 * @param identifier The internal identifier of the actor that is being requested.
 * @param signedKey *Deprecated in Fedify 1.5.0 in favor of
 *                  {@link RequestContext.getSignedKey} method.*
 *                  The key that was used to sign the request, or `null` if
 *                  the request was not signed or the signature was invalid.
 * @param signedKeyOwner *Deprecated in Fedify 1.5.0 in favor of
 *                       {@link RequestContext.getSignedKeyOwner} method.*
 *                       The actor that owns the key that was used to sign the
 *                       request, or `null` if the request was not signed or the
 *                       signature was invalid, or if the key is not associated
 *                       with an actor.
 * @returns `true` if the request is authorized, `false` otherwise.
 * @since 0.7.0
 */
export type AuthorizePredicate<TContextData> = (
  context: RequestContext<TContextData>,
  identifier: string,
  signedKey: CryptographicKey | null,
  signedKeyOwner: Actor | null,
) => boolean | Promise<boolean>;

/**
 * A callback that determines if a request is authorized or not.
 *
 * @template TContextData The context data to pass to the {@link Context}.
 * @template TParam The parameter names of the requested URL.
 * @param context The request context.
 * @param values The parameters of the requested URL.
 * @param signedKey *Deprecated in Fedify 1.5.0 in favor of
 *                  {@link RequestContext.getSignedKey} method.*
 *                  The key that was used to sign the request, or `null` if
 *                  the request was not signed or the signature was invalid.
 * @param signedKeyOwner *Deprecated in Fedify 1.5.0 in favor of
 *                       {@link RequestContext.getSignedKeyOwner} method.*
 *                       The actor that owns the key that was used to sign the
 *                       request, or `null` if the request was not signed or the
 *                       signature was invalid, or if the key is not associated
 *                       with an actor.
 * @returns `true` if the request is authorized, `false` otherwise.
 * @since 0.7.0
 */
export type ObjectAuthorizePredicate<TContextData, TParam extends string> = (
  context: RequestContext<TContextData>,
  values: Record<TParam, string>,
  signedKey: CryptographicKey | null,
  signedKeyOwner: Actor | null,
) => boolean | Promise<boolean>;

/**
 * A callback that dispatches a custom collection.
 *
 * @template TItem The type of items in the collection.
 * @template TParams The parameter names of the requested URL.
 * @template TContext The type of the context. {@link Context} or
 *                     {@link RequestContext}.
 * @template TContextData The context data to pass to the `TContext`.
 * @template TFilter The type of the filter, if any.
 * @param context The context.
 * @param values The parameters of the requested URL.
 * @param cursor The cursor to start the collection from, or `null` to dispatch
 *               the entire collection without pagination.
 * @since 1.8.0
 */
export type CustomCollectionDispatcher<
  TItem,
  TParam extends string,
  TContext extends Context<TContextData>,
  TContextData,
> = (
  context: TContext,
  values: Record<TParam, string>,
  cursor: string | null,
) => PageItems<TItem> | null | Promise<PageItems<TItem> | null>;

/**
 * A callback that counts the number of items in a custom collection.
 *
 * @template TParams The parameter names of the requested URL.
 * @template TContextData The context data to pass to the {@link Context}.
 * @param context The context.
 * @param values The parameters of the requested URL.
 * @since 1.8.0
 */
export type CustomCollectionCounter<
  TParam extends string,
  TContextData,
> = (
  context: RequestContext<TContextData>,
  values: Record<TParam, string>,
) => number | bigint | null | Promise<number | bigint | null>;

/**
 * A callback that returns a cursor for a custom collection.
 *
 * @template TParams The parameter names of the requested URL.
 * @template TContext The type of the context. {@link Context} or
 *                     {@link RequestContext}.
 * @template TContextData The context data to pass to the {@link Context}.
 * @template TFilter The type of the filter, if any.
 * @param context The context.
 * @param values The parameters of the requested URL.
 * @since 1.8.0
 */
export type CustomCollectionCursor<
  TParam extends string,
  TContext extends Context<TContextData>,
  TContextData,
> = (
  context: TContext,
  values: Record<TParam, string>,
) => string | null | Promise<string | null>;
