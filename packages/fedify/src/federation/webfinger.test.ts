import { test } from "@fedify/fixture";
import type { Actor } from "@fedify/vocab";
import { Image, Link, Person } from "@fedify/vocab";
import { assertEquals } from "@std/assert";
import type {
  ActorAliasMapper,
  ActorDispatcher,
  ActorHandleMapper,
  WebFingerLinksDispatcher,
} from "../federation/callback.ts";
import type { RequestContext } from "../federation/context.ts";
import { MemoryKvStore } from "../federation/kv.ts";
import { createFederation } from "../federation/middleware.ts";
import { createRequestContext } from "../testing/context.ts";
import { handleWebFinger } from "./webfinger.ts";

test("handleWebFinger()", async (t) => {
  const url = new URL("https://example.com/.well-known/webfinger");

  function createContext(url: URL): RequestContext<void> {
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    const context = createRequestContext<void>({
      federation,
      url,
      data: undefined,
      getActorUri(identifier) {
        return new URL(`${url.origin}/users/${identifier}`);
      },
      async getActor(handle): Promise<Actor | null> {
        return await actorDispatcher(
          context,
          handle,
        );
      },
      parseUri(uri) {
        if (uri == null) return null;
        if (uri.protocol === "acct:") return null;
        if (!uri.pathname.startsWith("/users/")) return null;
        const paths = uri.pathname.split("/");
        const identifier = paths[paths.length - 1];
        return {
          type: "actor",
          identifier,
        };
      },
    });
    return context;
  }

  const actorDispatcher: ActorDispatcher<void> = (ctx, identifier) => {
    if (identifier !== "someone" && identifier !== "someone2") return null;
    const actorUri = ctx.getActorUri(identifier);
    return new Person({
      id: actorUri,
      name: identifier === "someone" ? "Someone" : "Someone 2",
      preferredUsername: identifier === "someone"
        ? null
        : identifier === "someone2"
        ? "bar"
        : null,
      icon: new Image({
        url: new URL(`${actorUri.origin}/icon.jpg`),
        mediaType: "image/jpeg",
      }),
      urls: [
        new URL(`${actorUri.origin}/@${identifier}`),
        new Link({
          href: new URL(`${actorUri.origin}/@${identifier}`),
          rel: "alternate",
          mediaType: "text/html",
        }),
      ],
    });
  };
  let onNotFoundCalled: Request | null = null;
  const onNotFound = (request: Request) => {
    onNotFoundCalled = request;
    return new Response("Not found", { status: 404 });
  };

  await t.step("no actor dispatcher", async () => {
    const context = createContext(url);
    const request = context.request;
    const response = await handleWebFinger(request, {
      context,
      onNotFound,
    });
    assertEquals(response.status, 404);
    assertEquals(onNotFoundCalled, request);
  });

  onNotFoundCalled = null;
  await t.step("no resource", async () => {
    const context = createContext(url);
    const request = context.request;
    const response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 400);
    assertEquals(await response.text(), "Missing resource parameter.");
    assertEquals(onNotFoundCalled, null);
  });

  await t.step("invalid resource", async () => {
    const u = new URL(url);
    u.searchParams.set("resource", " invalid ");
    const context = createContext(u);
    const request = new Request(u);
    const response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 400);
    assertEquals(await response.text(), "Invalid resource URL.");
    assertEquals(onNotFoundCalled, null);
  });

  const expected = {
    subject: "acct:someone@example.com",
    aliases: [
      "https://example.com/users/someone",
    ],
    links: [
      {
        href: "https://example.com/users/someone",
        rel: "self",
        type: "application/activity+json",
      },
      {
        href: "https://example.com/@someone",
        rel: "http://webfinger.net/rel/profile-page",
      },
      {
        href: "https://example.com/@someone",
        rel: "alternate",
        type: "text/html",
      },
      {
        href: "https://example.com/icon.jpg",
        rel: "http://webfinger.net/rel/avatar",
        type: "image/jpeg",
      },
    ],
  };

  await t.step("ok: resource=acct:...", async () => {
    const u = new URL(url);
    u.searchParams.set("resource", "acct:someone@example.com");
    const context = createContext(u);
    const request = context.request;
    const response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Content-Type"), "application/jrd+json");
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
    assertEquals(await response.json(), expected);
  });

  const expected2 = {
    subject: "https://example.com/users/someone2",
    aliases: [
      "acct:bar@example.com",
    ],
    links: [
      {
        href: "https://example.com/users/someone2",
        rel: "self",
        type: "application/activity+json",
      },
      {
        href: "https://example.com/@someone2",
        rel: "http://webfinger.net/rel/profile-page",
      },
      {
        href: "https://example.com/@someone2",
        rel: "alternate",
        type: "text/html",
      },
      {
        href: "https://example.com/icon.jpg",
        rel: "http://webfinger.net/rel/avatar",
        type: "image/jpeg",
      },
    ],
  };

  await t.step("ok: resource=https:...", async () => {
    const u = new URL(url);
    u.searchParams.set("resource", "https://example.com/users/someone");
    let context = createContext(u);
    let request = context.request;
    let response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ...expected,
      aliases: [],
      subject: "https://example.com/users/someone",
    });

    u.searchParams.set("resource", "https://example.com/users/someone2");
    context = createContext(u);
    request = context.request;
    response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), expected2);
  });

  await t.step("not found: resource=acct:...", async () => {
    const u = new URL(url);
    u.searchParams.set("resource", "acct:no-one@example.com");
    const context = createContext(u);
    const request = context.request;
    const response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 404);
    assertEquals(onNotFoundCalled, request);
  });

  onNotFoundCalled = null;

  await t.step("not found: resource=http:...", async () => {
    const u = new URL(url);
    u.searchParams.set("resource", "https://example.com/users/no-one");
    let context = createContext(u);
    let request = context.request;
    let response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 404);
    assertEquals(onNotFoundCalled, request);

    onNotFoundCalled = null;

    u.searchParams.set("resource", "https://google.com/");
    context = createContext(u);
    request = context.request;
    response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 404);
    assertEquals(onNotFoundCalled, request);
  });

  onNotFoundCalled = null;

  const actorHandleMapper: ActorHandleMapper<void> = (_ctx, username) => {
    return username === "foo"
      ? "someone"
      : username === "bar"
      ? "someone2"
      : null;
  };

  await t.step("handle mapper", async () => {
    const u = new URL(url);
    u.searchParams.set("resource", "acct:foo@example.com");
    let context = createContext(u);
    let request = context.request;
    let response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      actorHandleMapper,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ...expected,
      aliases: ["https://example.com/users/someone"],
      subject: "acct:foo@example.com",
    });

    u.searchParams.set("resource", "acct:bar@example.com");
    context = createContext(u);
    request = context.request;
    response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      actorHandleMapper,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ...expected2,
      aliases: ["https://example.com/users/someone2"],
      subject: "acct:bar@example.com",
    });

    u.searchParams.set("resource", "https://example.com/users/someone");
    context = createContext(u);
    request = context.request;
    response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      actorHandleMapper,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ...expected,
      aliases: [],
      subject: "https://example.com/users/someone",
    });

    u.searchParams.set("resource", "acct:baz@example.com");
    context = createContext(u);
    request = context.request;
    response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      actorHandleMapper,
      onNotFound,
    });
    assertEquals(response.status, 404);
  });

  const actorAliasMapper: ActorAliasMapper<void> = (_ctx, resource) => {
    if (resource.protocol !== "https:") return null;
    if (resource.host !== "example.com") return null;
    const m = /^\/@(\w+)$/.exec(resource.pathname);
    if (m == null) return null;
    return { username: m[1] };
  };

  await t.step("alias mapper", async () => {
    const u = new URL(url);
    u.searchParams.set("resource", "https://example.com/@someone");
    let context = createContext(u);
    let request = context.request;
    let response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      actorAliasMapper,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ...expected,
      aliases: ["https://example.com/users/someone"],
      subject: "https://example.com/@someone",
    });

    u.searchParams.set("resource", "https://example.com/@bar");
    context = createContext(u);
    request = context.request;
    response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      actorHandleMapper,
      actorAliasMapper,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ...expected2,
      aliases: ["acct:bar@example.com", "https://example.com/users/someone2"],
      subject: "https://example.com/@bar",
    });

    u.searchParams.set("resource", "https://example.com/@no-one");
    context = createContext(u);
    request = context.request;
    response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      actorAliasMapper,
      onNotFound,
    });
    assertEquals(response.status, 404);

    u.searchParams.set("resource", "https://example.com/@no-one");
    context = createContext(u);
    request = context.request;
    response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      actorHandleMapper,
      actorAliasMapper,
      onNotFound,
    });
    assertEquals(response.status, 404);
  });

  await t.step("handleHost", async () => {
    const u = new URL(url);
    u.searchParams.set("resource", "acct:someone@example.com");
    let context = createContext(u);
    let request = context.request;
    let response = await handleWebFinger(request, {
      context,
      host: "handle.example.com",
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ...expected,
      aliases: [...expected.aliases, "acct:someone@handle.example.com"],
    });

    u.searchParams.set("resource", "acct:someone@handle.example.com");
    context = createContext(u);
    request = context.request;
    response = await handleWebFinger(request, {
      context,
      host: "handle.example.com",
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ...expected,
      subject: "acct:someone@handle.example.com",
    });

    u.searchParams.set("resource", "https://example.com/users/someone2");
    context = createContext(u);
    request = context.request;
    response = await handleWebFinger(request, {
      context,
      host: "handle.example.com",
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ...expected2,
      aliases: [
        "acct:bar@handle.example.com",
        "acct:bar@example.com",
      ],
      subject: "https://example.com/users/someone2",
    });
  });

  const expectedForLocalhostWithPort = {
    subject: "acct:someone@localhost:8000",
    aliases: ["https://localhost:8000/users/someone"],
    links: [
      {
        href: "https://localhost:8000/users/someone",
        rel: "self",
        type: "application/activity+json",
      },
      {
        href: "https://localhost:8000/@someone",
        rel: "http://webfinger.net/rel/profile-page",
      },
      {
        href: "https://localhost:8000/@someone",
        rel: "alternate",
        type: "text/html",
      },
      {
        href: "https://localhost:8000/icon.jpg",
        rel: "http://webfinger.net/rel/avatar",
        type: "image/jpeg",
      },
    ],
  };

  await t.step("on localhost with port, ok: resource=acct:...", async () => {
    const u = new URL("https://localhost:8000/.well-known/webfinger");
    u.searchParams.set("resource", "acct:someone@localhost:8000");
    const context = createContext(u);
    const request = context.request;
    const response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Content-Type"), "application/jrd+json");
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
    assertEquals(await response.json(), expectedForLocalhostWithPort);
  });

  const expectedForHostnameWithPort = {
    subject: "acct:someone@example.com:8000",
    aliases: ["http://example.com:8000/users/someone"],
    links: [
      {
        href: "http://example.com:8000/users/someone",
        rel: "self",
        type: "application/activity+json",
      },
      {
        href: "http://example.com:8000/@someone",
        rel: "http://webfinger.net/rel/profile-page",
      },
      {
        href: "http://example.com:8000/@someone",
        rel: "alternate",
        type: "text/html",
      },
      {
        href: "http://example.com:8000/icon.jpg",
        rel: "http://webfinger.net/rel/avatar",
        type: "image/jpeg",
      },
    ],
  };

  await t.step("on hostname with port, ok: resource=acct:...", async () => {
    const u = new URL("http://example.com:8000/.well-known/webfinger");
    u.searchParams.set("resource", "acct:someone@example.com:8000");
    const context = createContext(u);
    const request = context.request;
    const response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      onNotFound,
    });
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Content-Type"), "application/jrd+json");
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
    assertEquals(await response.json(), expectedForHostnameWithPort);
  });

  await t.step("webFingerLinksDispatcher", async () => {
    const webFingerLinksDispatcher: WebFingerLinksDispatcher<void> = (_ctx) => {
      return [
        {
          rel: "http://ostatus.org/schema/1.0/subscribe",
          template: "https://example.com/follow?acct={uri}",
        },
      ];
    };

    const u = new URL(url);
    u.searchParams.set("resource", "acct:someone@example.com");
    const context = createContext(u);
    const request = context.request;
    const response = await handleWebFinger(request, {
      context,
      actorDispatcher,
      webFingerLinksDispatcher,
      onNotFound,
    });

    assertEquals(response.status, 200);
    const result = await response.json();

    // Check that custom links are added to the existing links
    const expectedWithCustomLinks = {
      ...expected,
      links: [
        ...expected.links,
        {
          rel: "http://ostatus.org/schema/1.0/subscribe",
          template: "https://example.com/follow?acct={uri}",
        },
      ],
    };

    assertEquals(result, expectedWithCustomLinks);
  });
});
