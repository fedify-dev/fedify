import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { test } from "@fedify/fixture";
import { strict as assert } from "node:assert";
import { Elysia, NotFoundError } from "elysia";
import { fedify } from "./index.ts";

for (const aot of [true, false]) {
  for (
    const mode of [
      "unhandled",
      "async-pass",
      "html",
      "async-html",
      "not-found-html",
      "not-found-json",
      "not-found-error",
      "early-route",
      "early-error-hook",
      "late-error-hook",
      "late-404-hook",
      "headers",
      "error",
    ]
  ) {
    test(`Elysia preserves application responses or falls back to 406 (aot=${aot}): ${mode}`, async () => {
      const fed = createFederation<void>({ kv: new MemoryKvStore() });
      fed.setActorDispatcher("/users/{identifier}", () => null);
      const app = new Elysia({ aot });
      let errorHookCalls = 0;
      const appErrorHook = () => {
        errorHookCalls++;
        return new Response("<p>Custom missing</p>", {
          status: mode === "late-404-hook" ? 404 : 200,
          headers: { "Content-Type": "text/html" },
        });
      };
      if (mode === "early-route") {
        app.get("/users/:identifier", () => {
          throw new NotFoundError("No such user");
        });
      }
      if (mode === "early-error-hook") app.onError(appErrorHook);
      if (mode === "headers") {
        app.onRequest(({ set }) => {
          set.headers["Content-Type"] = "text/html";
          set.headers["Content-Length"] = "999";
          set.headers["Content-Encoding"] = "gzip";
          set.headers["ETag"] = '"old"';
          set.headers["Vary"] = "Origin";
          set.headers["X-Custom"] = "kept";
          set.headers["Set-Cookie"] = "session=kept; Path=/";
        });
      }
      app.use(fedify(fed, () => undefined));
      if (mode.startsWith("late-")) app.onError(appErrorHook);
      if (mode === "async-pass") {
        app.onRequest(async () => {
          await new Promise((r) => setTimeout(r, 10));
        });
      }
      if (mode.endsWith("html")) {
        app.get("/users/:identifier", async () => {
          if (mode === "async-html") {
            await new Promise((r) => setTimeout(r, 10));
          }
          return new Response(
            mode === "not-found-html" ? "<p>No such user</p>" : "<p>Alice</p>",
            {
              status: mode === "not-found-html" ? 404 : 200,
              headers: { "Content-Type": "text/html" },
            },
          );
        });
      } else if (mode === "not-found-json") {
        app.get(
          "/users/:identifier",
          () =>
            new Response(JSON.stringify({ error: "No such user" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }),
        );
      } else if (mode === "not-found-error") {
        app.get("/users/:identifier", () => {
          throw new NotFoundError("No such user");
        });
      } else if (mode === "error") {
        app.get("/users/:identifier", () => {
          throw new Error("application failure");
        });
      }
      // Returning a string from the fallback would crash Elysia 1.3.8 here.
      app.mapResponse(() => undefined);
      const response = await app.handle(
        new Request("http://localhost/users/alice", {
          headers: { Accept: "image/png" },
        }),
      );
      const expected = mode.startsWith("not-found") || mode === "early-route" ||
          mode === "late-404-hook"
        ? 404
        : mode.endsWith("html") || mode.endsWith("error-hook")
        ? 200
        : mode === "error"
        ? 500
        : 406;
      assert.equal(response.status, expected);
      const body = await response.text();
      if (mode.endsWith("error-hook") || mode === "late-404-hook") {
        assert.equal(body, "<p>Custom missing</p>");
        assert.equal(errorHookCalls, 1);
      } else if (mode === "not-found-json") {
        assert.deepEqual(JSON.parse(body), { error: "No such user" });
      } else if (expected === 404) {
        assert.equal(
          body,
          mode.endsWith("html") ? "<p>No such user</p>" : "No such user",
        );
      } else if (expected === 200) assert.equal(body, "<p>Alice</p>");
      else if (expected === 406) {
        assert.equal(body, "Not acceptable");
        assert.equal(
          response.headers.get("Content-Type"),
          "text/plain; charset=utf-8",
        );
        assert.ok(
          response.headers.get("Vary")?.split(",").some((field) =>
            field.trim().toLowerCase() === "accept"
          ),
        );
        if (mode === "headers") {
          assert.ok(response.headers.get("Vary")?.includes("Origin"));
          for (const name of ["Content-Length", "Content-Encoding", "ETag"]) {
            assert.equal(response.headers.get(name), null);
          }
          assert.equal(response.headers.get("X-Custom"), "kept");
          assert.equal(
            response.headers.get("Set-Cookie"),
            "session=kept; Path=/",
          );
        }
      }
      if (
        !["early-error-hook", "late-error-hook", "late-404-hook"].includes(mode)
      ) {
        const missing = await app.handle(
          new Request("http://localhost/missing"),
        );
        const control = await new Elysia({ aot }).handle(
          new Request("http://localhost/missing"),
        );
        assert.equal(missing.status, control.status);
        assert.equal(await missing.text(), await control.text());
        assert.ok(
          !missing.headers.get("Vary")?.split(",").some((field) =>
            field.trim().toLowerCase() === "accept"
          ),
        );
      }
    });
  }
}

for (const aot of [true, false]) {
  for (const depth of [1, 2]) {
    test(`Elysia preserves parent error hooks (aot=${aot}, depth=${depth})`, async () => {
      const fed = createFederation<void>({ kv: new MemoryKvStore() });
      fed.setActorDispatcher("/users/{identifier}", () => null);
      let app = new Elysia({ aot }).use(fedify(fed, () => undefined));
      for (let level = 0; level < depth; level++) {
        app = new Elysia({ aot }).use(app);
      }
      let calls = 0;
      app.onError(() => {
        calls++;
        return new Response("<p>Parent missing</p>", { status: 404 });
      });
      const response = await app.handle(
        new Request("http://localhost/users/alice", {
          headers: { Accept: "image/png" },
        }),
      );
      assert.equal(response.status, 404);
      assert.equal(await response.text(), "<p>Parent missing</p>");
      assert.equal(calls, 1);
    });
  }
  test(`Elysia preserves explicit request-hook NotFoundErrors (aot=${aot})`, async () => {
    const fed = createFederation<void>({ kv: new MemoryKvStore() });
    fed.setActorDispatcher("/users/{identifier}", () => null);
    const app = new Elysia({ aot }).use(fedify(fed, () => undefined))
      .onRequest(() => {
        throw new NotFoundError("User has been removed");
      });
    const response = await app.handle(
      new Request("http://localhost/users/alice", {
        headers: { Accept: "image/png" },
      }),
    );
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "User has been removed");
  });
}

for (const aot of [true, false]) {
  test(`Elysia preserves each parent's error hooks when a plugin is reused (aot=${aot})`, async () => {
    const fed = createFederation<void>({ kv: new MemoryKvStore() });
    fed.setActorDispatcher("/users/{identifier}", () => null);
    const shared = new Elysia({ aot }).use(fedify(fed, () => undefined));
    const apps = ["first", "second"].map((body) =>
      new Elysia({ aot }).use(shared).onError(() =>
        new Response(body, { status: 404 })
      )
    );
    for (const [index, app] of apps.entries()) {
      const response = await app.handle(
        new Request("http://localhost/users/alice", {
          headers: { Accept: "image/png" },
        }),
      );
      assert.equal(response.status, 404);
      assert.equal(await response.text(), index === 0 ? "first" : "second");
    }
  });
}

for (const aot of [true, false]) {
  test(`Elysia does not replay earlier error hooks when the fallback is wrapped (aot=${aot})`, async () => {
    const fed = createFederation<void>({ kv: new MemoryKvStore() });
    fed.setActorDispatcher("/users/{identifier}", () => null);
    let earlierCalls = 0;
    const app = new Elysia({ aot }).onError(() => {
      earlierCalls++;
    }).use(fedify(fed, () => undefined));
    const hook = app.event.error!.find((hook) =>
      hook.fn.name === "notAcceptableFallback"
    )!;
    const fallback = hook.fn;
    // Simulate a plugin replacing the registration with a wrapped copy.
    hook.fn = async (context) => {
      // Keep context fields visible to Elysia's AOT inference.
      const { request, code, set, error, store, route } = context;
      return await fallback({
        ...context,
        request,
        code,
        set,
        error,
        store,
        route,
      });
    };
    const response = await app.handle(
      new Request("http://localhost/users/alice", {
        headers: { Accept: "image/png" },
      }),
    );
    assert.equal(response.status, 406);
    assert.equal(await response.text(), "Not acceptable");
    assert.equal(earlierCalls, 1);
  });
}
