import type { Federation } from "@fedify/fedify/federation";
import { Create, Follow, Note, Undo } from "@fedify/vocab";
import { store } from "./store.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Build recipient manually — in non-strict mode Mastodon's WebFinger requires
// HTTPS but our harness only has HTTP, so we use http:// for the inbox URL.
// In strict mode, Caddy terminates TLS, so we use https:// everywhere.
function parseRecipient(
  handle: string,
): { inboxId: URL; actorId: URL } {
  const [user, domain] = handle.split("@");
  const scheme = Deno.env.get("STRICT_MODE") ? "https" : "http";
  const inboxId = new URL(`${scheme}://${domain}/users/${user}/inbox`);
  // Mastodon generates https:// actor URIs; use that as the canonical id
  const actorId = new URL(`https://${domain}/users/${user}`);
  return { inboxId, actorId };
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

    const { actorId, inboxId } = parseRecipient(to);
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

    const { actorId, inboxId } = parseRecipient(target);
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

    const { actorId, inboxId } = parseRecipient(target);
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
