import type { Federation } from "@fedify/fedify/federation";
import { Create, Follow, Note, Undo } from "@fedify/vocab";
import { store } from "./store.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

    // Build the recipient manually — Mastodon's WebFinger requires HTTPS
    // but we only have HTTP.  Parse the handle (user@domain) to construct
    // the actor URI and inbox URL directly.
    const [user, domain] = to.split("@");
    const inboxUrl = new URL(`http://${domain}/users/${user}/inbox`);
    // Mastodon generates https:// actor URIs; use that as the canonical id
    const actorId = new URL(`https://${domain}/users/${user}`);
    const recipient = { id: actorId, inboxId: inboxUrl };

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

    const [user, domain] = target.split("@");
    const inboxUrl = new URL(`http://${domain}/users/${user}/inbox`);
    const actorId = new URL(`https://${domain}/users/${user}`);
    const recipient = { id: actorId, inboxId: inboxUrl };

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

    const [user, domain] = target.split("@");
    const inboxUrl = new URL(`http://${domain}/users/${user}/inbox`);
    const actorId = new URL(`https://${domain}/users/${user}`);
    const recipient = { id: actorId, inboxId: inboxUrl };

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
