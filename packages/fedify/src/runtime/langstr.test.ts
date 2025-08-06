import { parseLanguageTag } from "@phensley/language-tag";
import { assertEquals } from "@std/assert";
import util from "node:util";
import { test } from "../testing/mod.ts";
import { LanguageString } from "./langstr.ts";

test("new LanguageString()", () => {
  const langStr = new LanguageString("Hello", "en");
  assertEquals(langStr.toString(), "Hello");
  assertEquals(langStr.language, parseLanguageTag("en"));

  assertEquals(new LanguageString("Hello", parseLanguageTag("en")), langStr);
});

test({
  name: "Deno.inspect(LanguageString)",
  ignore: !("Deno" in globalThis),
  fn() {
    const langStr = new LanguageString("Hello, 'world'", "en");
    assertEquals(
      Deno.inspect(langStr, { colors: false }),
      "<en> \"Hello, 'world'\"",
    );
  },
});

test("util.inspect(LanguageString)", () => {
  const langStr = new LanguageString("Hello, 'world'", "en");
  assertEquals(
    util.inspect(langStr, { colors: false }),
    "<en> \"Hello, 'world'\"",
  );
});
