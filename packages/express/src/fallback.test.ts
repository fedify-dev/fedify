import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { test } from "@fedify/fixture";
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import express from "express";
import { integrateFederation } from "./index.ts";
import type { AddressInfo } from "node:net";

async function withServer(
  app: express.Express,
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
    "express preserves the application's response or falls back to 406: " +
      mode,
    async () => {
      let dispatches = 0;
      const fed = createFederation<void>({ kv: new MemoryKvStore() });
      fed.setActorDispatcher("/users/{identifier}", () => {
        dispatches++;
        return null;
      });
      const app = express();
      app.use(
        (
          _req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          res.vary("Origin");
          next();
        },
      );
      app.use(integrateFederation(fed, () => undefined));
      if (mode !== "unhandled") {
        app.get(
          "/users/:identifier",
          async (
            _req: express.Request,
            res: express.Response,
            next: express.NextFunction,
          ) => {
            if (mode.startsWith("async")) {
              await new Promise((r) => setTimeout(r, 10));
            }
            if (mode.startsWith("not-found")) {
              res.status(404);
              if (mode.endsWith("json")) res.json({ error: "No such user" });
              else if (mode.endsWith("end")) {
                res.type("text").end("No such user");
              } else res.type("html").send("<p>No such user</p>");
            } else if (mode.endsWith("html")) {
              res.type("html").send("<p>Alice</p>");
            } else if (mode === "error") next(new Error("application failure"));
            else next();
          },
        );
      }
      app.use(
        (
          error: Error,
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction,
        ) => {
          res.status(500).send(error.message);
        },
      );

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

test("express falls back for paths escaped in its default 404 page", async () => {
  const fed = createFederation<void>({ kv: new MemoryKvStore() });
  fed.setActorDispatcher("/users/{identifier}", () => null);
  const app = express().use(integrateFederation(fed, () => undefined));
  await withServer(app, async (origin) => {
    for (const identifier of ["a{b}", "a%7Bb%7D", "a%20b"]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(`${origin}/users/${identifier}`, {
          method,
          headers: { Accept: "image/png" },
          signal: AbortSignal.timeout(5000),
        });
        const body = await response.text();
        assert.equal(response.status, 406, `${method} ${identifier}`);
        assert.equal(body, method === "HEAD" ? "" : "Not acceptable");
      }
    }
  });
});

test("express preserves a custom HTML 404 resembling its default page", async () => {
  const fed = createFederation<void>({ kv: new MemoryKvStore() });
  fed.setActorDispatcher("/users/{identifier}", () => null);
  const app = express().use(integrateFederation(fed, () => undefined));
  app.get(
    "/users/:identifier",
    (req: express.Request, res: express.Response) => {
      const body =
        `<!DOCTYPE html>\n<html><body><pre>Cannot ${req.method} ${req.path}</pre>` +
        "<p>No such user; try the directory.</p></body></html>\n";
      res.status(404).set({
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": Buffer.byteLength(body),
      }).end(body);
    },
  );
  await withServer(app, async (origin) => {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(`${origin}/users/alice`, {
        method,
        headers: { Accept: "image/png" },
      });
      assert.equal(response.status, 404);
      const body = await response.text();
      if (method === "HEAD") assert.equal(body, "");
      else assert.ok(body.includes("No such user; try the directory."));
    }
  });
});
