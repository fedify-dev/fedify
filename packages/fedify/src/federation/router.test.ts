import { test } from "@fedify/fixture";
import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { Router, RouterError, type RouterOptions } from "./router.ts";

function setUp(options: RouterOptions = {}): Router {
  const router = new Router(options);
  router.add("/users/{name}", "user");
  router.add(
    "/users/{name}/posts/{postId}" +
      (options.trailingSlashInsensitive ? "/" : ""),
    "post",
  );
  return router;
}

test("Router.clone()", () => {
  const original = setUp();
  const clone = original.clone();
  clone.add("/users/{name}/friends", "friends");

  assert(clone.has("friends"));
  assertEquals(clone.route("/users/alice/friends"), {
    name: "friends",
    template: "/users/{name}/friends",
    values: { name: "alice" },
  });
  assertFalse(original.has("friends"));
  assertEquals(original.route("/users/alice/friends"), null);
});

test("Router.add()", () => {
  const router = new Router();
  assertEquals(router.add("/users", "users"), new Set());
  assertEquals(router.add("/users/{name}", "user"), new Set(["name"]));
  assertEquals(
    router.add("/users/{name}/posts/{postId}", "post"),
    new Set([
      "name",
      "postId",
    ]),
  );
  assertThrows(() => router.add("foo", "name"), RouterError);
});

test("Router.route()", () => {
  let router = setUp();
  assertEquals(router.route("/users/alice"), {
    name: "user",
    template: "/users/{name}",
    values: { name: "alice" },
  });
  assertEquals(router.route("/users/bob/"), null);
  assertEquals(router.route("/users/alice/posts/123"), {
    name: "post",
    template: "/users/{name}/posts/{postId}",
    values: { name: "alice", postId: "123" },
  });
  assertEquals(router.route("/users/bob/posts/456/"), null);

  router = setUp({ trailingSlashInsensitive: true });
  assertEquals(router.route("/users/alice"), {
    name: "user",
    template: "/users/{name}",
    values: { name: "alice" },
  });
  assertEquals(router.route("/users/bob/"), {
    name: "user",
    template: "/users/{name}",
    values: { name: "bob" },
  });
  assertEquals(router.route("/users/alice/posts/123"), {
    name: "post",
    template: "/users/{name}/posts/{postId}/",
    values: { name: "alice", postId: "123" },
  });
  assertEquals(router.route("/users/bob/posts/456/"), {
    name: "post",
    template: "/users/{name}/posts/{postId}/",
    values: { name: "bob", postId: "456" },
  });
});

test("Router.build()", () => {
  const router = setUp();
  assertEquals(router.build("user", { name: "alice" }), "/users/alice");
  assertEquals(
    router.build("post", { name: "alice", postId: "123" }),
    "/users/alice/posts/123",
  );
});
