import { test } from "@fedify/fixture";
import { ok } from "node:assert";
import { deepEqual, equal, throws } from "node:assert/strict";
import type Template from "../template/template.ts";
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
import {
  ConflictingVarSpecError,
  DisallowedOperatorError,
  DisallowedVarSpecModifierError,
  DuplicateRouteVariableError,
  RouterError,
  RouteTemplateOptionsNotMatchedError,
} from "./errors.ts";
import Router from "./router.ts";
import type { PartialRouterRoute, RouterPathPattern } from "./types.ts";

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

const sampleRoutes: readonly PartialRouterRoute[] = [
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
  const template = {
    get tokens(): typeof pattern.template.tokens {
      return pattern.template.tokens;
    },
    expand: pattern.template.expand,
    match: (uri: string): ExpandContext | null => {
      calls.set(path, (calls.get(path) ?? 0) + 1);
      return match(uri);
    },
    toString: pattern.template.toString,
  } as unknown as Template;
  return {
    path: pattern.path,
    template,
    variables: pattern.variables,
  };
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
  ] as const satisfies readonly PartialRouterRoute[];
  const routes = routeDefinitions.map(
    ([path, name]): PartialRouterRoute => [
      createCountingPattern(path, calls),
      name,
    ],
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
    ] as const satisfies readonly PartialRouterRoute[];
    const routes = routeDefinitions.map(([path, name]): PartialRouterRoute => [
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
    ["/x{first,second}", "fallback", {
      exact: false,
      variables: { second: { nullable: true } },
    }],
  ]);

  deepEqual(router.route("/xalice"), {
    name: "fallback",
    template: "/x{first,second}",
    values: { first: "alice", second: null },
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
    function* iter(): Generator<PartialRouterRoute> {
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

test("Router.compile() returns immutable path patterns", async (t) => {
  const pattern = Router.compile("/items/{id}");
  const router = new Router([[pattern, "item"]]);

  await t.step("blocks Template entry point reassignment", () => {
    throws(() => {
      (pattern.template as {
        match: (uri: string) => ExpandContext | null;
      }).match = () => null;
    }, TypeError);
    throws(() => {
      (pattern.template as {
        expand: (context: ExpandContext) => string;
      }).expand = () => "/changed";
    }, TypeError);
  });

  await t.step("blocks RouterPathPattern wrapper reassignment", () => {
    const otherTemplate = Router.compile("/other/{id}").template;
    throws(() => {
      (pattern as { path: Path }).path = "/other/{id}";
    }, TypeError);
    throws(() => {
      (pattern as { template: typeof otherTemplate }).template = otherTemplate;
    }, TypeError);
  });

  await t.step("blocks variables mutation", () => {
    throws(() => {
      (pattern.variables as Set<string>).add("unexpected");
    }, TypeError);
    equal(pattern.variables.has("unexpected"), false);
    equal(pattern.variables.size, 1);
  });

  await t.step("keeps registered routing behavior unchanged", () => {
    deepEqual(router.route("/items/9"), {
      name: "item",
      template: "/items/{id}",
      values: { id: "9" },
    });
    equal(router.build("item", { id: "9" }), "/items/9");
  });
});

test("Router.clone() isolates route sets with shared pre-parsed patterns", () => {
  const pattern = Router.compile("/items/{id}");
  const original = new Router([[pattern, "item"]]);
  const clone = original.clone();
  const itemRoute = {
    name: "item",
    template: "/items/{id}",
    values: { id: "9" },
  };

  deepEqual(original.route("/items/9"), itemRoute);
  deepEqual(clone.route("/items/9"), itemRoute);

  original.add("/posts/{postId}", "post");
  equal(clone.route("/posts/3"), null);
  deepEqual(original.route("/posts/3"), {
    name: "post",
    template: "/posts/{postId}",
    values: { postId: "3" },
  });

  clone.add("/users/{userId}", "user");
  equal(original.route("/users/5"), null);
  deepEqual(clone.route("/users/5"), {
    name: "user",
    template: "/users/{userId}",
    values: { userId: "5" },
  });

  original.add("/people/{id}", "item");
  equal(original.route("/items/9"), null);
  deepEqual(original.route("/people/9"), {
    name: "item",
    template: "/people/{id}",
    values: { id: "9" },
  });
  equal(original.build("item", { id: "9" }), "/people/9");
  deepEqual(clone.route("/items/9"), itemRoute);
  equal(clone.route("/people/9"), null);
  equal(clone.build("item", { id: "9" }), "/items/9");
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

test("Router#register() is failure-atomic", async (t) => {
  await t.step(
    "a throwing entry leaves the previous router state intact",
    () => {
      const router = new Router();
      router.add("/old/{id}", "user");

      // Batch with a valid replacement for "user" followed by an invalid
      // template.  The invalid template makes resolvePathPattern() throw
      // mid-batch.
      throws(() =>
        router.register([
          ["/new/{id}", "user"],
          ["/bad path", "broken"],
        ])
      );

      // The previous "user" route must still resolve and build exactly as
      // before the failed batch: no partial mutation may survive.
      deepEqual(router.route("/old/1"), {
        name: "user",
        template: "/old/{id}",
        values: { id: "1" },
      });
      equal(router.build("user", { id: "1" }), "/old/1");

      // The aborted replacement and the unrelated invalid name must not leak.
      equal(router.route("/new/1"), null);
      equal(router.has("broken"), false);
    },
  );

  await t.step(
    "a throwing entry does not register any routes on an empty router",
    () => {
      const router = new Router();

      throws(() =>
        router.register([
          ["/users/{id}", "user"],
          ["foo" as Path, "relative"],
        ])
      );

      equal(router.has("user"), false);
      equal(router.has("relative"), false);
      equal(router.route("/users/1"), null);
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

test("Router applies the default nullable:false constraint", async (t) => {
  const router = new Router([["/users/{id}", "user"]]);

  await t.step("non-empty single binding matches", () => {
    deepEqual(router.route("/users/alice"), {
      name: "user",
      template: "/users/{id}",
      values: { id: "alice" },
    });
  });

  await t.step("empty segment does not match", () => {
    equal(router.route("/users/"), null);
  });

  await t.step("optional operator registers but no-matches unbound", () => {
    const optional = new Router([["/users{?id}", "user"]]);
    equal(optional.route("/users"), null);
    deepEqual(optional.route("/users?id=alice"), {
      name: "user",
      template: "/users{?id}",
      values: { id: "alice" },
    });
  });
});

test(
  "Router registers every optional operator but no-matches when unbound",
  async (t) => {
    // CuHf6 plan item 5: each optional RFC 6570 operator must register
    // successfully yet, under the default nullable:false constraint,
    // produce a runtime no-match when the variable is left unbound.
    const operators: ReadonlyArray<{
      readonly operator: string;
      readonly template: Path;
      readonly unbound: readonly Path[];
      readonly bound: Path;
    }> = [
      {
        operator: "{?identifier}",
        template: "/users{?identifier}",
        unbound: ["/users"],
        bound: "/users?identifier=alice",
      },
      {
        operator: "{;identifier}",
        template: "/users{;identifier}",
        unbound: ["/users"],
        bound: "/users;identifier=alice",
      },
      {
        operator: "{.identifier}",
        template: "/users{.identifier}",
        unbound: ["/users"],
        bound: "/users.alice",
      },
      {
        operator: "{/identifier}",
        template: "/users{/identifier}",
        unbound: ["/users", "/users/"],
        bound: "/users/alice",
      },
      {
        operator: "{&identifier}",
        template: "/users?fixed=true{&identifier}",
        unbound: ["/users?fixed=true"],
        bound: "/users?fixed=true&identifier=alice",
      },
      {
        operator: "{#identifier}",
        template: "/users{#identifier}",
        unbound: ["/users"],
        bound: "/users#alice",
      },
    ];

    for (const { operator, template, unbound, bound } of operators) {
      await t.step(operator, () => {
        // Registration succeeds for every RFC 6570 operator.
        const router = new Router([[template, "user"]]);
        // The default nullable:false constraint rejects the unbound form.
        for (const url of unbound) equal(router.route(url), null);
        // A bound value still matches.
        deepEqual(router.route(bound), {
          name: "user",
          template,
          values: { identifier: "alice" },
        });
      });
    }
  },
);

test("Router honors nullable:true override", () => {
  const router = new Router([
    ["/users{?id}", "user", { variables: { id: { nullable: true } } }],
  ]);

  deepEqual(router.route("/users"), {
    name: "user",
    template: "/users{?id}",
    values: { id: null },
  });
  deepEqual(router.route("/users?id=alice"), {
    name: "user",
    template: "/users{?id}",
    values: { id: "alice" },
  });
});

test("Router falls back past constraint-rejected candidates", () => {
  const router = new Router([
    ["/users/{id}", "strict"],
    [
      "/users/{rest}",
      "loose",
      { variables: { rest: { nullable: true } } },
    ],
  ]);

  // "/users/" fails the strict route (empty id) and falls through to the
  // nullable route registered for the same shape.
  deepEqual(router.route("/users/"), {
    name: "loose",
    template: "/users/{rest}",
    values: { rest: "" },
  });
});

test("Router derives multiple from the varspec", async (t) => {
  await t.step("explode requires explodable opt-in", () => {
    throws(() => new Router([["/tags/{tags*}", "tags"]]), RouterError);
  });

  await t.step("explode binds a readonly string list", () => {
    const router = new Router([
      ["/tags/{tags*}", "tags", { variables: { tags: { explodable: true } } }],
    ]);
    deepEqual(router.route("/tags/a,b,c"), {
      name: "tags",
      template: "/tags/{tags*}",
      values: { tags: ["a", "b", "c"] },
    });
  });

  await t.step("explode rejects multiple:false", () => {
    throws(
      () =>
        new Router([
          ["/tags/{tags*}", "tags", {
            variables: { tags: { explodable: true, multiple: false } },
          }],
        ]),
      RouterError,
    );
  });

  await t.step("prefix requires prefixable opt-in", () => {
    throws(() => new Router([["/u/{id:3}", "u"]]), RouterError);
  });

  await t.step("prefix rejects multiple:true", () => {
    throws(
      () =>
        new Router([
          [
            "/u/{id:3}",
            "u",
            { variables: { id: { prefixable: true, multiple: true } } },
          ],
        ]),
      RouterError,
    );
  });

  await t.step("empty list does not match", () => {
    const router = new Router([
      ["/tags{?tags*}", "tags", { variables: { tags: { explodable: true } } }],
    ]);
    equal(router.route("/tags"), null);
  });
});

test("Router rejects unknown option variables", () => {
  throws(
    () =>
      new Router([
        ["/users/{id}", "user", { variables: { nope: { nullable: true } } }],
      ]),
    RouterError,
  );
});

test("Router.add() rejects an option variable absent from the path", () => {
  const router = new Router();
  throws(
    () =>
      router.add("/users/{id}", "user", {
        variables: { identifier: { nullable: false } },
      }),
    RouterError,
  );
  // The failed add() must not register the route.
  equal(router.has("user"), false);
});

test("Router reports every mismatched option variable under exact", () => {
  let caught: unknown;
  try {
    // `who` is unknown; the template variable `id` is missing.
    new Router([
      ["/users/{id}/{kind}", "user", {
        variables: { kind: { nullable: true }, who: { nullable: true } },
      }],
    ]);
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof RouteTemplateOptionsNotMatchedError)) {
    throw new Error("expected RouteTemplateOptionsNotMatchedError");
  }
  equal(caught.template, "/users/{id}/{kind}");
  deepEqual([...caught.variable].sort(), ["id", "who"]);
});

test("Router.add() with exact:false ignores absent option variables", () => {
  const router = new Router();
  router.add("/users/{id}", "user", {
    exact: false,
    variables: { nope: { nullable: true }, id: { nullable: true } },
  });
  equal(router.has("user"), true);
  // The bogus `nope` key is ignored; the real `id` override still applies.
  deepEqual(router.route("/users/"), {
    name: "user",
    template: "/users/{id}",
    values: { id: "" },
  });
});

test("Router rejects contradictory varspecs for one name", () => {
  let caught: unknown;
  try {
    new Router([["/x/{x}/{x*}", "x"]]);
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof ConflictingVarSpecError)) {
    throw new Error("expected ConflictingVarSpecError");
  }
  equal(caught.template, "/x/{x}/{x*}");
  equal(caught.variable, "x");
});

test("Router rejects a duplicated variable unless duplicable:true", () => {
  throws(
    () => new Router([["/x/{x}/y/{x}", "x"]]),
    DuplicateRouteVariableError,
  );

  // Opting in allows the repeated occurrence; bindings must still agree.
  const router = new Router([
    ["/x/{x}/y/{x}", "x", { variables: { x: { duplicable: true } } }],
  ]);
  deepEqual(router.route("/x/a/y/a"), {
    name: "x",
    template: "/x/{x}/y/{x}",
    values: { x: "a" },
  });
  equal(router.route("/x/a/y/b"), null);
});

test("Router gates explode/prefix behind explodable/prefixable", () => {
  throws(
    () => new Router([["/u/{id:3}", "u"]]),
    DisallowedVarSpecModifierError,
  );
  throws(
    () => new Router([["/t/{tags*}", "t"]]),
    DisallowedVarSpecModifierError,
  );

  let caught: unknown;
  try {
    new Router([["/u/{id:3}", "u"]]);
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof DisallowedVarSpecModifierError)) {
    throw new Error("expected DisallowedVarSpecModifierError");
  }
  equal(caught.modifier, "prefix");
  equal(caught.variable, "id");

  // Opting in registers; prefix yields a single truncated scalar.
  const prefixed = new Router([
    ["/u/{id:3}", "u", { variables: { id: { prefixable: true } } }],
  ]);
  equal(prefixed.has("u"), true);

  const exploded = new Router([
    ["/t/{tags*}", "t", { variables: { tags: { explodable: true } } }],
  ]);
  deepEqual(exploded.route("/t/a,b"), {
    name: "t",
    template: "/t/{tags*}",
    values: { tags: ["a", "b"] },
  });
});

test("Router restricts operators via the operatables allow-list", () => {
  // Empty allow-list (the default) permits any operator.
  const any = new Router([["/users{/id}", "any"]]);
  deepEqual(any.route("/users/alice"), {
    name: "any",
    template: "/users{/id}",
    values: { id: "alice" },
  });

  // A non-empty allow-list rejects operators outside it at registration.
  let caught: unknown;
  try {
    new Router([
      ["/users{/id}", "x", { variables: { id: { operatables: [""] } } }],
    ]);
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof DisallowedOperatorError)) {
    throw new Error("expected DisallowedOperatorError");
  }
  equal(caught.template, "/users{/id}");
  equal(caught.variable, "id");
  equal(caught.operator, "/");

  // The operator is accepted when it is in the allow-list.
  const allowed = new Router([
    ["/users{/id}", "x", { variables: { id: { operatables: ["/"] } } }],
  ]);
  deepEqual(allowed.route("/users/alice"), {
    name: "x",
    template: "/users{/id}",
    values: { id: "alice" },
  });

  // Plain `{id}` uses the "" operator; allow-listing only "/" rejects it.
  throws(
    () =>
      new Router([
        ["/users/{id}", "y", { variables: { id: { operatables: ["/"] } } }],
      ]),
    DisallowedOperatorError,
  );
});

test("Router treats a comma segment as no-match, %2C as the value", () => {
  const router = new Router([["/notes/{id}", "note"]]);
  equal(router.route("/notes/a,b"), null);
  deepEqual(router.route("/notes/a%2Cb"), {
    name: "note",
    template: "/notes/{id}",
    values: { id: "a,b" },
  });
});

test("Router.clone() preserves resolved constraints", () => {
  const router = new Router([
    ["/users{?id}", "user", { variables: { id: { nullable: true } } }],
  ]);
  const clone = router.clone();

  deepEqual(clone.route("/users"), {
    name: "user",
    template: "/users{?id}",
    values: { id: null },
  });
});

test("Router.route() narrows values via the type argument", () => {
  const router = new Router([
    ["/tags/{tags*}", "tags", { variables: { tags: { explodable: true } } }],
  ]);
  const result = router.route<
    {
      tags: {
        nullable: false;
        multiple: true;
        duplicable: false;
        prefixable: false;
        explodable: true;
        operatables: [];
      };
    }
  >("/tags/a,b");
  if (result == null) throw new Error("expected a match");
  const tags: readonly string[] = result.values.tags;
  deepEqual(tags, ["a", "b"]);
});

test(
  "Router.route() binds an unbound nullable scalar as `null`, matching its " +
    "declared type",
  () => {
    const variables = { q: { nullable: true } };
    const router = new Router([
      ["/search{?q}", "search", { variables }],
    ]);
    const result = router.route<typeof variables>("/search");
    ok(result != null);

    // The declared type is `string | null`; the runtime value must be one
    // of those, i.e. `null` here — not an absent key / `undefined`.
    const typed = result.values.q;
    equal("q" in result.values, true);
    equal(typed, null);
    deepEqual(result.values, { q: null });

    // A bound value still round-trips as the string.
    const bound = router.route<typeof variables>("/search?q=hello");
    ok(bound != null);
    equal(bound.values.q, "hello");

    if (bound.values.q != null) {
      const narrowed: string = bound.values.q;
      equal(narrowed, "hello");
    }

    // For contrast, a nullable *multiple* variable already behaves
    // consistently: the key is present as an empty array.
    const tagsVars = {
      tags: { nullable: true, multiple: true, explodable: true },
    } as const;
    const arrRouter = new Router([
      ["/tags{?tags*}", "tags", { variables: tagsVars }],
    ]);
    const abcdef = arrRouter.route<typeof tagsVars>("/tags?tags=abc&tags=def");
    ok(abcdef?.values != null);
    const tags = abcdef.values.tags;
    ok(tags != null);
    deepEqual(tags, ["abc", "def"]);

    const explodable = { explodable: { explodable: true } } as const;
    const expRouter = new Router([
      ["/explodable{?explodable*}", "explodable", { variables: explodable }],
    ]);
    const expResult = expRouter.route<typeof explodable>(
      "/explodable?explodable=a&explodable=b",
    );
    ok(expResult?.values != null);
    const expValues: readonly string[] = expResult.values.explodable;
    ok(expValues != null);
    deepEqual(expValues, ["a", "b"]);
  },
);

test("DisallowedVarSpecModifierError", () => {
  const router = new Router();
  throws(
    () => router.add("/users/{identifier*}/outbox", "outbox"),
    DisallowedVarSpecModifierError,
  );
  throws(
    () => router.add("/users/{identifier:3}/outbox", "outbox"),
    DisallowedVarSpecModifierError,
  );
});

test(
  "Router supports leading path expansion that Fedify's builder rejects",
  async (t) => {
    // The standalone `@fedify/uri-template` Router supports leading path
    // expansion such as `{/identifier}/inbox`, even though Fedify's
    // required-identifier builder routes reject it (the callback contract
    // needs a non-empty `identifier`).
    await t.step("registers and matches a bound leading segment", () => {
      const router = new Router([["{/identifier}/inbox", "inbox"]]);
      deepEqual(router.route("/alice/inbox"), {
        name: "inbox",
        template: "{/identifier}/inbox",
        values: { identifier: "alice" },
      });
      // Round-trip: a successful match expands back to the same URI.
      equal(router.build("inbox", { identifier: "alice" }), "/alice/inbox");
    });

    await t.step("default nullable:false no-matches the unbound form", () => {
      const router = new Router([["{/identifier}/inbox", "inbox"]]);
      // `{/identifier}` with no binding expands to nothing, so the URI
      // collapses to `/inbox`; the default constraint rejects it instead
      // of invoking a handler with a missing identifier.
      equal(router.route("/inbox"), null);
      equal(router.route("//inbox"), null);
    });

    await t.step("nullable:true opts the unbound form back in", () => {
      const router = new Router([
        [
          "{/identifier}/inbox",
          "inbox",
          { variables: { identifier: { nullable: true } } },
        ],
      ]);
      deepEqual(router.route("/inbox"), {
        name: "inbox",
        template: "{/identifier}/inbox",
        values: { identifier: null },
      });
      deepEqual(router.route("/alice/inbox"), {
        name: "inbox",
        template: "{/identifier}/inbox",
        values: { identifier: "alice" },
      });
    });
  },
);
