// Borrowed from https://github.com/hugoalh/http-header-link-es
import { deepStrictEqual, throws } from "node:assert";
import { test } from "../testing/mod.ts";
import { HttpHeaderLink } from "./link.ts";

test("String Good 1", () => {
  const instance = new HttpHeaderLink(
    `<https://example.com>; rel="preconnect"`,
  );
  deepStrictEqual(instance.hasParameter("rel", "preconnect"), true);
  deepStrictEqual(instance.hasParameter("rel", "connect"), false);
  deepStrictEqual(instance.hasParameter("rel", "postconnect"), false);
  deepStrictEqual(instance.getByRel("preconnect")[0][0], "https://example.com");
});

test("String Good 2", () => {
  const instance = new HttpHeaderLink(`<https://example.com>; rel=preconnect`);
  deepStrictEqual(instance.hasParameter("rel", "preconnect"), true);
  deepStrictEqual(instance.hasParameter("rel", "connect"), false);
  deepStrictEqual(instance.hasParameter("rel", "postconnect"), false);
  deepStrictEqual(instance.getByRel("preconnect")[0][0], "https://example.com");
});

test("String Good 3", () => {
  const instance = new HttpHeaderLink(
    `<https://example.com/%E8%8B%97%E6%9D%A1>; rel="preconnect"`,
  );
  deepStrictEqual(instance.hasParameter("rel", "preconnect"), true);
  deepStrictEqual(instance.hasParameter("rel", "connect"), false);
  deepStrictEqual(instance.hasParameter("rel", "postconnect"), false);
  deepStrictEqual(
    instance.getByRel("preconnect")[0][0],
    "https://example.com/苗条",
  );
});

test("String Good 4", () => {
  const instance = new HttpHeaderLink(
    `<https://one.example.com>; rel="preconnect", <https://two.example.com>; rel="preconnect", <https://three.example.com>; rel="preconnect"`,
  );
  deepStrictEqual(instance.hasParameter("rel", "preconnect"), true);
  deepStrictEqual(instance.hasParameter("rel", "connect"), false);
  deepStrictEqual(instance.hasParameter("rel", "postconnect"), false);
  deepStrictEqual(
    instance.getByRel("preconnect")[0][0],
    "https://one.example.com",
  );
  deepStrictEqual(
    instance.getByRel("preconnect")[1][0],
    "https://two.example.com",
  );
  deepStrictEqual(
    instance.getByRel("preconnect")[2][0],
    "https://three.example.com",
  );
});

test("String Good 5", () => {
  const instance = new HttpHeaderLink();
  deepStrictEqual(instance.hasParameter("rel", "preconnect"), false);
  deepStrictEqual(instance.hasParameter("rel", "connect"), false);
  deepStrictEqual(instance.hasParameter("rel", "postconnect"), false);
  deepStrictEqual(instance.entries().length, 0);
});

test("Entries Good 1", () => {
  const instance = new HttpHeaderLink([["https://one.example.com", {
    rel: "preconnect",
  }]]);
  deepStrictEqual(instance.hasParameter("rel", "preconnect"), true);
  deepStrictEqual(instance.entries().length, 1);
  deepStrictEqual(
    instance.toString(),
    `<https://one.example.com>; rel="preconnect"`,
  );
});

test("String Bad 1", () => {
  throws(() => {
    new HttpHeaderLink(`https://bad.example; rel="preconnect"`);
  });
});
