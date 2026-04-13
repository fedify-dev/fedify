import { toWebRequest } from "h3";
import federation from "../../federation";
import { followingStore, relationStore } from "../../store";

export default defineEventHandler(async (event) => {
  const identifier = event.context.params?.identifier as string;
  if (identifier !== "demo") {
    return null;
  }

  const request = toWebRequest(event);
  const ctx = federation.createContext(request, undefined);
  const actor = await ctx.getActor(identifier);
  if (!actor) return null;

  const icon = await actor.getIcon(ctx);
  const actorUri = ctx.getActorUri(identifier);
  const host = new URL(actorUri).host;

  return {
    identifier,
    host,
    name: actor.name?.toString() ?? "Fedify Demo",
    summary: actor.summary?.toString() ?? null,
    icon: icon?.url?.href ?? null,
    followingCount: followingStore.size,
    followersCount: relationStore.size,
  };
});
