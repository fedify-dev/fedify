import { Create, Note } from "@fedify/vocab";
import {
  defineEventHandler,
  readBody,
  sendRedirect,
  toWebRequest,
} from "@nuxt/nitro-server/h3";
import federation from "../federation.ts";
import { broadcastEvent } from "../sse.ts";
import { postStore } from "../store.ts";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const content = body?.content;
  if (typeof content !== "string" || !content.trim()) {
    return sendRedirect(event, "/", 303);
  }

  const request = toWebRequest(event);
  const ctx = federation.createContext(request, undefined);
  const identifier = "demo";
  const id = crypto.randomUUID();
  const attribution = ctx.getActorUri(identifier);
  const url = new URL(`/users/${identifier}/posts/${id}`, attribution);
  const post = new Note({
    id: url,
    attribution,
    content: content.trim(),
    url,
  });
  postStore.append([post]);
  broadcastEvent();
  try {
    const note = await ctx.getObject(Note, { identifier, id });
    await ctx.sendActivity(
      { identifier },
      "followers",
      new Create({
        id: new URL(`#create/${id}`, attribution),
        object: note,
        actors: note?.attributionIds,
        tos: note?.toIds,
        ccs: note?.ccIds,
      }),
    );
  } catch {
    // Delivery failure is non-fatal; local state is already updated.
  }

  return sendRedirect(event, "/", 303);
});
