import type { Federation } from "@fedify/fedify/federation";
import { Create, Follow, Note, Undo } from "@fedify/vocab";
import { resetFederationTestState } from "./federation.ts";
import { store } from "./store.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Resolve a handle (user@domain) to the correct actor URI and inbox URL
// via WebFinger + actor document fetch.  Falls back to the Mastodon URL
// convention (/users/{username}) when WebFinger is unavailable.
const recipientCache = new Map<string, { inboxId: URL; actorId: URL }>();

async function parseRecipient(
  handle: string,
): Promise<{ inboxId: URL; actorId: URL }> {
  const cached = recipientCache.get(handle);
  if (cached) return cached;

  const [user, domain] = handle.split("@");
  const scheme = Deno.env.get("STRICT_MODE") ? "https" : "http";

  // Try WebFinger resolution first — this discovers the correct actor URI
  // regardless of server software (Mastodon, Sharkey, etc.)
  try {
    const wfUrl = `${scheme}://${domain}/.well-known/webfinger?resource=${
      encodeURIComponent(`acct:${handle}`)
    }`;
    const wfRes = await fetch(wfUrl, {
      headers: { Accept: "application/jrd+json" },
    });
    if (wfRes.ok) {
      const wf = await wfRes.json() as {
        links?: { rel: string; type?: string; href?: string }[];
      };
      const self = wf.links?.find(
        (l) => l.rel === "self" && l.type === "application/activity+json",
      );
      if (self?.href) {
        const actorId = new URL(self.href);
        // Fetch the actor document to discover the inbox URL
        const actorRes = await fetch(self.href, {
          headers: { Accept: "application/activity+json" },
        });
        if (actorRes.ok) {
          const actor = await actorRes.json() as { inbox?: string };
          if (actor.inbox) {
            const result = { inboxId: new URL(actor.inbox), actorId };
            recipientCache.set(handle, result);
            return result;
          }
        }
      }
    }
  } catch {
    // WebFinger failed; fall back to Mastodon convention
  }

  // Fallback: construct URLs using Mastodon convention
  const inboxId = new URL(`${scheme}://${domain}/users/${user}/inbox`);
  const actorId = new URL(`https://${domain}/users/${user}`);
  const result = { inboxId, actorId };
  recipientCache.set(handle, result);
  return result;
}

export async function handleBackdoor(
  request: Request,
  federation: Federation<void>,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/_test/health") {
    return new Response("OK");
  }

  if (url.pathname === "/_test/reset" && request.method === "POST") {
    store.clear();
    recipientCache.clear();
    await resetFederationTestState();
    return json({ ok: true });
  }

  if (url.pathname === "/_test/inbox") {
    return json(store.all());
  }

  if (url.pathname === "/_test/inbox/latest") {
    const item = store.latest();
    if (item == null) return json(null, 404);
    return json(item);
  }

  if (url.pathname === "/_test/create-note" && request.method === "POST") {
    const body = await request.json();
    const { to, content } = body as { to: string; content: string };

    const ctx = federation.createContext(
      new URL(request.url),
      undefined as void,
    );

    const { actorId, inboxId } = await parseRecipient(to);
    const recipient = { id: actorId, inboxId };

    const noteId = crypto.randomUUID();
    const note = new Note({
      id: new URL(`${ctx.canonicalOrigin}/notes/${noteId}`),
      attribution: ctx.getActorUri("testuser"),
      content,
      to: new URL("https://www.w3.org/ns/activitystreams#Public"),
      ccs: [actorId],
    });

    const activity = new Create({
      id: new URL(`${ctx.canonicalOrigin}/activities/${noteId}`),
      actor: ctx.getActorUri("testuser"),
      object: note,
      to: new URL("https://www.w3.org/ns/activitystreams#Public"),
      ccs: [actorId],
    });

    try {
      await ctx.sendActivity(
        { identifier: "testuser" },
        recipient,
        activity,
        { immediate: true },
      );
    } catch (e) {
      return json({ error: `Failed to send: ${e}` }, 500);
    }

    return json({ ok: true, noteId });
  }

  if (url.pathname === "/_test/follow" && request.method === "POST") {
    const body = await request.json();
    const { target } = body as { target: string };

    const ctx = federation.createContext(
      new URL(request.url),
      undefined as void,
    );

    const { actorId, inboxId } = await parseRecipient(target);
    const recipient = { id: actorId, inboxId };

    const follow = new Follow({
      id: new URL(
        `${ctx.canonicalOrigin}/activities/${crypto.randomUUID()}`,
      ),
      actor: ctx.getActorUri("testuser"),
      object: actorId,
    });

    try {
      await ctx.sendActivity(
        { identifier: "testuser" },
        recipient,
        follow,
        { immediate: true },
      );
    } catch (e) {
      return json({ error: `Failed to send: ${e}` }, 500);
    }

    return json({ ok: true });
  }

  if (url.pathname === "/_test/unfollow" && request.method === "POST") {
    const body = await request.json();
    const { target } = body as { target: string };

    const ctx = federation.createContext(
      new URL(request.url),
      undefined as void,
    );

    const { actorId, inboxId } = await parseRecipient(target);
    const recipient = { id: actorId, inboxId };

    const undo = new Undo({
      id: new URL(
        `${ctx.canonicalOrigin}/activities/${crypto.randomUUID()}`,
      ),
      actor: ctx.getActorUri("testuser"),
      object: new Follow({
        actor: ctx.getActorUri("testuser"),
        object: actorId,
      }),
    });

    try {
      await ctx.sendActivity(
        { identifier: "testuser" },
        recipient,
        undo,
        { immediate: true },
      );
    } catch (e) {
      return json({ error: `Failed to send: ${e}` }, 500);
    }

    return json({ ok: true });
  }

  return new Response("Not Found", { status: 404 });
}
