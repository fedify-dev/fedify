import type { InteractionAuthorizationKey, InteractionKey } from "./types.ts";

export function formatInteractionKey(key: InteractionKey): string {
  return JSON.stringify([
    key.interaction,
    key.requester.href,
    key.interactingObjectId.href,
    key.interactionTargetId.href,
  ]);
}

export function formatAuthorizationKey(
  key: InteractionAuthorizationKey,
): string {
  return JSON.stringify([key.interaction, key.authorizationId.href]);
}
