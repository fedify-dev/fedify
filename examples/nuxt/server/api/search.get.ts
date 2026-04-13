import { Person } from "@fedify/vocab";
import { getQuery, toWebRequest } from "h3";
import federation from "../federation";
import { followingStore } from "../store";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const q = query.q as string | undefined;
  if (!q || !q.trim()) {
    return { result: null };
  }

  const request = toWebRequest(event);
  const ctx = federation.createContext(request, undefined);

  try {
    const target = await ctx.lookupObject(q.trim());
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
  } catch {
    // lookup failed
  }

  return { result: null };
});
