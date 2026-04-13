import { toWebRequest } from "h3";
import federation from "../federation";
import { followingStore, postStore, relationStore } from "../store";

export default defineEventHandler(async (event) => {
  const request = toWebRequest(event);
  const ctx = federation.createContext(request, undefined);
  const identifier = "demo";
  const actorUri = ctx.getActorUri(identifier);
  const host = new URL(actorUri).host;

  const followers = await Promise.all(
    Array.from(relationStore.entries()).map(async ([uri, person]) => ({
      uri,
      name: person.name?.toString() ?? null,
      handle: person.preferredUsername
        ? `@${person.preferredUsername}@${person.id?.hostname ?? ""}`
        : uri,
      icon: (await person.getIcon(ctx))?.url?.href ?? null,
    })),
  );

  const following = await Promise.all(
    Array.from(followingStore.entries()).map(async ([uri, person]) => ({
      uri,
      name: person.name?.toString() ?? null,
      handle: person.preferredUsername
        ? `@${person.preferredUsername}@${person.id?.hostname ?? ""}`
        : uri,
      icon: (await person.getIcon(ctx))?.url?.href ?? null,
    })),
  );

  const allPosts = postStore.getAll();
  const posts = allPosts.map((p) => ({
    url: p.url?.href ?? p.id?.href ?? "",
    id: p.id?.href ?? "",
    content: p.content?.toString() ?? "",
    published: p.published?.toString() ?? null,
  }));

  return {
    identifier,
    host,
    name: "Fedify Demo",
    summary: "This is a Fedify Demo account.",
    followers,
    following,
    posts,
  };
});
