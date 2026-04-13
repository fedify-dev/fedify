import { Note } from "@fedify/vocab";
import { toWebRequest } from "h3";
import federation from "../../../federation";

export default defineEventHandler(async (event) => {
  const identifier = event.context.params?.identifier as string;
  const id = event.context.params?.id as string;
  if (identifier !== "demo" || !id) {
    return null;
  }

  const request = toWebRequest(event);
  const ctx = federation.createContext(request, undefined);
  const actor = await ctx.getActor(identifier);
  const noteObj = await ctx.getObject(Note, { identifier, id });
  if (!actor || !noteObj) return null;

  const icon = await actor.getIcon(ctx);
  const actorUri = ctx.getActorUri(identifier);
  const host = new URL(actorUri).host;

  return {
    identifier,
    host,
    author: {
      name: actor.name?.toString() ?? "Fedify Demo",
      icon: icon?.url?.href ?? null,
    },
    content: noteObj.content?.toString() ?? "",
    published: noteObj.published?.toString() ?? null,
    url: noteObj.url?.href ?? noteObj.id?.href ?? "",
  };
});
