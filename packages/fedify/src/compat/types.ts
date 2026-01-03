import type { Activity } from "@fedify/vocab";
import type { Context } from "../federation/context.ts";

/**
 * A function that transforms an activity object.
 * @since 1.4.0
 */
export type ActivityTransformer<TContextData> = (
  activity: Activity,
  context: Context<TContextData>,
) => Activity;
