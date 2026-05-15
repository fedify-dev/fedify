import { test } from "@fedify/fixture";
import { deepEqual, equal, throws } from "node:assert/strict";
import {
  createRouterAddTest,
  createRouterBuildTest,
  createRouterCloneTest,
  createRouterCompileErrorTest,
  createRouterRouteTest,
  createRouterVariablesTest,
  routerBuildTestSuites,
  routerCloneTestSuites,
  routerCompileErrorCases,
  routerRouteDefinitions,
  routerRouteTestSuites,
  routerVariablesCases,
} from "../tests/mod.ts";
import type { ExpandContext, Path } from "../types.ts";
import Router, { type RouterPathPattern, type RouterRoute } from "./router.ts";

const runAddCases = createRouterAddTest(Router);
test("Router.add()", runAddCases(routerRouteDefinitions));

const runCompileErrorCases = createRouterCompileErrorTest(Router);
test(
  "Router.compile() rejects invalid templates",
  runCompileErrorCases(routerCompileErrorCases),
);

const runVariablesCases = createRouterVariablesTest(Router);
test("Router.variables()", runVariablesCases(routerVariablesCases));

const runCloneCases = createRouterCloneTest(Router);
test("Router.clone()", runCloneCases(routerCloneTestSuites));

const runRouteCases = createRouterRouteTest(Router);
for (
  const { name, options, routeDefinitions, cases } of routerRouteTestSuites
) {
  test(
    `Router.route(): ${name}`,
    runRouteCases(routeDefinitions, options)(cases),
  );
}

const runBuildCases = createRouterBuildTest(Router);
for (
  const { name, options, routeDefinitions, cases } of routerBuildTestSuites
) {
  test(
    `Router.build(): ${name}`,
    runBuildCases(routeDefinitions, options)(cases),
  );
}

const sampleRoutes: readonly RouterRoute[] = [
  ["/users/{id}", "user"] as const,
  ["/posts/{id}", "post"] as const,
  ["/users/{id}/posts/{postId}", "userPost"] as const,
];

const createCountingPattern = (
  path: Path,
  calls: Map<Path, number>,
): RouterPathPattern => {
  const pattern = Router.compile(path);
  const match = pattern.template.match;
  pattern.template.match = (uri: string): ExpandContext | null => {
    calls.set(path, (calls.get(path) ?? 0) + 1);
    return match(uri);
  };
  return pattern;
};

test("Router indexes shared dynamic prefixes before template matching", () => {
  const calls = new Map<Path, number>();
  const routeDefinitions = [
    ["/ap/{identifier}", "actor"],
    ["/ap/{identifier}/inbox", "inbox"],
    ["/ap/{identifier}/outbox", "outbox"],
    ["/ap/{identifier}/followers", "followers"],
    ["/ap/{identifier}/following", "following"],
    ["/ap/{identifier}/featured", "featured"],
  ] as const satisfies readonly RouterRoute[];
  const routes = routeDefinitions.map(
    ([path, name]): RouterRoute => [createCountingPattern(path, calls), name],
  );
  const router = new Router(routes);

  deepEqual(router.route("/ap/alice/inbox"), {
    name: "inbox",
    template: "/ap/{identifier}/inbox",
    values: { identifier: "alice" },
  });
  equal(calls.get("/ap/{identifier}/inbox"), 1);
  for (const [path] of routeDefinitions) {
    if (path !== "/ap/{identifier}/inbox") {
      equal(calls.get(path) ?? 0, 0);
    }
  }
});

test(
  "Router indexes root-adjacent dynamic prefixes before template matching",
  () => {
    const calls = new Map<Path, number>();
    const routeDefinitions = [
      ["/{identifier}/inbox", "inbox"],
      ["/{identifier}/outbox", "outbox"],
      ["/{identifier}/followers", "followers"],
      ["/{tenant}/users/{identifier}/inbox", "tenantInbox"],
      ["/{tenant}/users/{identifier}/outbox", "tenantOutbox"],
    ] as const satisfies readonly RouterRoute[];
    const routes = routeDefinitions.map(([path, name]): RouterRoute => [
      createCountingPattern(path, calls),
      name,
    ]);
    const router = new Router(routes);

    deepEqual(router.route("/alice/outbox"), {
      name: "outbox",
      template: "/{identifier}/outbox",
      values: { identifier: "alice" },
    });
    equal(calls.get("/{identifier}/outbox"), 1);
    for (const [path] of routeDefinitions) {
      if (path !== "/{identifier}/outbox") {
        equal(calls.get(path) ?? 0, 0);
      }
    }
  },
);

test("Router preserves priority across state and fallback tries", () => {
  const router = new Router([
    ["/{id}", "state"],
    ["/@{identifier}", "state"],
    ["/x{first,second}", "fallback"],
  ]);

  deepEqual(router.route("/xalice"), {
    name: "fallback",
    template: "/x{first,second}",
    values: { first: "alice" },
  });
});

test("Router#register() registers all routes in one call", async (t) => {
  const router = new Router();
  router.register(sampleRoutes);

  await t.step("registers every name", () => {
    equal(router.has("user"), true);
    equal(router.has("post"), true);
    equal(router.has("userPost"), true);
  });

  await t.step("matches routes equivalently to repeated add()", () => {
    deepEqual(router.route("/users/42"), {
      name: "user",
      template: "/users/{id}",
      values: { id: "42" },
    });
    deepEqual(router.route("/users/42/posts/7"), {
      name: "userPost",
      template: "/users/{id}/posts/{postId}",
      values: { id: "42", postId: "7" },
    });
  });

  await t.step("preserves insertion order against later add()", () => {
    const reference = new Router();
    for (const [path, name] of sampleRoutes) {
      reference.add(path, name);
    }
    deepEqual(
      router.route("/users/42"),
      reference.route("/users/42"),
    );
  });

  await t.step("accepts non-array iterables", () => {
    function* iter(): Generator<RouterRoute> {
      for (const route of sampleRoutes) yield route;
    }
    const fromGenerator = new Router();
    fromGenerator.register(iter());
    equal(fromGenerator.has("userPost"), true);
  });
});

test("Router accepts pre-parsed RouterPathPattern", async (t) => {
  const pattern = Router.compile("/items/{id}");

  await t.step("via add()", () => {
    const router = new Router();
    router.add(pattern, "item");
    equal(router.has("item"), true);
    deepEqual(router.route("/items/9"), {
      name: "item",
      template: "/items/{id}",
      values: { id: "9" },
    });
  });

  await t.step("via register()", () => {
    const router = new Router();
    router.register([[pattern, "item"]]);
    equal(router.has("item"), true);
  });

  await t.step("via constructor", () => {
    const router = new Router([[pattern, "item"]]);
    equal(router.has("item"), true);
  });

  await t.step("via Router.from()", () => {
    const router = Router.from([[pattern, "item"]]);
    equal(router.has("item"), true);
  });
});

test("Router trailing slash retry accepts empty root path", () => {
  const router = new Router([["", "root"]], {
    trailingSlashInsensitive: true,
  });

  deepEqual(router.route("/"), {
    name: "root",
    template: "",
    values: {},
  });
});

test("Router constructor argument variants", async (t) => {
  await t.step("no arguments builds an empty router", () => {
    const router = new Router();
    equal(router.has("user"), false);
    equal(router.trailingSlashInsensitive, false);
  });

  await t.step("options only", () => {
    const router = new Router({ trailingSlashInsensitive: true });
    equal(router.trailingSlashInsensitive, true);
    equal(router.has("user"), false);
  });

  await t.step("routes only", () => {
    const router = new Router(sampleRoutes);
    equal(router.has("user"), true);
    equal(router.trailingSlashInsensitive, false);
  });

  await t.step("routes and options together", () => {
    const router = new Router(sampleRoutes, {
      trailingSlashInsensitive: true,
    });
    equal(router.has("user"), true);
    equal(router.trailingSlashInsensitive, true);
  });
});

test("Router treats re-registration as replacement", async (t) => {
  await t.step("add() replaces a previous add() with the same name", () => {
    const router = new Router();
    router.add("/old/{id}", "user");
    router.add("/new/{id}", "user");

    equal(router.route("/old/1"), null);
    deepEqual(router.route("/new/1"), {
      name: "user",
      template: "/new/{id}",
      values: { id: "1" },
    });
    equal(router.build("user", { id: "1" }), "/new/1");
  });

  await t.step("register() replaces previously registered names", () => {
    const router = new Router();
    router.register([
      ["/a/{id}", "user"],
      ["/b/{id}", "post"],
    ]);
    router.register([
      ["/c/{id}", "user"],
      ["/d/{id}", "post"],
    ]);

    equal(router.route("/a/1"), null);
    equal(router.route("/b/1"), null);
    equal(router.route("/c/1")?.name, "user");
    equal(router.route("/d/1")?.name, "post");
  });

  await t.step("register() de-duplicates names within a single call", () => {
    const router = new Router();
    router.register([
      ["/a/{id}", "user"],
      ["/b/{id}", "user"],
    ]);

    equal(router.route("/a/1"), null);
    deepEqual(router.route("/b/1"), {
      name: "user",
      template: "/b/{id}",
      values: { id: "1" },
    });
  });

  await t.step("constructor de-duplicates names in the input iterable", () => {
    const router = new Router([
      ["/v1/{id}", "user"],
      ["/v2/{id}", "user"],
    ]);

    equal(router.route("/v1/1"), null);
    equal(router.route("/v2/1")?.name, "user");
  });

  await t.step("only the latest survives repeated re-registration", () => {
    const router = new Router();
    for (let i = 0; i < 50; i++) {
      router.add(`/v${i}/{id}`, "user");
    }

    equal(router.route("/v0/1"), null);
    equal(router.route("/v25/1"), null);
    deepEqual(router.route("/v49/1"), {
      name: "user",
      template: "/v49/{id}",
      values: { id: "1" },
    });
  });

  await t.step(
    "mixed add() / register() preserves replacement semantics",
    () => {
      const router = new Router();
      router.add("/old-a/{id}", "a");
      router.add("/old-b/{id}", "b");
      router.register([
        ["/new-a/{id}", "a"],
        ["/new-b/{id}", "b"],
      ]);

      equal(router.route("/old-a/1"), null);
      equal(router.route("/old-b/1"), null);
      equal(router.route("/new-a/1")?.name, "a");
      equal(router.route("/new-b/1")?.name, "b");
    },
  );

  await t.step("sibling routes survive re-registration of another name", () => {
    const router = new Router();
    router.register([
      ["/users/{id}", "user"],
      ["/posts/{id}", "post"],
    ]);
    router.add("/people/{id}", "user");

    equal(router.route("/users/1"), null);
    equal(router.route("/people/1")?.name, "user");
    equal(router.route("/posts/9")?.name, "post");
  });

  await t.step(
    "clone() after re-registration reflects only active routes",
    () => {
      const router = new Router();
      router.add("/old/{id}", "user");
      router.add("/new/{id}", "user");

      const cloned = router.clone();
      equal(cloned.has("user"), true);
      equal(cloned.route("/old/1"), null);
      deepEqual(cloned.route("/new/1"), {
        name: "user",
        template: "/new/{id}",
        values: { id: "1" },
      });
    },
  );
});

test("Router.from() mirrors the constructor", async (t) => {
  await t.step("no arguments", () => {
    const router = Router.from();
    equal(router.has("user"), false);
    equal(router.trailingSlashInsensitive, false);
  });

  await t.step("options only", () => {
    const router = Router.from({ trailingSlashInsensitive: true });
    equal(router.trailingSlashInsensitive, true);
  });

  await t.step("routes only", () => {
    const router = Router.from(sampleRoutes);
    equal(router.has("post"), true);
  });

  await t.step("routes and options together", () => {
    const router = Router.from(sampleRoutes, {
      trailingSlashInsensitive: true,
    });
    equal(router.has("post"), true);
    equal(router.trailingSlashInsensitive, true);
  });
});
