import { test } from "@fedify/fixture";
import { deepEqual, equal } from "node:assert/strict";
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
import type { Path } from "../types.ts";
import Router, { type RouterRoute } from "./router.ts";

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

test("Router#register() registers all routes in one call", async (t) => {
  const router = new Router();
  router.register(sampleRoutes);

  await t.step("registers every name", () => {
    equal(router.has("user"), true);
    equal(router.has("post"), true);
    equal(router.has("userPost"), true);
  });

  await t.step("matches routes equivalently to repeated add()", () => {
    deepEqual(router.route("/users/42" as Path), {
      name: "user",
      template: "/users/{id}",
      values: { id: "42" },
    });
    deepEqual(router.route("/users/42/posts/7" as Path), {
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
      router.route("/users/42" as Path),
      reference.route("/users/42" as Path),
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
  const pattern = Router.compile("/items/{id}" as Path);

  await t.step("via add()", () => {
    const router = new Router();
    router.add(pattern, "item");
    equal(router.has("item"), true);
    deepEqual(router.route("/items/9" as Path), {
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
