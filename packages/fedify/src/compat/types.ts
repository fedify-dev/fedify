import type { Context } from "../federation/context.ts";
import type { Activity } from "../vocab/vocab.ts";

/**
 * A function that transforms an activity object.
 * @since 1.4.0
 */
export type ActivityTransformer<TContextData> = (
  activity: Activity,
  context: Context<TContextData>,
) => Activity;
