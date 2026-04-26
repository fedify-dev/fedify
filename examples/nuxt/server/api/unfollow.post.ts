import { Follow, type Object as APObject, Undo } from "@fedify/vocab";
import { readBody, sendRedirect, toWebRequest } from "h3";
import federation from "../federation";
import { broadcastEvent } from "../sse";
import { followingStore } from "../store";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ uri?: unknown }>(event);
  const targetUri = body?.uri;
  if (typeof targetUri !== "string" || !targetUri.trim()) {
    return sendRedirect(event, "/", 303);
  }

  const request = toWebRequest(event);
  const ctx = federation.createContext(request, undefined);
  const identifier = "demo";

  let target: APObject | null = null;
  try {
    target = await ctx.lookupObject(targetUri) as APObject | null;
  } catch {
    return sendRedirect(event, "/", 303);
  }
  if (target?.id == null) {
    return sendRedirect(event, "/", 303);
  }

  try {
    await ctx.sendActivity(
      { identifier },
      target,
      new Undo({
        id: new URL(
          `#undo-follows/${target.id.href}`,
          ctx.getActorUri(identifier),
        ),
        actor: ctx.getActorUri(identifier),
        object: new Follow({
          id: new URL(
            `#follows/${target.id.href}`,
            ctx.getActorUri(identifier),
          ),
          actor: ctx.getActorUri(identifier),
          object: target.id,
        }),
      }),
    );
  } catch {
    // Delivery failure is non-fatal; continue updating local state.
  }

  followingStore.delete(target.id.href);
  broadcastEvent();
  return sendRedirect(event, "/", 303);
});
