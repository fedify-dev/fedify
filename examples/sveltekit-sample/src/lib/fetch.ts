import { type RequestContext } from "@fedify/fedify";
import { Note } from "@fedify/vocab";
import type { Post, User } from "./types";
import { postStore } from "./store";

export const getUser = async (
  ctx: RequestContext<unknown>,
  identifier: string,
): Promise<User> => await (await ctx.getActor(identifier))?.toJsonLd() as User;

export const getPost = async (
  ctx: RequestContext<unknown>,
  identifier: string,
  id: string,
): Promise<Post> =>
  await (await ctx.getObject(Note, { id, identifier }))?.toJsonLd() as Post;

export const getPosts = async (
  author: User,
) =>
  (await Array.fromAsync(
    postStore.getAll(),
    (p) => p.toJsonLd() as Promise<Post>,
  )).map((p) => ({ ...p, author } as Post & { author: User }));
