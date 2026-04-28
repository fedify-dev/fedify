import { test } from "@fedify/fixture";
import { equal } from "node:assert/strict";
import { parseTemplate } from "./template.ts";
import type { ExpandContext } from "./types.ts";

const vars: ExpandContext = {
  count: ["one", "two", "three"],
  dom: ["example", "com"],
  dub: "me/too",
  hello: "Hello World!",
  half: "50%",
  var: "value",
  who: "fred",
  base: "http://example.com/home/",
  path: "/foo/bar",
  list: ["red", "green", "blue"],
  keys: { semi: ";", dot: ".", comma: "," },
  v: "6",
  x: "1024",
  y: "768",
  empty: "",
  empty_keys: {},
  undef: null,
  semi: ";",
  year: ["1965", "2000", "2012"],
};

type Case = readonly [template: string, expanded: string];

async function runCases(
  t: Deno.TestContext,
  cases: readonly Case[],
  context: ExpandContext = vars,
): Promise<void> {
  for (const [template, expected] of cases) {
    await t.step(`${template} => ${expected}`, () => {
      equal(parseTemplate(template).expand(context), expected);
    });
  }
}

test("Section 1.2 — Level 1 (Simple String Expansion)", async (t) => {
  await runCases(t, [
    ["{var}", "value"],
    ["{hello}", "Hello%20World%21"],
  ]);
});

test("Section 1.2 — Level 2 (Reserved + Fragment Expansion)", async (t) => {
  await runCases(t, [
    ["{+var}", "value"],
    ["{+hello}", "Hello%20World!"],
    ["{+path}/here", "/foo/bar/here"],
    ["here?ref={+path}", "here?ref=/foo/bar"],
    ["X{#var}", "X#value"],
    ["X{#hello}", "X#Hello%20World!"],
  ]);
});

test("Section 1.2 — Level 3 (Multiple Variables, More Operators)", async (t) => {
  await runCases(t, [
    ["map?{x,y}", "map?1024,768"],
    ["{x,hello,y}", "1024,Hello%20World%21,768"],
    ["{+x,hello,y}", "1024,Hello%20World!,768"],
    ["{+path,x}/here", "/foo/bar,1024/here"],
    ["{#x,hello,y}", "#1024,Hello%20World!,768"],
    ["{#path,x}/here", "#/foo/bar,1024/here"],
    ["X{.var}", "X.value"],
    ["X{.x,y}", "X.1024.768"],
    ["{/var}", "/value"],
    ["{/var,x}/here", "/value/1024/here"],
    ["{;x,y}", ";x=1024;y=768"],
    ["{;x,y,empty}", ";x=1024;y=768;empty"],
    ["{?x,y}", "?x=1024&y=768"],
    ["{?x,y,empty}", "?x=1024&y=768&empty="],
    ["?fixed=yes{&x}", "?fixed=yes&x=1024"],
    ["{&x,y,empty}", "&x=1024&y=768&empty="],
  ]);
});

test("Section 1.2 — Level 4 (Value Modifiers)", async (t) => {
  await runCases(t, [
    ["{var:3}", "val"],
    ["{var:30}", "value"],
    ["{list}", "red,green,blue"],
    ["{list*}", "red,green,blue"],
    ["{keys}", "semi,%3B,dot,.,comma,%2C"],
    ["{keys*}", "semi=%3B,dot=.,comma=%2C"],
    ["{+path:6}/here", "/foo/b/here"],
    ["{+list}", "red,green,blue"],
    ["{+list*}", "red,green,blue"],
    ["{+keys}", "semi,;,dot,.,comma,,"],
    ["{+keys*}", "semi=;,dot=.,comma=,"],
    ["{#path:6}/here", "#/foo/b/here"],
    ["{#list}", "#red,green,blue"],
    ["{#list*}", "#red,green,blue"],
    ["{#keys}", "#semi,;,dot,.,comma,,"],
    ["{#keys*}", "#semi=;,dot=.,comma=,"],
    ["X{.var:3}", "X.val"],
    ["X{.list}", "X.red,green,blue"],
    ["X{.list*}", "X.red.green.blue"],
    ["X{.keys}", "X.semi,%3B,dot,.,comma,%2C"],
    ["X{.keys*}", "X.semi=%3B.dot=..comma=%2C"],
    ["{/var:1,var}", "/v/value"],
    ["{/list}", "/red,green,blue"],
    ["{/list*}", "/red/green/blue"],
    ["{/list*,path:4}", "/red/green/blue/%2Ffoo"],
    ["{/keys}", "/semi,%3B,dot,.,comma,%2C"],
    ["{/keys*}", "/semi=%3B/dot=./comma=%2C"],
    ["{;hello:5}", ";hello=Hello"],
    ["{;list}", ";list=red,green,blue"],
    ["{;list*}", ";list=red;list=green;list=blue"],
    ["{;keys}", ";keys=semi,%3B,dot,.,comma,%2C"],
    ["{;keys*}", ";semi=%3B;dot=.;comma=%2C"],
    ["{?var:3}", "?var=val"],
    ["{?list}", "?list=red,green,blue"],
    ["{?list*}", "?list=red&list=green&list=blue"],
    ["{?keys}", "?keys=semi,%3B,dot,.,comma,%2C"],
    ["{?keys*}", "?semi=%3B&dot=.&comma=%2C"],
    ["{&var:3}", "&var=val"],
    ["{&list}", "&list=red,green,blue"],
    ["{&list*}", "&list=red&list=green&list=blue"],
    ["{&keys}", "&keys=semi,%3B,dot,.,comma,%2C"],
    ["{&keys*}", "&semi=%3B&dot=.&comma=%2C"],
  ]);
});

test("Section 2.4.1 — Prefix Modifier", async (t) => {
  await runCases(t, [
    ["{var}", "value"],
    ["{var:20}", "value"],
    ["{var:3}", "val"],
    ["{semi}", "%3B"],
    ["{semi:2}", "%3B"],
  ]);
});

test("Section 2.4.2 — Composite (Explode) Values", async (t) => {
  await runCases(t, [
    ["find{?year*}", "find?year=1965&year=2000&year=2012"],
    ["www{.dom*}", "www.example.com"],
  ]);
});

test("Section 3.2.1 — Variable Expansion (List with Various Operators)", async (t) => {
  await runCases(t, [
    ["{count}", "one,two,three"],
    ["{count*}", "one,two,three"],
    ["{/count}", "/one,two,three"],
    ["{/count*}", "/one/two/three"],
    ["{;count}", ";count=one,two,three"],
    ["{;count*}", ";count=one;count=two;count=three"],
    ["{?count}", "?count=one,two,three"],
    ["{?count*}", "?count=one&count=two&count=three"],
    ["{&count*}", "&count=one&count=two&count=three"],
  ]);
});

test("Section 3.2.2 — Simple String Expansion: {var}", async (t) => {
  await runCases(t, [
    ["{var}", "value"],
    ["{hello}", "Hello%20World%21"],
    ["{half}", "50%25"],
    ["O{empty}X", "OX"],
    ["O{undef}X", "OX"],
    ["{x,y}", "1024,768"],
    ["{x,hello,y}", "1024,Hello%20World%21,768"],
    ["?{x,empty}", "?1024,"],
    ["?{x,undef}", "?1024"],
    ["?{undef,y}", "?768"],
    ["{var:3}", "val"],
    ["{var:30}", "value"],
    ["{list}", "red,green,blue"],
    ["{list*}", "red,green,blue"],
    ["{keys}", "semi,%3B,dot,.,comma,%2C"],
    ["{keys*}", "semi=%3B,dot=.,comma=%2C"],
  ]);
});

test("Section 3.2.3 — Reserved Expansion: {+var}", async (t) => {
  await runCases(t, [
    ["{+var}", "value"],
    ["{+hello}", "Hello%20World!"],
    ["{+half}", "50%25"],
    ["{base}index", "http%3A%2F%2Fexample.com%2Fhome%2Findex"],
    ["{+base}index", "http://example.com/home/index"],
    ["O{+empty}X", "OX"],
    ["O{+undef}X", "OX"],
    ["{+path}/here", "/foo/bar/here"],
    ["here?ref={+path}", "here?ref=/foo/bar"],
    ["up{+path}{var}/here", "up/foo/barvalue/here"],
    ["{+x,hello,y}", "1024,Hello%20World!,768"],
    ["{+path,x}/here", "/foo/bar,1024/here"],
    ["{+path:6}/here", "/foo/b/here"],
    ["{+list}", "red,green,blue"],
    ["{+list*}", "red,green,blue"],
    ["{+keys}", "semi,;,dot,.,comma,,"],
    ["{+keys*}", "semi=;,dot=.,comma=,"],
  ]);
});

test("Section 3.2.4 — Fragment Expansion: {#var}", async (t) => {
  await runCases(t, [
    ["{#var}", "#value"],
    ["{#hello}", "#Hello%20World!"],
    ["{#half}", "#50%25"],
    ["foo{#empty}", "foo#"],
    ["foo{#undef}", "foo"],
    ["{#x,hello,y}", "#1024,Hello%20World!,768"],
    ["{#path,x}/here", "#/foo/bar,1024/here"],
    ["{#path:6}/here", "#/foo/b/here"],
    ["{#list}", "#red,green,blue"],
    ["{#list*}", "#red,green,blue"],
    ["{#keys}", "#semi,;,dot,.,comma,,"],
    ["{#keys*}", "#semi=;,dot=.,comma=,"],
  ]);
});

test("Section 3.2.5 — Label Expansion with Dot-Prefix: {.var}", async (t) => {
  await runCases(t, [
    ["{.who}", ".fred"],
    ["{.who,who}", ".fred.fred"],
    ["{.half,who}", ".50%25.fred"],
    ["www{.dom*}", "www.example.com"],
    ["X{.var}", "X.value"],
    ["X{.empty}", "X."],
    ["X{.undef}", "X"],
    ["X{.var:3}", "X.val"],
    ["X{.list}", "X.red,green,blue"],
    ["X{.list*}", "X.red.green.blue"],
    ["X{.keys}", "X.semi,%3B,dot,.,comma,%2C"],
    ["X{.keys*}", "X.semi=%3B.dot=..comma=%2C"],
    ["X{.empty_keys}", "X"],
    ["X{.empty_keys*}", "X"],
  ]);
});

test("Section 3.2.6 — Path Segment Expansion: {/var}", async (t) => {
  await runCases(t, [
    ["{/who}", "/fred"],
    ["{/who,who}", "/fred/fred"],
    ["{/half,who}", "/50%25/fred"],
    ["{/who,dub}", "/fred/me%2Ftoo"],
    ["{/var}", "/value"],
    ["{/var,empty}", "/value/"],
    ["{/var,undef}", "/value"],
    ["{/var,x}/here", "/value/1024/here"],
    ["{/var:1,var}", "/v/value"],
    ["{/list}", "/red,green,blue"],
    ["{/list*}", "/red/green/blue"],
    ["{/list*,path:4}", "/red/green/blue/%2Ffoo"],
    ["{/keys}", "/semi,%3B,dot,.,comma,%2C"],
    ["{/keys*}", "/semi=%3B/dot=./comma=%2C"],
  ]);
});

test("Section 3.2.7 — Path-Style Parameter Expansion: {;var}", async (t) => {
  await runCases(t, [
    ["{;who}", ";who=fred"],
    ["{;half}", ";half=50%25"],
    ["{;empty}", ";empty"],
    ["{;v,empty,who}", ";v=6;empty;who=fred"],
    ["{;v,bar,who}", ";v=6;who=fred"],
    ["{;x,y}", ";x=1024;y=768"],
    ["{;x,y,empty}", ";x=1024;y=768;empty"],
    ["{;x,y,undef}", ";x=1024;y=768"],
    ["{;hello:5}", ";hello=Hello"],
    ["{;list}", ";list=red,green,blue"],
    ["{;list*}", ";list=red;list=green;list=blue"],
    ["{;keys}", ";keys=semi,%3B,dot,.,comma,%2C"],
    ["{;keys*}", ";semi=%3B;dot=.;comma=%2C"],
  ]);
});

test("Section 3.2.8 — Form-Style Query Expansion: {?var}", async (t) => {
  await runCases(t, [
    ["{?who}", "?who=fred"],
    ["{?half}", "?half=50%25"],
    ["{?x,y}", "?x=1024&y=768"],
    ["{?x,y,empty}", "?x=1024&y=768&empty="],
    ["{?x,y,undef}", "?x=1024&y=768"],
    ["{?var:3}", "?var=val"],
    ["{?list}", "?list=red,green,blue"],
    ["{?list*}", "?list=red&list=green&list=blue"],
    ["{?keys}", "?keys=semi,%3B,dot,.,comma,%2C"],
    ["{?keys*}", "?semi=%3B&dot=.&comma=%2C"],
  ]);
});

test("Section 3.2.9 — Form-Style Query Continuation: {&var}", async (t) => {
  await runCases(t, [
    ["{&who}", "&who=fred"],
    ["{&half}", "&half=50%25"],
    ["?fixed=yes{&x}", "?fixed=yes&x=1024"],
    ["{&x,y,empty}", "&x=1024&y=768&empty="],
    ["{&x,y,undef}", "&x=1024&y=768"],
    ["{&var:3}", "&var=val"],
    ["{&list}", "&list=red,green,blue"],
    ["{&list*}", "&list=red&list=green&list=blue"],
    ["{&keys}", "&keys=semi,%3B,dot,.,comma,%2C"],
    ["{&keys*}", "&semi=%3B&dot=.&comma=%2C"],
  ]);
});

test(
  "Section 1.1 — Introductory Examples (Form-style with Undef Cases)",
  async (t) => {
    const template = "http://www.example.com/foo{?query,number}";
    await t.step("query=mycelium, number=100", () => {
      equal(
        parseTemplate(template).expand({ query: "mycelium", number: 100 }),
        "http://www.example.com/foo?query=mycelium&number=100",
      );
    });
    await t.step("query undefined, number=100", () => {
      equal(
        parseTemplate(template).expand({ query: null, number: 100 }),
        "http://www.example.com/foo?number=100",
      );
    });
    await t.step("query and number both undefined", () => {
      equal(
        parseTemplate(template).expand({ query: null, number: null }),
        "http://www.example.com/foo",
      );
    });
  },
);

test("Section 2.4.2 — Composite Address Example", () => {
  equal(
    parseTemplate("/mapper{?address*}").expand({
      address: { city: "Newport Beach", state: "CA" },
    }),
    "/mapper?city=Newport%20Beach&state=CA",
  );
});
