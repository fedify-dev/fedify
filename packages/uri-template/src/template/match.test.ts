import { test } from "@fedify/fixture";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { PrefixModifierNotApplicableError } from "./errors.ts";
import match from "./match.ts";
import Template from "./template.ts";

test("match rejects impossible output before backtracking", () => {
  for (const separator of [":", "@"]) {
    const template = new Template(
      `/o/{a}${separator}{b}${separator}{c}${separator}{d}${separator}{e}`,
    );
    const uri = `/o/${separator.repeat(12)}`;
    let calls = 0;
    equal(
      match(template.tokens, uri, (context) => {
        if (++calls > 64) throw new Error("excessive roundtrip attempts");
        return template.expand(context) === uri;
      }),
      null,
    );
    equal(calls, 0);
  }
});

test("match preserves whole-template interpretations", () => {
  deepEqual(new Template("{?x*,y*}/{y*}").match("?a=1&a=1/a=1"), {
    x: { a: "1" },
    y: { a: "1" },
  });
  const repeated = new Template("{x*,y*},{x*}").match("a=1,a=1,a=1");
  deepEqual(repeated, { y: { a: "1" }, x: { a: "1" } });
  deepEqual(Object.keys(repeated!), ["y", "x"]);
  deepEqual(new Template("{+x*}{+x,y*}").match(","), { x: { "": "" } });
});

test("match counts Unicode literals across token boundaries", () => {
  const template = new Template("\ud83d{x}\ude42", { strict: false });
  deepEqual(template.match("🙂"), { x: "" });
  equal(template.expand({ x: "" }), "🙂");
});

test("match preserves emitted syntax and literal characters", () => {
  const cases: readonly [string, string][] = [
    ["{x}", "a,b"],
    ["{x*}", "a=b"],
    ["{+x}", "a=b"],
    ["{#x}", "#a=b"],
    ["{.x*}", ".a=b"],
    ["{/x*}", "/a=b"],
    ["{;x}", ";x"],
    ["{?x}", "?x=a"],
    ["{&x}", "&x=a"],
    ["/🙂/{x}@{y}", "/🙂/a@b"],
    ["/@/{x}/@/{y}", "/@/a/@/b"],
    ["{x}{y}", "%E2%82%AC%C3%A9"],
    ["{x}", "%253A"],
    ["{x}", "%25FF"],
    ["{+x}", "%ff"],
    ["{#x}", "#%FF"],
    ["%FF/{x}", "%FF/value"],
    ["{?%FF}", "?%FF=value"],
    ["{?%ff}", "?%ff=value"],
  ];
  for (const [pattern, uri] of cases) {
    const template = new Template(pattern);
    const context = template.match(uri);
    ok(context != null, `${pattern} should match ${uri}`);
    equal(template.expand(context), uri);
  }
  equal(new Template("/@/{x}/@/{y}").match("/@/a/b/@"), null);
  for (const literal of ["%", "%3", "%zz"]) {
    const template = new Template(`${literal}/{x}`, { strict: false });
    deepEqual(template.match(`${literal}/value`), { x: "value" });
  }
});

test("match preserves prefix diagnostics and captured options", () => {
  for (const strict of [true, false]) {
    const errors: string[] = [];
    const options = {
      strict,
      report: (error: Error) => errors.push(error.name),
    };
    const template = new Template("{bad}!{/x:1}{x}", options);
    options.strict = !strict;
    options.report = () => errors.push("replacement reporter");
    if (strict) {
      throws(() => template.match("a:b!c,d"), PrefixModifierNotApplicableError);
    } else {
      equal(template.match("a:b!c,d"), null);
    }
    deepEqual(
      errors,
      Array(strict ? 1 : 2).fill("PrefixModifierNotApplicableError"),
    );
  }
  throws(
    () => new Template("{y:3,y*}").match("a=b"),
    PrefixModifierNotApplicableError,
  );
  deepEqual(new Template("{x:1}/{x}").match("a/abc"), { x: "abc" });
  deepEqual(new Template("{x}/{x:1}").match("abc/a"), { x: "abc" });
});
