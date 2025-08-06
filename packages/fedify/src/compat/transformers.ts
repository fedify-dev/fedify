import { getLogger } from "@logtape/logtape";
import type { Context } from "../federation/context.ts";
import type { Activity } from "../vocab/vocab.ts";
import type { ActivityTransformer } from "./types.ts";

const logger = getLogger(["fedify", "compat", "transformers"]);

/**
 * An activity transformer that assigns a new random ID to an activity if it
 * does not already have one.  This is useful for ensuring that activities
 * have an ID before they are sent to other servers.
 *
 * The generated ID is an origin URI with a fragment which contains an activity
 * type name with a random UUID:
 *
 * ```
 * https://example.com/#Follow/12345678-1234-5678-1234-567812345678
 * ```
 *
 * @template TContextData The type of the context data.
 * @param activity The activity to assign an ID to.
 * @param context The context of the activity.
 * @return The activity with an ID assigned.
 * @since 1.4.0
 */
export function autoIdAssigner<TContextData>(
  activity: Activity,
  context: Context<TContextData>,
): Activity {
  if (activity.id != null) return activity;
  const id = new URL(
    `/#${activity.constructor.name}/${crypto.randomUUID()}`,
    context.origin,
  );
  logger.warn(
    "As the activity to send does not have an id, a new id {id} has " +
      "been generated for it.  However, it is recommended to explicitly " +
      "set the id for the activity.",
    { id: id.href },
  );
  return activity.clone({ id });
}

/**
 * An activity transformer that dehydrates the actor property of an activity
 * so that it only contains the actor's URI.  For example, suppose we have an
 * activity like this:
 *
 * ```typescript
 * import { Follow, Person } from "@fedify/fedify/vocab";
 * const input = new Follow({
 *   id: new URL("http://example.com/activities/1"),
 *   actor: new Person({
 *     id: new URL("http://example.com/actors/1"),
 *     name: "Alice",
 *     preferredUsername: "alice",
 *   }),
 *   object: new Person({
 *     id: new URL("http://example.com/actors/2"),
 *     name: "Bob",
 *     preferredUsername: "bob",
 *   }),
 * });
 * ```
 *
 * The result of applying this transformer would be:
 *
 * ```typescript
 * import { Follow, Person } from "@fedify/fedify/vocab";
 * const output = new Follow({
 *   id: new URL("http://example.com/activities/1"),
 *   actor: new URL("http://example.com/actors/1"),
 *   object: new Person({
 *     id: new URL("http://example.com/actors/2"),
 *     name: "Bob",
 *     preferredUsername: "bob",
 *   }),
 * });
 * ```
 *
 * As some ActivityPub implementations like Threads fail to deal with inlined
 * actor objects, this transformer can be used to work around this issue.
 * @template TContextData The type of the context data.
 * @param activity The activity to dehydrate the actor property of.
 * @param context The context of the activity.
 * @returns The dehydrated activity.
 * @since 1.4.0
 */
export function actorDehydrator<TContextData>(
  activity: Activity,
  _context: Context<TContextData>,
): Activity {
  if (activity.actorIds.length < 1) return activity;
  return activity.clone({
    actors: activity.actorIds,
  });
}

/**
 * Gets the default activity transformers that are applied to all outgoing
 * activities.
 * @template TContextData The type of the context data.
 * @returns The default activity transformers.
 * @since 1.4.0
 */
export function getDefaultActivityTransformers<
  TContextData,
>(): readonly ActivityTransformer<TContextData>[] {
  return [
    autoIdAssigner,
    actorDehydrator,
  ];
}
