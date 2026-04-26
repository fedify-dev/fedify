import { Person } from "@fedify/vocab";
import { getQuery, toWebRequest } from "h3";
import federation from "../federation";
import { followingStore } from "../store";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const raw = Array.isArray(query.q) ? query.q[0] : query.q;
  const q = typeof raw === "string" ? raw.trim() : "";
  if (!q) {
    return { result: null };
  }

  const request = toWebRequest(event);
  const ctx = federation.createContext(request, undefined);

  try {
    const target = await ctx.lookupObject(q);
    if (target instanceof Person && target.id) {
      const iconUrl = await target.getIcon(ctx);
      return {
        result: {
          uri: target.id.href,
          name: target.name?.toString() ?? null,
          handle: target.preferredUsername
            ? `@${target.preferredUsername}@${target.id.hostname}`
            : target.id.href,
          icon: iconUrl?.url?.href ?? null,
          isFollowing: followingStore.has(target.id.href),
        },
      };
    }
  } catch (error) {
    console.debug("Actor lookup failed:", q, error);
  }

  return { result: null };
});
