// deno-lint-ignore-file no-empty no-import-prefix
import {
  Collection,
  getActorHandle,
  isActor,
  lookupObject,
  PropertyValue,
} from "@fedify/fedify/vocab";
import { convert } from "npm:html-to-text@^9.0.5";

export interface Actor {
  handle: string;
  url: URL | null;
  name: string;
  bio: string;
  following: number | null;
  followers: number | null;
  posts: number | null;
  properties: Record<string, string>;
  joined: Temporal.Instant | null;
}

async function lookupActor(handle: string): Promise<Actor> {
  const actor = await lookupObject(handle);
  if (!isActor(actor)) throw new TypeError("Not an actor!");
  let following: Collection | null = null;
  try {
    following = await actor.getFollowing();
  } catch {}
  let followers: Collection | null = null;
  try {
    followers = await actor.getFollowers();
  } catch {}
  let posts: Collection | null = null;
  try {
    posts = await actor.getOutbox();
  } catch {}
  const properties: Record<string, string> = {};
  for await (const attachment of actor.getAttachments()) {
    if (attachment instanceof PropertyValue && attachment.name != null) {
      properties[attachment.name] = convert(attachment.value ?? "", {
        selectors: [{ selector: "a", options: { ignoreHref: true } }],
      });
    }
  }
  return {
    handle: await getActorHandle(actor),
    url: actor.url,
    name: actor.name ?? "",
    bio: convert(actor.summary ?? "", {
      selectors: [{ selector: "a", options: { ignoreHref: true } }],
    }),
    following: following?.totalItems,
    followers: followers?.totalItems,
    posts: posts?.totalItems,
    properties,
    joined: actor.published,
  };
}

function displayActor(actor: Actor): void {
  console.log(actor.name);
  console.log(actor.handle);
  if (actor.url) console.log(actor.url.href);
  console.log();
  console.log(actor.bio);
  console.log();
  if (actor.joined) console.log(`Joined: ${actor.joined.toLocaleString()}`);
  if (actor.following) console.log(`Following: ${actor.following}`);
  if (actor.followers) console.log(`Followers: ${actor.followers}`);
  if (actor.posts) console.log(`Posts: ${actor.posts}`);
  if (Object.keys(actor.properties).length > 0) {
    console.log();
    for (const name in actor.properties) {
      console.log(`${name}: ${actor.properties[name]}`);
    }
  }
}

async function main() {
  if (Deno.args.length < 1) {
    console.error("Usage: deno run -A main.ts HANDLE");
    Deno.exit(1);
  }
  const handle = Deno.args[0];
  if (!handle.match(/^@?[^@]+@[^@]+$/)) {
    console.error("Invalid handle:", handle);
    Deno.exit(1);
  }
  const actor = await lookupActor(handle);
  displayActor(actor);
}

if (import.meta.main) await main();
