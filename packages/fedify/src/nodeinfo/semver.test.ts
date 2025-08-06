import { assertEquals, assertThrows } from "@std/assert";
import { test } from "../testing/mod.ts";
import { formatSemVer, parseSemVer } from "./semver.ts";

test("parseSemVer() handles major", async (t) => {
  // [range, version]
  // Version should be detectable despite extra characters
  const versions: [string, number][] = [
    ["1.2.3", 1],
    [" 1.2.3 ", 1],
    [" 2.2.3-4 ", 2],
    [" 3.2.3-pre ", 3],
    ["v5.2.3", 5],
    [" v8.2.3 ", 8],
    ["\t13.2.3", 13],
  ];

  for (const [v, expected] of versions) {
    await t.step(v, () => {
      const version = parseSemVer(v);
      assertEquals(version.major, expected);
    });
  }
});

test("parseSemVer() handles minor", async (t) => {
  // [range, version]
  // Version should be detectable despite extra characters
  const versions: [string, number][] = [
    ["1.1.3", 1],
    [" 1.1.3 ", 1],
    [" 1.2.3-4 ", 2],
    [" 1.3.3-pre ", 3],
    ["v1.5.3", 5],
    [" v1.8.3 ", 8],
    ["\t1.13.3", 13],
  ];

  for (const [v, expected] of versions) {
    await t.step(v, () => {
      const version = parseSemVer(v);
      assertEquals(version.minor, expected);
    });
  }
});

test("parseSemVer() handles patch", async (t) => {
  // [range, version]
  // Version should be detectable despite extra characters
  const versions: [string, number][] = [
    ["1.2.1", 1],
    [" 1.2.1 ", 1],
    [" 1.2.2-4 ", 2],
    [" 1.2.3-pre ", 3],
    ["v1.2.5", 5],
    [" v1.2.8 ", 8],
    ["\t1.2.13", 13],
  ];
  for (const [v, expected] of versions) {
    await t.step(v, () => {
      const semver = parseSemVer(v);
      const actual = semver.patch;
      assertEquals(actual, expected);
    });
  }
});

test("parseSemVer() handles prerelease", async (t) => {
  // [prereleaseParts, version]
  const versions: [string, (string | number)[]][] = [
    ["1.2.2-alpha.1", ["alpha", 1]],
    ["0.6.1-1", [1]],
    ["1.0.0-beta.2", ["beta", 2]],
    ["v0.5.4-pre", ["pre"]],
    ["1.2.2-alpha.1", ["alpha", 1]],
    ["1.2.0-1b3-4", ["1b3-4"]],
    ["1.2.0-3.6-pre2", [3, "6-pre2"]],
    ["2.0.0", []],
  ];

  for (const [v, expected] of versions) {
    await t.step(`${v} : ${JSON.stringify(expected)}`, () => {
      const semver = parseSemVer(v);
      assertEquals(
        semver.prerelease,
        expected,
      );
    });
  }
});

test({
  name: "parseSemVer() throws on bad versions",
  fn: async (t) => {
    const versions: [unknown][] = [
      ["1.2." + new Array(256).join("1")], // too long
      ["1.2." + new Array(100).join("1")], // too big
      [null],
      [undefined],
      [{}],
      [[]],
      [false],
      [true],
      [0],
      [""],
      ["not a version"],
      ["∞.∞.∞"],
      ["NaN.NaN.NaN"],
    ];
    for (const [v] of versions) {
      await t.step(`${JSON.stringify(v)}`, () => {
        assertThrows(() => parseSemVer(v as string));
      });
    }
  },
});

test("parseSemVer() throws on invalid versions", async (t) => {
  const versions = ["1.2.3.4", "NOT VALID", 1.2, null, "Infinity.NaN.Infinity"];

  for (const v of versions) {
    await t.step(`invalid ${v}`, () => {
      assertThrows(
        function () {
          parseSemVer(v as string);
        },
        TypeError,
      );
    });
  }
});

test("parseSemVer() handles big numeric prerelease", function () {
  const r = parseSemVer(`1.2.3-beta.${Number.MAX_SAFE_INTEGER}0`);
  assertEquals(r.prerelease, ["beta", "90071992547409910"]);
});

test("formatSemVer()", async (t) => {
  const versions: [string, string][] = [
    ["0.0.0", "0.0.0"],
    ["1.2.3", "1.2.3"],
    ["1.2.3-pre", "1.2.3-pre"],
    ["1.2.3-pre.0", "1.2.3-pre.0"],
    ["1.2.3+b", "1.2.3+b"],
    ["1.2.3+b.0", "1.2.3+b.0"],
    ["1.2.3-pre.0+b.0", "1.2.3-pre.0+b.0"],
  ];

  for (const [version, expected] of versions) {
    await t.step({
      name: version,
      fn: () => {
        const v = parseSemVer(version)!;
        const actual = formatSemVer(v);
        assertEquals(actual, expected);
      },
    });
  }
});
