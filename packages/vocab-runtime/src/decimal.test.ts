import { deepStrictEqual, throws } from "node:assert";
import { test } from "node:test";
import { canParseDecimal, isDecimal, parseDecimal } from "./decimal.ts";
import {
  canParseDecimal as canParseDecimalFromModule,
  isDecimal as isDecimalFromModule,
  parseDecimal as parseDecimalFromModule,
} from "./mod.ts";

test("parseDecimal() accepts valid xsd:decimal lexical forms", () => {
  const values = [
    "-1.23",
    "12678967.543233",
    "+100000.00",
    "210",
    ".5",
    "5.",
    "0",
    "-0.0",
  ];

  for (const value of values) {
    deepStrictEqual(parseDecimal(value), value);
  }
});

test("isDecimal() reports valid xsd:decimal lexical forms", () => {
  deepStrictEqual(isDecimal("12.50"), true);
  deepStrictEqual(isDecimal(".5"), true);
  deepStrictEqual(isDecimal("1e3"), false);
  deepStrictEqual(isDecimal(" 12.50 "), false);
  deepStrictEqual(isDecimal("\t12.50\n"), false);
});

test("canParseDecimal() accepts whitespace-normalized xsd:decimal strings", () => {
  deepStrictEqual(canParseDecimal("12.50"), true);
  deepStrictEqual(canParseDecimal(" 12.50 "), true);
  deepStrictEqual(canParseDecimal("\t+100000.00\r\n"), true);
  deepStrictEqual(canParseDecimal("  .5  "), true);
  deepStrictEqual(canParseDecimal("1e3"), false);
  deepStrictEqual(canParseDecimal("1 2.50"), false);
  deepStrictEqual(canParseDecimal("1\t2.50"), false);
});

test("parseDecimal() normalizes XML Schema whitespace", () => {
  deepStrictEqual(parseDecimal("12.50"), "12.50");
  deepStrictEqual(parseDecimal(" 12.50 "), "12.50");
  deepStrictEqual(parseDecimal("\t+100000.00\r\n"), "+100000.00");
  deepStrictEqual(parseDecimal("  .5  "), ".5");
});

test("parseDecimal() rejects invalid xsd:decimal lexical forms", () => {
  const values = [
    "",
    ".",
    "+",
    "-",
    "1e3",
    "NaN",
    "INF",
    "1,2",
    "1..2",
    "1 2.3",
    "1\t2.3",
  ];

  for (const value of values) {
    throws(
      () => parseDecimal(value),
      {
        name: "TypeError",
        message: `${
          JSON.stringify(value)
        } is not a valid xsd:decimal lexical form.`,
      },
    );
  }
});

test("parseDecimal() is exported from the package root", () => {
  deepStrictEqual(parseDecimalFromModule("12.50"), "12.50");
});

test("canParseDecimal() is exported from the package root", () => {
  deepStrictEqual(canParseDecimalFromModule(" 12.50 "), true);
});

test("isDecimal() is exported from the package root", () => {
  deepStrictEqual(isDecimalFromModule("12.50"), true);
});
