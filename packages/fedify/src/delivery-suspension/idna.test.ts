import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { test } from "@fedify/fixture";
import {
  IDNA_DATA_SHA256,
  IDNA_TABLES,
  IDNA_UNICODE_VERSION,
} from "./idna-data.ts";
import {
  decodePunycode,
  encodePunycode,
  idnaProperty,
  validateIdnaHostname,
} from "./idna.ts";

function alabel(label: string): string {
  return `xn--${encodePunycode(label)}`;
}

test("delivery suspension IDNA validates canonical Unicode 12 A-labels", () => {
  const vectors = [
    ["faß", "xn--fa-hia"],
    ["l·l", "xn--ll-0ea"],
    ["͵β", "xn--wva6j"],
    ["א׳", "xn--4db4e"],
    ["カ・ナ", "xn--lck2c6g"],
    ["ب\u200cب", "xn--ngba799q"],
    ["क्‍ष", "xn--11b2ezcw70k"],
    ["bücher", "xn--bcher-kva"],
    ["𐐨--b", "xn----b-2b1t"],
  ];
  for (const [unicode, ascii] of vectors) {
    equal(alabel(unicode), ascii, unicode);
    equal(decodePunycode(ascii.slice(4)), unicode, ascii);
    equal(validateIdnaHostname(`${ascii}.example`), null, unicode);
  }
  for (const label of [
    "क्‌ष",
    "ب\u200cا", // D + ZWNJ + R.
    "\u{10acd}\u200c\u{10ac0}", // L + ZWNJ + D.
    "بَ‌َب",
    "א״",
    "カ・",
    "漢・",
    "ひ・",
    "ب١",
    "ب۱",
    "ب١َ",
    "א",
  ]) {
    equal(validateIdnaHostname(`${alabel(label)}.example`), null, label);
  }
  equal(validateIdnaHostname("123.example"), null);
  equal(validateIdnaHostname("xn--fa-hia.example."), null);
});

test("delivery suspension IDNA rejects invalid context and normalization", () => {
  const invalid = [
    "𐐨a--b",
    "a·a",
    "l·a",
    "a·l",
    "β͵",
    "͵a",
    "a׳",
    "a״",
    "׳א",
    "a・b",
    "ب١۱",
    "ب۱١",
    "ب١1",
    "a‌b",
    "a‍b",
    "‌ب",
    "ب‌",
    "بَ‌a",
    "a‌َب",
    "ا\u200cب", // R cannot occur on the left of ZWNJ.
    "ب\u200c\u{10acd}", // L cannot occur on the right.
    "・",
    "क‍ष",
    "K",
    "e\u0301",
    "\u0301a",
    "☃",
    "😀",
    "ab--é",
    "-é",
    "é-",
    "\u{1e4d0}", // Assigned after Unicode 12.0.0.
    "\u0378", // Never assigned in the pinned repertoire.
  ];
  for (const label of invalid) {
    const ascii = alabel(label);
    equal(
      typeof validateIdnaHostname(`${ascii}.example`),
      "string",
      `${label} (${ascii})`,
    );
  }
  for (const hostname of [
    "xn--abc-",
    "xn--",
    "xn--a",
    "xn--z",
    "xn--99999999999999999999999999999999999999999999999999",
    "ab--cd",
    "-a",
    "a-",
    "a..b",
    "a_",
    ".",
    "é.example",
  ]) {
    equal(typeof validateIdnaHostname(hostname), "string", hostname);
  }
});

test("delivery suspension IDNA applies bidi rules to the whole decoded domain", () => {
  const hebrew = alabel("אב"),
    arabic = alabel("بب");
  for (const name of [
    `${hebrew}.example`,
    `${hebrew}.a1`,
    `${hebrew}.a-1`,
    `${hebrew}.${arabic}`,
    `${alabel("ب١")}.example`,
  ]) {
    equal(validateIdnaHostname(name), null, name);
  }
  for (const name of [
    `${hebrew}.1abc`,
    `123.${hebrew}`,
    `${alabel("aא")}.example`,
    `${alabel("אa")}.example`,
    `${alabel("א-")}.example`,
    `${alabel("1א")}.example`,
    `${alabel("ب١1")}.example`,
  ]) {
    equal(typeof validateIdnaHostname(name), "string", name);
  }
});

test("delivery suspension Punycode handles scalar boundaries and checked arithmetic", () => {
  for (const label of [
    "",
    "ascii",
    "mañana",
    "例え",
    "\u{10ffff}",
    "a\u{10000}b",
    "a\u{80}",
    "aööa",
  ]) {
    equal(decodePunycode(encodePunycode(label)), label);
  }
  for (const payload of [
    "!",
    "z",
    "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
  ]) {
    throws(() => decodePunycode(payload), RangeError, payload);
  }
});

test("delivery suspension IDNA enforces DNS label and domain boundaries", () => {
  equal(validateIdnaHostname("a".repeat(63)), null);
  equal(typeof validateIdnaHostname("a".repeat(64)), "string");
  const maximum = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
  equal(maximum.length, 253);
  equal(validateIdnaHostname(maximum), null);
  equal(validateIdnaHostname(`${maximum}.`), null);
  equal(typeof validateIdnaHostname(`${maximum}a`), "string");
});

test("delivery suspension Unicode 12 tables preserve source ranges and digest", async () => {
  equal(IDNA_UNICODE_VERSION, "12.0.0");
  const expected =
    "74d19af17cc5b9c29b470f1abe5858a66bd6c221ba8831af65cf143df9d81cd7";
  equal(IDNA_DATA_SHA256, expected);
  const bytes = new TextEncoder().encode(JSON.stringify(IDNA_TABLES));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  equal(
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
    expected,
  );
  for (const key of Object.keys(IDNA_TABLES) as (keyof typeof IDNA_TABLES)[]) {
    const ranges = IDNA_TABLES[key];
    for (let index = 0; index < ranges.length; index += 3) {
      const [first, last, value] = ranges.slice(index, index + 3);
      equal(first <= last && value > 0, true);
      if (index) equal(ranges[index - 2] < first, true);
      equal(idnaProperty(key, first), value);
      equal(idnaProperty(key, last), value);
      if (index === 0 || ranges[index - 2] + 1 < first)
        equal(idnaProperty(key, first - 1), 0);
      if (index + 3 === ranges.length || ranges[index + 3] > last + 1)
        equal(idnaProperty(key, last + 1), 0);
    }
  }
  // These ranges use UnicodeData First/Last records, not per-character lines.
  deepStrictEqual(
    [0x4e00, 0x5000, 0x9fef].map((cp) => idnaProperty("assigned", cp)),
    [1, 1, 1],
  );
  equal(idnaProperty("bidi", 0x5000), 1);
  equal(idnaProperty("assigned", 0x1e4d0), 0);
  equal(idnaProperty("assigned", 0xe001), 1);
  equal(idnaProperty("validity", 0xe001), 0);
  equal(idnaProperty("virama", 0x094d), 1);
  equal(idnaProperty("joining", 0x064e), 4);
});
