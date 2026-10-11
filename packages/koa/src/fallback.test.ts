import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { test } from "@fedify/fixture";
import { strict as assert } from "node:assert";
import Koa from "koa";
import { createMiddleware } from "./index.ts";
import type { AddressInfo } from "node:net";

async function withServer(
  app: Koa,
  callback: (origin: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

for (
  const mode of [
    "unhandled",
    "pass",
    "async-pass",
    "html",
    "async-html",
    "not-found-html",
    "not-found-json",
    "not-found-end",
    "error",
  ]
) {
  test(
    "koa preserves the application's response or falls back to 406: " + mode,
    async () => {
      let dispatches = 0;
      const fed = createFederation<void>({ kv: new MemoryKvStore() });
      fed.setActorDispatcher("/users/{identifier}", () => {
        dispatches++;
        return null;
      });
      const app = new Koa();
      app.silent = true;
      app.use(async (ctx: Koa.Context, next: Koa.Next) => {
        ctx.vary("Origin");
        await next();
      });
      app.use(createMiddleware(fed, () => undefined));
      if (mode !== "unhandled") {
        app.use(async (ctx: Koa.Context, next: Koa.Next) => {
          if (mode.startsWith("async")) {
            await new Promise((r) => setTimeout(r, 10));
          }
          if (mode.startsWith("not-found")) {
            ctx.status = 404;
            ctx.type = mode.endsWith("html") ? "html" : "text";
            ctx.body = mode.endsWith("json")
              ? { error: "No such user" }
              : mode.endsWith("html")
              ? "<p>No such user</p>"
              : "No such user";
          } else if (mode.endsWith("html")) {
            ctx.type = "html";
            ctx.body = "<p>Alice</p>";
          } else if (mode === "error") ctx.throw(500, "application failure");
          else await next();
        });
      }

      await withServer(app, async (origin) => {
        for (const method of ["GET", "HEAD"]) {
          const response = await fetch(`${origin}/users/alice`, {
            method,
            headers: { Accept: "image/png" },
            signal: AbortSignal.timeout(5000),
          });
          const body = await response.text();
          const expected = mode.startsWith("not-found")
            ? 404
            : mode.endsWith("html")
            ? 200
            : mode === "error"
            ? 500
            : 406;
          assert.equal(response.status, expected);
          if (expected === 406) {
            assert.equal(response.statusText, "Not Acceptable");
            assert.equal(
              response.headers.get("Content-Type")?.split(";")[0],
              "text/plain",
            );
            assert.ok(
              response.headers.get("Vary")?.toLowerCase().includes("accept"),
            );
            assert.ok(
              response.headers.get("Vary")?.toLowerCase().includes("origin"),
            );
            assert.equal(response.headers.get("ETag"), null);
            assert.equal(body, method === "HEAD" ? "" : "Not acceptable");
          } else if (expected === 404) {
            if (method === "HEAD") assert.equal(body, "");
            else if (mode.endsWith("json")) {
              assert.deepEqual(JSON.parse(body), { error: "No such user" });
            } else {assert.equal(
                body,
                mode.endsWith("html") ? "<p>No such user</p>" : "No such user",
              );}
          } else if (expected === 200) {
            assert.equal(body, method === "HEAD" ? "" : "<p>Alice</p>");
            assert.equal(
              response.headers.get("Content-Type")?.split(";")[0],
              "text/html",
            );
          }
        }
        if (mode === "unhandled" || mode.endsWith("pass")) {
          const missing = await fetch(`${origin}/missing`, {
            headers: { Accept: "image/png" },
          });
          assert.equal(missing.status, 404);
          assert.ok(
            !missing.headers.get("Vary")?.split(",").some((field) =>
              field.trim().toLowerCase() === "accept"
            ),
          );
          await missing.text();
        }
      });
      assert.equal(dispatches, 0);
    },
  );
}

for (const mode of ["empty", "message", "status"]) {
  test(`koa preserves an explicit ${mode} 404`, async () => {
    const fed = createFederation<void>({ kv: new MemoryKvStore() });
    fed.setActorDispatcher("/users/{identifier}", () => null);
    const app = new Koa().use(createMiddleware(fed, () => undefined));
    app.use((ctx: Koa.Context) => {
      if (mode === "empty") ctx.body = null;
      ctx.status = 404;
      if (mode === "message") ctx.message = "User removed";
    });
    await withServer(app, async (origin) => {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(`${origin}/users/alice`, {
          method,
          headers: { Accept: "image/png" },
        });
        assert.equal(response.status, 404);
        assert.equal(
          await response.text(),
          mode === "empty" || method === "HEAD"
            ? ""
            : mode === "status"
            ? "Not Found"
            : "User removed",
        );
      }
    });
  });
}
