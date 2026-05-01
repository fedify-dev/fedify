import {
  assertHardTestSuite,
  assertPairTestSuite,
  assertWrongTestSuite,
} from "./assert.ts";
import _hardTestSuites from "./json/hard.json" with {
  type: "json",
};
import _fixedTestSuites from "./json/references/fixed.json" with {
  type: "json",
};
import _pairTestSuites from "./json/references/pairs.json" with {
  type: "json",
};
import _wrongTestSuites from "./json/wrong.json" with { type: "json" };
import type {
  FixedTemplateTestSuite,
  HardTestSuite,
  PairTestSuite,
  WrongTestSuite,
} from "./lib.ts";

assertPairTestSuite(_pairTestSuites);
assertWrongTestSuite(_wrongTestSuites);
assertHardTestSuite(_hardTestSuites);
export const pairTestSuites: readonly PairTestSuite[] = _pairTestSuites;
export const fixedTestSuites: readonly FixedTemplateTestSuite[] =
  _fixedTestSuites;
export const wrongTestSuites: readonly WrongTestSuite[] = _wrongTestSuites;
export const hardTestSuites: readonly HardTestSuite[] = _hardTestSuites;
export {
  createFixedTemplateTest,
  createTemplateHardTest,
  createTemplatePairTest,
  createWrongTemplateTest,
} from "./lib.ts";
