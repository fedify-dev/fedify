import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "@fedify/fixture";
import {
  compareExactDateTimes,
  MAX_TIMESTAMP_LENGTH,
  parseExactDateTime,
} from "./time.ts";

test("delivery suspension exact dateTime grammar and Gregorian dates", () => {
  for (const value of [
    "1970-01-01T00:00:00Z",
    "0000-02-29T00:00:00Z",
    "-0000-02-29T00:00:00Z",
    "-0400-02-29T00:00:00+14:00",
    "12000-02-29T00:00:00-14:00",
    "2000-12-31T24:00:00.000Z",
    "2026-11-13T23:59:59.00000000000000001Z",
  ])
    strictEqual(parseExactDateTime(value) !== null, true, value);
  for (const value of [
    "1970-01-01T00:00:00",
    "1970-01-01 00:00:00Z",
    "19700101T000000Z",
    "+1970-01-01T00:00:00Z",
    "01970-01-01T00:00:00Z",
    "-001-01-01T00:00:00Z",
    "1900-02-29T00:00:00Z",
    "-0100-02-29T00:00:00Z",
    "2025-04-31T00:00:00Z",
    "2025-00-01T00:00:00Z",
    "2025-01-00T00:00:00Z",
    "2025-01-01T24:00:00.1Z",
    "2025-01-01T24:01:00Z",
    "2025-01-01T00:00:60Z",
    "2025-01-01T00:00:00+14:01",
    "2025-01-01T00:00:00-15:00",
    "2025-01-01T00:00:00+00:60",
    "2025-01-01T00:00:00Z[UTC]",
    "2025-01-01T00:00:00.Z",
    "2025-01-01T00:00:00z",
  ])
    strictEqual(parseExactDateTime(value), null, value);
});

test("delivery suspension exact dateTime offsets and fractional comparison", () => {
  const parsed = (value: string) => {
    const result = parseExactDateTime(value);
    if (result === null) throw new Error(value);
    return result;
  };
  for (const [a, b] of [
    ["1970-01-01T00:00:00Z", "1969-12-31T19:00:00-05:00"],
    ["2000-12-31T24:00:00.000Z", "2001-01-01T00:00:00+00:00"],
    ["0000-01-01T00:00:00Z", "-0000-01-01T00:00:00-00:00"],
    ["-0001-12-31T24:00:00Z", "0000-01-01T00:00:00Z"],
    ["0000-02-29T24:00:00Z", "0000-03-01T00:00:00Z"],
    ["10000-01-01T00:00:00.10Z", "10000-01-01T00:00:00.1000Z"],
  ])
    strictEqual(compareExactDateTimes(parsed(a), parsed(b)), 0, a);
  strictEqual(
    parsed("1970-01-01T00:00:00Z").seconds -
      parsed("0000-01-01T00:00:00Z").seconds,
    62167219200n,
  );
  strictEqual(
    parsed("0000-01-01T00:00:00Z").seconds -
      parsed("-0400-01-01T00:00:00Z").seconds,
    146097n * 86400n,
  );
  const earlier = parsed("2026-01-01T00:00:00.0000000000000000001Z");
  const later = parsed("2026-01-01T00:00:00.0000000000000000002Z");
  strictEqual(compareExactDateTimes(earlier, later), -1);
  strictEqual(compareExactDateTimes(later, earlier), 1);
  deepStrictEqual(parsed("0000-01-01T00:00:00Z"), {
    seconds: 0n,
    fraction: "",
  });
});

test("delivery suspension exact dateTime resource bound preserves arbitrary precision", () => {
  const prefix = "2000-01-01T00:00:00.";
  const longest =
    prefix + "1".repeat(MAX_TIMESTAMP_LENGTH - prefix.length - 1) + "Z";
  strictEqual(parseExactDateTime(longest) !== null, true);
  strictEqual(parseExactDateTime(longest.replace(/Z$/, "1Z")), null);
  strictEqual(
    parseExactDateTime("9".repeat(4000) + "-01-01T00:00:00Z") !== null,
    true,
  );
});
