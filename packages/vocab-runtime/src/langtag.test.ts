import { deepStrictEqual } from "node:assert";
import { test } from "node:test";
import { normalizeLanguageTag } from "./langtag.ts";

test("normalizeLanguageTag() removes extlang subtags", () => {
  const cases: [string, string][] = [
    ["zh-yue", "yue"],
    ["zh-YUE", "yue"],
    ["ZH-Yue-hk", "yue-hk"],
    ["zh-yue-HK", "yue-HK"],
    ["zh-cmn-Hant", "cmn-Hant"],
    ["zh-yue-u-nu-hanidec", "yue-u-nu-hanidec"],
    ["sgn-ase", "ase"],
    ["ar-arz", "arz"],
    ["ms-zlm", "zlm"],
    ["kok-gom", "gom"],
    ["koK-gom", "gom"],
    ["lv-ltg", "ltg"],
    ["sw-swc", "swc"],
    ["uz-uzs", "uzs"],
    // Valid tags never have more than one extlang, so only the first one is
    // removed and the result is still rejected by Intl.Locale:
    ["zh-yue-cmn", "yue-cmn"],
    ["zh-yue-", "yue-"],
  ];
  for (const [input, expected] of cases) {
    deepStrictEqual(normalizeLanguageTag(input), expected, input);
  }
});

test("normalizeLanguageTag() leaves other tags unchanged", () => {
  const tags = [
    "",
    "en",
    "en-US",
    "en-USA",
    "en-yue",
    "zh",
    "zh-Hant-TW",
    "yue",
    "yue-HK",
    "x-private",
    "i-klingon",
    "zh-min-nan",
    "koK-gom",
    "zh-yuK",
    "constructor-yue",
    "toString-yue",
  ];
  for (const tag of tags) {
    deepStrictEqual(normalizeLanguageTag(tag), tag, tag);
  }
});
