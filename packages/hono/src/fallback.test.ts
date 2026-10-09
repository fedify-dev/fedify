import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { test } from "@fedify/fixture";
import { strict as assert } from "node:assert";
import { Hono } from "hono";
import { federation } from "./mod.ts";

for (
  const mode of [
    "unhandled",
    "pass",
    "html",
    "async-html",
    "not-found-html",
    "not-found-json",
    "custom-not-found",
    "error",
  ]
) {
  test(
    "Hono preserves the application's response or falls back to 406: " + mode,
    async () => {
      const fed = createFederation<void>({ kv: new MemoryKvStore() });
      fed.setActorDispatcher("/users/{identifier}", () => null);
      const app = new Hono();
      app.use("*", federation(fed, () => undefined));
      // Exercise res setter cloning and stale metadata on a default response.
      app.use("*", async (ctx, next) => {
        ctx.header("Vary", "Origin");
        await next();
        if (ctx.res.status === 404 && mode !== "custom-not-found") {
          ctx.header("ETag", '"old"');
          ctx.header("Content-Length", "999");
        }
      });
      if (mode.endsWith("html")) {
        app.get("/users/:identifier", async (ctx) => {
          if (mode === "async-html") {
            await new Promise((r) => setTimeout(r, 10));
          }
          return ctx.html(
            mode === "not-found-html" ? "<p>No such user</p>" : "<p>Alice</p>",
            mode === "not-found-html" ? 404 : 200,
          );
        });
      } else if (mode === "not-found-json") {
        app.get(
          "/users/:identifier",
          (ctx) => ctx.json({ error: "No such user" }, 404),
        );
      } else if (mode === "custom-not-found") {
        app.notFound((ctx) => ctx.html("<p>Custom missing</p>", 404));
      } else if (mode === "error") {
        app.get("/users/:identifier", () => {
          throw new Error("application failure");
        });
        app.onError((_error, ctx) => ctx.text("application failure", 500));
      }
      const response = await app.request("http://localhost/users/alice", {
        headers: { Accept: "image/png" },
      });
      const expected =
        mode.startsWith("not-found") || mode === "custom-not-found"
          ? 404
          : mode.endsWith("html")
          ? 200
          : mode === "error"
          ? 500
          : 406;
      assert.equal(response.status, expected);
      const body = await response.text();
      if (mode === "not-found-json") {
        assert.deepEqual(JSON.parse(body), { error: "No such user" });
      } else {assert.equal(
          body,
          expected === 200
            ? "<p>Alice</p>"
            : mode === "custom-not-found"
            ? "<p>Custom missing</p>"
            : expected === 404
            ? "<p>No such user</p>"
            : expected === 500
            ? "application failure"
            : "Not acceptable",
        );}
      if (expected === 406) {
        assert.equal(
          response.headers.get("Content-Type")?.split(";")[0],
          "text/plain",
        );
        assert.ok(
          response.headers.get("Vary")?.split(",").some((field) =>
            field.trim().toLowerCase() === "accept"
          ),
        );
        assert.ok(
          response.headers.get("Vary")?.toLowerCase().includes("origin"),
        );
        assert.equal(response.headers.get("Content-Length"), null);
        assert.equal(response.headers.get("ETag"), null);
      }
      const missing = await app.request("http://localhost/missing");
      assert.equal(missing.status, 404);
      assert.equal(
        await missing.text(),
        mode === "custom-not-found" ? "<p>Custom missing</p>" : "404 Not Found",
      );
      assert.equal(missing.headers.get("Vary"), "Origin");
    },
  );
}

test("Hono preserves an application 404 stream without reading it", async () => {
  const fed = createFederation<void>({ kv: new MemoryKvStore() });
  fed.setActorDispatcher("/users/{identifier}", () => null);
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull() {
      pulls++;
    },
  }, { highWaterMark: 0 });
  const app = new Hono();
  app.use("*", federation(fed, () => undefined));
  app.get(
    "/users/:identifier",
    (ctx) =>
      ctx.body(stream, 404, { "Content-Type": "text/plain; charset=UTF-8" }),
  );
  const response = await app.request("http://localhost/users/alice", {
    headers: { Accept: "image/png" },
  });
  assert.equal(response.status, 404);
  assert.equal(pulls, 0);
  await response.body!.cancel();
});

test("Hono preserves a redirect with immutable headers", async () => {
  const fed = createFederation<void>({ kv: new MemoryKvStore() });
  fed.setActorDispatcher("/users/{identifier}", () => null);
  const app = new Hono();
  app.use("*", federation(fed, () => undefined));
  app.get(
    "/users/:identifier",
    () => Response.redirect("http://localhost/profile", 302),
  );
  const response = await app.request("http://localhost/users/alice", {
    headers: { Accept: "image/png" },
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "http://localhost/profile");
});

test("Hono preserves an application replacement of the default 404", async () => {
  const fed = createFederation<void>({ kv: new MemoryKvStore() });
  fed.setActorDispatcher("/users/{identifier}", () => null);
  const app = new Hono();
  app.use("*", federation(fed, () => undefined));
  app.use("*", async (ctx, next) => {
    await next();
    if (ctx.res.status === 404) {
      ctx.res = ctx.html("<p>Custom missing</p>", 404);
    }
  });
  const response = await app.request("http://localhost/users/alice", {
    headers: { Accept: "image/png" },
  });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "<p>Custom missing</p>");
});

for (const mode of ["route", "wildcard-route", "all-route", "pass"]) {
  test(
    "Hono preserves 404 responses owned by matched routes: " + mode,
    async () => {
      const fed = createFederation<void>({ kv: new MemoryKvStore() });
      fed.setActorDispatcher("/users/{identifier}", () => null);
      const app = new Hono();
      app.use("*", federation(fed, () => undefined));
      if (mode === "wildcard-route") {
        app.get("*", (ctx) => ctx.text("404 Not Found", 404));
      } else if (mode === "all-route") {
        app.all("/users/:identifier", (ctx) => ctx.text("404 Not Found", 404));
      } else {
        app.get("/users/:identifier", async (ctx, next) => {
          if (mode === "pass") await next();
          else return ctx.text("404 Not Found", 404);
        });
      }
      const response = await app.request("http://localhost/users/alice", {
        headers: { Accept: "image/png" },
      });
      assert.equal(response.status, 404);
      assert.equal(
        await response.text(),
        "404 Not Found",
      );
    },
  );
}

test("Hono preserves responses when observation cannot be installed", async () => {
  const fed = createFederation<void>({ kv: new MemoryKvStore() });
  fed.setActorDispatcher("/users/{identifier}", () => null);
  const app = new Hono();
  app.use("*", async (ctx, next) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(ctx),
      "res",
    )!;
    Object.defineProperty(ctx, "res", { ...descriptor, configurable: false });
    await next();
  });
  app.use("*", federation(fed, () => undefined));
  const response = await app.request("http://localhost/users/alice", {
    headers: { Accept: "image/png" },
  });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "404 Not Found");
  assert.equal(response.headers.get("Vary"), null);
});

for (const mode of ["same-body", "wrapped-stream", "replacement"]) {
  test(
    "Hono preserves middleware ownership after response replacement: " + mode,
    async () => {
      const fed = createFederation<void>({ kv: new MemoryKvStore() });
      fed.setActorDispatcher("/users/{identifier}", () => null);
      const app = new Hono();
      app.use("*", federation(fed, () => undefined));
      app.use("*", async (ctx, next) => {
        await next();
        if (mode === "replacement") {
          ctx.res = ctx.html("<p>Application missing</p>", 404);
        } else {
          const response = ctx.res;
          const body = mode === "same-body"
            ? response.body
            : response.body!.pipeThrough(new TransformStream());
          ctx.res = new Response(body, response);
        }
        ctx.header("Vary", "Origin");
      });
      const response = await app.request("http://localhost/users/alice", {
        headers: { Accept: "image/png" },
      });
      assert.equal(response.status, 404);
      assert.equal(
        await response.text(),
        mode === "replacement" ? "<p>Application missing</p>" : "404 Not Found",
      );
      assert.equal(response.headers.get("Vary"), "Origin");
    },
  );
}
