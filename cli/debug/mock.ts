import type { Activity, Context } from "@fedify/fedify";

/**
 * Mock context for testing
 */
export function createMockContext(): Context<unknown> {
  return {
    // Add minimal required context properties for testing
    // This is a simplified version for testing purposes
  } as unknown as Context<unknown>;
}

/**
 * Create a mock Create activity
 */
export function createMockCreateActivity(
  id: string,
  actor: string,
  content: string,
): Activity {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    id: id,
    actor: actor,
    object: {
      type: "Note",
      content: content,
    },
    published: new Date().toISOString(),
  } as unknown as Activity;
}

/**
 * Create a mock Follow activity
 */
export function createMockFollowActivity(
  id: string,
  actor: string,
  object: string,
): Activity {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Follow",
    id: id,
    actor: actor,
    object: object,
    published: new Date().toISOString(),
  } as unknown as Activity;
}

/**
 * Create a generic mock activity
 */
export function createMockActivity(
  type: string,
  id: string,
  actor?: string,
): Activity {
  const activity: Record<string, unknown> = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: type,
    id: id,
  };

  if (actor) {
    activity.actor = actor;
  }

  activity.published = new Date().toISOString();

  return activity as unknown as Activity;
}
