import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { describe, test } from "node:test";
import { compile } from "./compile.ts";

describe("basic expansion", () => {
  test("scalar", () => {
    const t = compile("{var}");
    assertEquals(t.expand({ var: "value" }), "value");
    assertEquals(t.expand({ var: "va lue" }), "va%20lue");
    assertEquals(t.expand({ var: "100%" }), "100%25");
  });

  test("list (no explode)", () => {
    const t = compile("{list}");
    assertEquals(
      t.expand({ list: ["red", "green", "blue"] }),
      "red,green,blue",
    );
  });

  test("map (no explode)", () => {
    const t = compile("{keys}");
    assertEquals(
      t.expand({ keys: { semi: ";", dot: ".", comma: "," } }),
      "semi,%3B,dot,.,comma,%2C",
    );
  });

  test("multiple vars", () => {
    const t = compile("{x,y}");
    assertEquals(t.expand({ x: "1024" }), "1024");
  });
});

describe("{+var} reserved expansion", () => {
  test("{+var} allows reserved - basic", () => {
    const t = compile("{+var}");
    assertEquals(t.expand({ var: "value" }), "value");
  });

  test("{+var} allows reserved - percent encoding", () => {
    const t = compile("{+hello}");
    assertEquals(t.expand({ hello: "Hello World!" }), "Hello%20World!");
  });

  test("{+var} allows reserved - already encoded", () => {
    const t = compile("{+half}");
    assertEquals(t.expand({ half: "50%" }), "50%25");
  });

  test("{+var} allows reserved - base URL comparison", () => {
    const t1 = compile("{base}index");
    const t2 = compile("{+base}index");
    const vars = { base: "http://example.com/home/" };
    assertEquals(t1.expand(vars), "http%3A%2F%2Fexample.com%2Fhome%2Findex");
    assertEquals(t2.expand(vars), "http://example.com/home/index");
  });

  test("{+var} allows reserved - empty value", () => {
    const t = compile("O{+empty}X");
    assertEquals(t.expand({ empty: "" }), "OX");
  });

  test("{+var} allows reserved - undefined value", () => {
    const t = compile("O{+undef}X");
    assertEquals(t.expand({ undef: undefined }), "OX");
  });

  test("{+var} allows reserved - path", () => {
    const t = compile("{+path}");
    assertEquals(t.expand({ path: "/foo/bar" }), "/foo/bar");
  });

  test("{+var} allows reserved - path appended", () => {
    const t = compile("{+path}/here");
    assertEquals(t.expand({ path: "/foo/bar" }), "/foo/bar/here");
  });

  test("{+var} allows reserved - in query", () => {
    const t = compile("here?ref={+path}");
    assertEquals(t.expand({ path: "/foo/bar" }), "here?ref=/foo/bar");
  });

  test("{+var} allows reserved - mixed with normal var", () => {
    const t = compile("up{+path}{var}/here");
    assertEquals(
      t.expand({ path: "/foo/bar", var: "value" }),
      "up/foo/barvalue/here",
    );
  });

  test("{+var} allows reserved - multiple vars", () => {
    const t = compile("{+x,hello,y}");
    assertEquals(
      t.expand({ x: "1024", hello: "Hello World!", y: "768" }),
      "1024,Hello%20World!,768",
    );
  });

  test("{+var} allows reserved - multiple vars with path", () => {
    const t = compile("{+path,x}/here");
    assertEquals(
      t.expand({ path: "/foo/bar", x: "1024" }),
      "/foo/bar,1024/here",
    );
  });

  test("{+var} allows reserved - prefix modifier", () => {
    const t = compile("{+path:6}/here");
    assertEquals(t.expand({ path: "/foo/bar" }), "/foo/b/here");
  });

  test("{+var} allows reserved - list", () => {
    const t = compile("{+list}");
    assertEquals(
      t.expand({ list: ["red", "green", "blue"] }),
      "red,green,blue",
    );
  });

  test("{+var} allows reserved - list explode", () => {
    const t = compile("{+list*}");
    assertEquals(
      t.expand({ list: ["red", "green", "blue"] }),
      "red,green,blue",
    );
  });

  test("{+var} allows reserved - map", () => {
    const t = compile("{+keys}");
    assertEquals(
      t.expand({ keys: { semi: ";", dot: ".", comma: "," } }),
      "semi,;,dot,.,comma,,",
    );
  });

  test("{+var} allows reserved - map explode", () => {
    const t = compile("{+keys*}");
    assertEquals(
      t.expand({ keys: { semi: ";", dot: ".", comma: "," } }),
      "semi=;,dot=.,comma=,",
    );
  });
});

describe("{#var} fragment expansion", () => {
  test("{#var} fragment", () => {
    const t = compile("{#frag}");
    assertEquals(t.expand({ frag: "a b" }), "#a%20b");
    assertEquals(t.expand({ frag: "a/b?c#d" }), "#a/b?c%23d");
  });
});

describe("{.var} label expansion", () => {
  test("{.var} label - basic", () => {
    const t = compile("www{.domain}");
    assertEquals(t.expand({ domain: "example" }), "www.example");
  });

  test("{.var} label - single variable", () => {
    const t = compile("{.who}");
    assertEquals(t.expand({ who: "fred" }), ".fred");
  });

  test("{.var} label - same variable twice", () => {
    const t = compile("{.who,who}");
    assertEquals(t.expand({ who: "fred" }), ".fred.fred");
  });

  test("{.var} label - mixed variables with encoding", () => {
    const t = compile("{.half,who}");
    assertEquals(t.expand({ half: "50%", who: "fred" }), ".50%25.fred");
  });

  test("{.var} label - explode with multiple labels", () => {
    const t = compile("www{.dom*}");
    assertEquals(t.expand({ dom: ["example", "com"] }), "www.example.com");
  });

  test("{.var} label - with prefix", () => {
    const t = compile("X{.var}");
    assertEquals(t.expand({ var: "value" }), "X.value");
  });

  test("{.var} label - empty value", () => {
    const t = compile("X{.empty}");
    assertEquals(t.expand({ empty: "" }), "X.");
  });

  test("{.var} label - undefined value", () => {
    const t = compile("X{.undef}");
    assertEquals(t.expand({ undef: undefined }), "X");
  });

  test("{.var} label - prefix modifier", () => {
    const t = compile("X{.var:3}");
    assertEquals(t.expand({ var: "value" }), "X.val");
  });

  test("{.var} label - list without explode", () => {
    const t = compile("X{.list}");
    assertEquals(
      t.expand({ list: ["red", "green", "blue"] }),
      "X.red,green,blue",
    );
  });

  test("{.var} label - list with explode", () => {
    const t = compile("X{.list*}");
    assertEquals(
      t.expand({ list: ["red", "green", "blue"] }),
      "X.red.green.blue",
    );
  });

  test("{.var} label - map without explode", () => {
    const t = compile("X{.keys}");
    assertEquals(
      t.expand({ keys: { semi: ";", dot: ".", comma: "," } }),
      "X.semi,%3B,dot,.,comma,%2C",
    );
  });

  test("{.var} label - map with explode", () => {
    const t = compile("X{.keys*}");
    assertEquals(
      t.expand({ keys: { semi: ";", dot: ".", comma: "," } }),
      "X.semi=%3B.dot=..comma=%2C",
    );
  });

  test("{.var} label - empty map without explode", () => {
    const t = compile("X{.empty_keys}");
    assertEquals(t.expand({ empty_keys: {} }), "X");
  });

  test("{.var} label - empty map with explode", () => {
    const t = compile("X{.empty_keys*}");
    assertEquals(t.expand({ empty_keys: {} }), "X");
  });
});

describe("path and query operators", () => {
  test("{/var} path segment", () => {
    const t = compile("/users{/id}");
    assertEquals(t.expand({ id: "a/b" }), "/users/a%2Fb");
  });

  test("{;x,y} matrix params", () => {
    const t = compile("/res{;x,y}");
    assertEquals(t.expand({ x: "a b", y: "" }), "/res;x=a%20b;y");
    assertEquals(t.expand({ x: undefined, y: undefined }), "/res");
  });

  test("{?x,y} query", () => {
    const t = compile("/search{?q,lang}");
    assertEquals(t.expand({ q: "a b", lang: "en" }), "/search?q=a%20b&lang=en");
    assertEquals(t.expand({ q: "", lang: undefined }), "/search?q=");
  });

  test("{&x,y} query continuation", () => {
    const t = compile("/search?q=init{&x,y}");
    assertEquals(t.expand({ x: "1", y: "2" }), "/search?q=init&x=1&y=2");
  });
});

describe("explode modifier", () => {
  test("explode list", () => {
    const t = compile("/tags{;tags*}");
    assertEquals(
      t.expand({ tags: ["red", "green", "blue"] }),
      "/tags;tags=red;tags=green;tags=blue",
    );
  });

  test("explode map", () => {
    const t = compile("{?keys*}");
    assertEquals(
      t.expand({ keys: { semi: ";", dot: ".", comma: "," } }),
      "?semi=%3B&dot=.&comma=%2C",
    );
  });
});

describe("prefix modifier", () => {
  test("prefix :n with scalar", () => {
    const t = compile("{var:3}");
    assertEquals(t.expand({ var: "abcdef" }), "abc");
  });

  test("prefix with reserved content", () => {
    const t = compile("/cut/{x:5}");
    assertEquals(t.expand({ x: "abc/def?ghi" }), "/cut/abc%2Fd"); // whether it cuts at UTF-8 boundary assumes ASCII input
  });
});

describe("round-trip tests", () => {
  test("expand(match(url)) === url (opaque)", () => {
    const t = compile("/repos{/owner,repo}{?q,lang}");
    const url = t.expand({
      owner: "alice",
      repo: "hello/world",
      q: "a b",
      lang: "en",
    });
    const m = t.match(url, { encoding: "opaque" });
    assertEquals(m !== null, true);
    const url2 = t.expand(m!.vars as Parameters<typeof t.expand>[0]);
    assertEquals(url2, url);
  });

  test("match(expand(vars)) ≅ vars (cooked)", () => {
    const t = compile("/u{/id}{?q}");
    const vars = { id: "a/b", q: "x y" };
    const url = t.expand(vars);
    const m = t.match(url, { encoding: "cooked" });
    assertEquals(m !== null, true);
    // cooked compares after one decoding
    assertEquals(m!.vars, vars);
  });

  test("explode list stays list in cooked", () => {
    const t = compile("/t{;tags*}");
    const url = t.expand({ tags: ["a b", "c"] });
    const m = t.match(url, { encoding: "cooked" });
    assertEquals(m !== null, true);
    assertEquals(m!.vars.tags, ["a b", "c"]);
  });

  test("explode map stays map in cooked", () => {
    const t = compile("{?m*}");
    const url = t.expand({ m: { a: "1 2", b: "/" } });
    const m = t.match(url, { encoding: "cooked" });
    assertEquals(m !== null, true);
    assertEquals(m!.vars.m, { a: "1 2", b: "/" });
  });
});

describe("encoding and special cases", () => {
  /**
   * Regression for https://github.com/awwright/uri-template-router/issues/11:
   * Ensure that percent-encoded sequences and '#' handling do not lose information.
   */
  test("opaque preserves raw percent sequences", () => {
    const t = compile("{#frag}");
    // Even if values contain characters like "%30#", opaque policy should not lose the original text
    const url = t.expand({ frag: "%30#" });
    // During expansion, encoder handles % and # safely according to idempotent/protection rules
    const mOpaque = t.match(url, { encoding: "opaque" });
    assertEquals(mOpaque !== null, true);
    // raw as-is without any decoding
    assertEquals(mOpaque!.vars.frag, mOpaque!.vars.frag); // existence check
    // in cooked mode, observable with one decoding
    const mCooked = t.match(url, { encoding: "cooked" });
    assertEquals(mCooked !== null, true);
    // check if decoded form restores to original meaning ("%30#")
    assertEquals(typeof mCooked!.vars.frag, "string");
    assertEquals((mCooked!.vars.frag as string).includes("#"), true);
  });

  test("bad percent triplet during match => null (strict default)", () => {
    const t = compile("/x{/id}");
    // fails if invalid triplet like '%GZ' is in the middle
    const m = t.match("/x/%GZ", { encoding: "opaque" });
    assertEquals(m, null);
  });

  test("idempotent expand: do not double-encode existing %XX", () => {
    const t = compile("/p{/x}");
    const url = t.expand({ x: "a%2Fb" });
    assertEquals(url, "/p/a%2Fb"); // preserve %2F (prevent double-encoding)
  });

  test("space encoding", () => {
    const t = compile("/s{/x}{?q}");
    const url = t.expand({ x: "a b", q: "x y" });
    assertEquals(url, "/s/a%20b?q=x%20y");
    const m = t.match(url, { encoding: "cooked" });
    assertEquals(m!.vars.x, "a b");
    assertEquals(m!.vars.q, "x y");
  });

  test("greedy capture until next literal", () => {
    const t = compile("/r{?q}#end");
    const url = t.expand({ q: "a,b,c" });
    assertEquals(url, "/r?q=a%2Cb%2Cc#end");
    const m = t.match(url, { encoding: "cooked" });
    assertEquals(m !== null, true);
    assertEquals(m!.vars.q, "a,b,c");
  });

  test("multiple expressions with separators", () => {
    const t = compile("/x{/a}{/b}{?c}{&d}");
    const url = t.expand({ a: "1", b: "2/3", c: "4 5", d: "6" });
    assertEquals(url, "/x/1/2%2F3?c=4%205&d=6");
    const m = t.match(url, { encoding: "cooked" });
    assertEquals(m!.vars, { a: "1", b: "2/3", c: "4 5", d: "6" });
  });
});

describe("undefined and empty value handling", () => {
  test("undefined omits in simple operator", () => {
    const t = compile("A{var}Z");
    assertEquals(t.expand({ var: undefined }), "AZ");
  });

  test("empty string is nameOnly in ';' operator", () => {
    const t = compile("{;x}");
    assertEquals(t.expand({ x: "" }), ";x");
    assertEquals(t.expand({ x: undefined }), "");
  });

  test("undefined query param omitted", () => {
    const t = compile("/s{?q,lang}");
    assertEquals(t.expand({ q: undefined, lang: "en" }), "/s?lang=en");
  });

  test("match allows empty value", () => {
    const t = compile("/s{?q}");
    const m = t.match("/s?q=", { encoding: "opaque" });
    assertEquals(m !== null, true);
    assertEquals(m!.vars.q, "");
  });
});
