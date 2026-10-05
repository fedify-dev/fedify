import { deepStrictEqual, throws } from "node:assert";
import { test } from "node:test";
import util from "node:util";
import { LanguageString } from "./langstr.ts";

test("new LanguageString()", () => {
  const langStr = new LanguageString("Hello", "en");
  deepStrictEqual(langStr.toString(), "Hello");
  deepStrictEqual(langStr.locale, new Intl.Locale("en"));

  deepStrictEqual(new LanguageString("Hello", new Intl.Locale("en")), langStr);
});

test("new LanguageString() with extlang tags", () => {
  // Intl.Locale objects have no own enumerable properties, so their base names
  // are compared instead:
  deepStrictEqual(new LanguageString("你好", "zh-YUE").locale.baseName, "yue");
  deepStrictEqual(
    new LanguageString("你好", "zh-yue-HK").locale.baseName,
    "yue-HK",
  );
  // Whether cmn is canonicalized to zh depends on the runtime:
  deepStrictEqual(
    new LanguageString("你好", "zh-cmn-Hant").locale.baseName,
    new Intl.Locale("cmn-Hant").baseName,
  );
  throws(() => new LanguageString("Hello", "en-USA"), RangeError);
  throws(() => new LanguageString("你好", "zh-yue-"), RangeError);
});

test("Deno.inspect(LanguageString)", () => {
  const langStr = new LanguageString("Hello, 'world'", "en");
  deepStrictEqual(
    util.inspect(langStr, { colors: false }),
    "<en> \"Hello, 'world'\"",
  );
});

test("util.inspect(LanguageString)", () => {
  const langStr = new LanguageString("Hello, 'world'", "en");
  deepStrictEqual(
    util.inspect(langStr, { colors: false }),
    "<en> \"Hello, 'world'\"",
  );
});
