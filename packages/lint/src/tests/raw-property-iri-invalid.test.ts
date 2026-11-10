import assert from "node:assert/strict";
import { test } from "node:test";
import { Linter } from "eslint";
import * as parser from "@typescript-eslint/parser";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/raw-property-iri-invalid.ts";
import { oxlintUnavailable, runOxlint } from "../lib/oxlint.ts";

const ruleName = "raw-property-iri-invalid";
const setup = 'import { getRawPropertyValues as read } from "@fedify/vocab";';
const writeSetup = 'import { withRawProperty as write } from "@fedify/vocab";';
const batchSetup =
  'import { withRawProperties as batch } from "@fedify/vocab";';
const cases: [string, string, string?][] = [
  ...[
    "",
    "as:",
    "https://example/path[0]",
    "https://[abc]/x",
    "https://a[::1]/x",
    "https://example:abc/p",
    "https://example:80:90/p",
    "https://a@b@example/p",
    "https://example/\ud800",
    "@id",
    "_:node",
    "content",
    "/x",
    "#x",
    "https://example/x y",
    "https://example/%xx",
    "https://example/#a#b",
    "https://example/\u0001",
    'https://example/"',
    "https://example/<",
    "https://example/>",
    "https://example/\\",
    "https://example/^",
    "https://example/`",
    "https://example/{",
    "https://example/|",
    "https://example/}",
  ].map((value): [string, string, string] => [
    `invalid ${JSON.stringify(value)}`,
    `${setup} read(obj, ${JSON.stringify(value)});`,
    "must be a full",
  ]),
  [
    "compact prefix",
    `${setup} read(obj, "as:content");`,
    'Did you mean "https://www.w3.org/ns/activitystreams#content"?',
  ],
  [
    "other scheme",
    `${setup} read(obj, "urn:example:property");`,
    "non-HTTP scheme",
  ],
  ["uppercase HTTPS", `${setup} read(obj, "HTTPS://example/prop");`],
  ["unicode IRI", `${setup} read(obj, "https://example/이름");`],
  ["aliased import", `${setup} read(obj, "content");`, "must be a full"],
  [
    "namespace",
    'import * as vocab from "@fedify/vocab"; vocab.getRawPropertyValue(obj, "content");',
    "must be a full",
  ],
  [
    "computed namespace",
    'import * as vocab from "@fedify/vocab"; vocab["getRawPropertyValue"](obj, "content");',
    "must be a full",
  ],
  [
    "shadowed function parameter",
    `${setup} function f(read) { read(obj, "content"); }`,
  ],
  [
    "shadowed namespace",
    'import * as vocab from "@fedify/vocab"; function f(vocab) { vocab.getRawPropertyValue(obj, "content"); }',
  ],
  [
    "hoisted shadow",
    `${setup} function f() { read(obj, "content"); var read; }`,
  ],
  ["block shadow", `${setup} { read(obj, "content"); const read = local; }`],
  [
    "destructured parameter",
    `${setup} function f({read}) { read(obj, "content"); }`,
  ],
  ["catch shadow", `${setup} try {} catch (read) { read(obj, "content"); }`],
  [
    "loop shadow",
    `${setup} for (const read of readers) { read(obj, "content"); }`,
  ],
  [
    "const",
    `${setup} const iri = "content"; read(obj, iri);`,
    "must be a full",
  ],
  [
    "const chain",
    `${setup} const iri = "content"; const key = iri; read(obj, key);`,
    "must be a full",
  ],
  [
    "const shadow",
    `${setup} const iri = "content"; function f(iri) { read(obj, iri); }`,
  ],
  ["const cycle", `${setup} const a = b; const b = a; read(obj, a);`],
  ["mutable binding ignored", `${setup} let iri = "content"; read(obj, iri);`],
  ["template", `${setup} read(obj, \`content\`);`, "must be a full"],
  ["dynamic template", `${setup} read(obj, \`https://example/\${key}\`);`],
  [
    "URL without base",
    `${setup} read(obj, new URL("content"));`,
    "must be a full",
  ],
  ["URL valid", `${setup} read(obj, new URL("https://example/key"));`],
  [
    "URL normalized before checking",
    `${setup} read(obj, new URL("https://example/a b"));`,
  ],
  [
    "URL const ignored, as it can be mutated",
    `${setup} const iri = new URL("about:blank"); iri.href = "https://example/p"; read(obj, iri);`,
  ],
  [
    "URL with base",
    `${setup} read(obj, new URL("content", "https://example/"));`,
  ],
  [
    "shadowed URL",
    `${setup} function f(URL) { read(obj, new URL("content")); }`,
  ],
  ["dynamic ignored", `${setup} read(obj, getIri());`],
  [
    "other module",
    'import { getRawPropertyValue } from "other-vocab"; getRawPropertyValue(obj, "content");',
  ],
  [
    "type import",
    'import type { getRawPropertyValue } from "@fedify/vocab"; getRawPropertyValue(obj, "content");',
  ],
  ...[
    "jsr:@fedify/vocab",
    "npm:@fedify/vocab",
    "jsr:@fedify/vocab@^2.5.0",
    "npm:@fedify/vocab@2.5.0",
    "@fedify/fedify/vocab",
    "jsr:@fedify/fedify@^2.5.0/vocab",
  ].map((source): [string, string, string] => [
    source,
    `import { getRawPropertyValue } from ${JSON.stringify(
      source,
    )}; getRawPropertyValue(obj, "content");`,
    "must be a full",
  ]),
];
cases.push(
  [
    "exported function",
    `${setup} export function f() { read(obj, "content"); }`,
    "must be a full",
  ],
  [
    "exported shadow",
    `${setup} export function f(read) { read(obj, "content"); }`,
  ],
  [
    "prototype prefix",
    `${setup} read(obj, "constructor:property");`,
    "non-HTTP scheme",
  ],
  [
    "single-quoted lone surrogate",
    `${setup} read(obj, 'https://example/\\uD800');`,
    "must be a full",
  ],
  [
    "single-quoted surrogate pair",
    `${setup} read(obj, 'https://example/\\uD83D\\uDE00');`,
  ],
  [
    "single-quoted double quote",
    `${setup} read(obj, 'https://example/"\\u0070');`,
    "must be a full",
  ],
  [
    "single-quoted valid",
    `${setup} read(obj, 'https://example/\\u0070rop\\'s');`,
  ],
  [
    "switch discriminant outside case scope",
    `${setup} const iri = "https://example/p"; switch (read(obj, iri)) { case 0: const iri = "content"; }`,
  ],
  [
    "namespace body scope",
    `${setup} const iri = "https://example/p"; namespace N { export const iri = "content"; var other = 1; } read(obj, iri);`,
  ],
  [
    "inside namespace body",
    `${setup} namespace N { const iri = "content"; read(obj, iri); }`,
  ],
  [
    "namespace shadows namespace import",
    'import * as vocab from "@fedify/vocab"; namespace vocab { export function getRawPropertyValue(o: unknown, i: string) {} } vocab.getRawPropertyValue({}, "content");',
  ],
  [
    "enum shadows namespace import",
    'import * as vocab from "@fedify/vocab"; enum vocab { getRawPropertyValue } vocab.getRawPropertyValue({}, "content");',
  ],
  [
    "type-only namespace inside ignored body",
    `${setup} namespace Outer { namespace read { export interface X {} } read(obj, "content"); }`,
  ],
  [
    "namespace with values shadows",
    `${setup} namespace Outer { namespace read { export const x = 1; } read(obj, "content"); }`,
  ],
  [
    "import-only namespace inside ignored body",
    `${setup} namespace Outer { namespace read { import X = Outer.Y; } read(obj, "content"); }`,
  ],
  [
    "import alias shadows outer bindings",
    `${setup} const iri = "content"; namespace M { export const iri = "https://example/p"; } namespace N { import iri = M.iri; read(obj, iri); }`,
  ],
  [
    "merged namespace members hide outer bindings",
    `${setup} const iri = "content"; namespace N { export const iri = "https://example/p"; } namespace N { read(obj, iri); }`,
  ],
  [
    "merged enum members hide outer bindings",
    `${setup} const iri = "content"; enum E { iri = "https://example/p" } enum E { V = (read(obj, iri), 0) }`,
  ],
  [
    "merged namespace exports shadow helpers",
    `${setup} namespace N { export function read(o: unknown, i: string) {} } namespace N { read({}, "content"); }`,
  ],
  [
    "ambient namespace members shadow helpers",
    `${setup} declare namespace N { function read(o: unknown, i: string): void; } namespace N { read({}, "content"); }`,
  ],
  [
    "nested ambient namespace members shadow helpers",
    `${setup} declare namespace N { namespace Inner { function read(o: unknown, i: string): void; } } namespace N { export namespace Inner { read({}, "content"); } }`,
  ],
  [
    "merged namespace exported variables shadow helpers",
    `${setup} namespace N { export const read = (o: unknown, i: string) => {}; } namespace N { read({}, "content"); }`,
  ],
  [
    "nested merged namespace exports shadow helpers",
    `${setup} namespace N { export namespace Inner { export function read(o: unknown, i: string) {} } } namespace N { export namespace Inner { read({}, "content"); } }`,
  ],
  [
    "dotted namespace exports shadow helpers",
    `${setup} namespace N.Inner { export function read(o: unknown, i: string) {} } namespace N { export namespace Inner { read({}, "content"); } }`,
  ],
  [
    "reopened dotted namespace exports shadow helpers",
    `${setup} namespace N.Inner { export function read(o: unknown, i: string) {} } namespace N.Inner { read({}, "content"); }`,
  ],
  [
    "dotted namespace locals in ignored body",
    `${setup} namespace N.Inner { function read(o: unknown, i: string) {} } namespace N { export namespace Inner { read({}, "content"); } }`,
  ],
  [
    "enclosing exports are visible in dotted namespaces",
    `${setup} namespace N { export function read(o: unknown, i: string) {} } namespace N.Inner { read({}, "content"); }`,
  ],
  [
    "intermediate dotted namespaces are exports",
    'import * as H from "@fedify/vocab"; namespace N.H { export function getRawPropertyValue(o: unknown, i: string) {} } namespace N.Other { H.getRawPropertyValue({}, "content"); }',
  ],
  [
    "dotted namespaces bind their first segment",
    'import * as N from "@fedify/vocab"; namespace N.Inner { export const x = 1; } N.getRawPropertyValue({}, "content");',
  ],
  [
    "enclosing locals in ignored dotted namespace",
    `${setup} namespace N { function read(o: unknown, i: string) {} } namespace N.Inner { read({}, "content"); }`,
  ],
  [
    "merged namespace locals in ignored body",
    `${setup} namespace N { function read(o: unknown, i: string) {} } namespace N { read({}, "content"); }`,
  ],
  [
    "unrelated namespace exports in ignored body",
    `${setup} namespace M { export function read(o: unknown, i: string) {} } namespace N { read({}, "content"); }`,
  ],
  [
    "merged enum members shadow helpers",
    `${setup} enum E { read = 1 } enum E { V = (read({}, "content"), 0) }`,
  ],
  [
    "enum members shadow outer bindings",
    `${setup} const iri = "content"; enum E { iri = "https://example/p", V = (read(obj, iri), 0) }`,
  ],
  [
    "enum initializers are ignored",
    `${setup} enum E { V = (read(obj, "content"), 0) }`,
  ],
  [
    "literal inside namespace body",
    `${setup} namespace N { read({}, "content"); }`,
  ],
  [
    "nested function inside namespace body",
    `${setup} namespace N { export function f() { read({}, "content"); } }`,
  ],
  [
    "nested function inside enum initializer",
    `${setup} enum E { V = (() => { read({}, "content"); return 0; })() }`,
  ],
  [
    "namespace import inside namespace body",
    'import * as vocab from "@fedify/vocab"; namespace N { vocab.getRawPropertyValue({}, "content"); }',
  ],
  [
    "local import alias inside namespace body",
    `${setup} namespace N { import localRead = read; localRead({}, "content"); }`,
  ],
  [
    "namespace declaration shadows named import",
    `${setup} namespace read {} read({}, "content");`,
  ],
  [
    "enum declaration shadows named import",
    `${setup} enum read { V } read({}, "content");`,
  ],
  [
    "namespace declaration before import stays opaque",
    `namespace read {} ${setup} read({}, "content");`,
  ],
  [
    "enum declaration before import stays opaque",
    `enum read { V } ${setup} read({}, "content");`,
  ],
  [
    "constant chain stops at namespace declaration",
    `${setup} namespace iri {} const iri = "content"; const key = iri; read({}, key);`,
  ],
  [
    "constant chain stops at enum declaration",
    `${setup} const iri = "content"; enum iri { V } const key = iri; read({}, key);`,
  ],
  [
    "ordinary call after namespace and enum bodies",
    `${setup} namespace N { read({}, "content"); } enum E { V = (read({}, "content"), 0) } read({}, "content");`,
    "must be a full",
  ],
  [
    "namespace var stays inside its body",
    `${setup} const iri = "content"; namespace N { var iri = "https://example/p"; } read({}, iri);`,
    "must be a full",
  ],
  [
    "dotted namespace does not bind inner names outside",
    `${setup} namespace N.read {} read({}, "content");`,
    "must be a full",
  ],
  ["numeric port", `${setup} read(obj, "https://u:p@example:8080/p");`],
  ["IPv6 authority", `${setup} read(obj, "https://[::1]/property");`],
  [
    "IPvFuture authority",
    `${setup} read(obj, "urn://[v1.fe80::a+en1]/p");`,
    "non-HTTP scheme",
  ],
  [
    "escaped template",
    `${setup} read(obj, \`con\\u0074ent\`);`,
    "must be a full",
  ],
);
const writerCases: [string, string, string?][] = [
  [
    "singular writer bare term",
    `${writeSetup} write(obj, "content", []);`,
    "must be a full",
  ],
  [
    "singular writer compact prefix",
    `${writeSetup} write(obj, "as:content", []);`,
    "non-HTTP scheme",
  ],
  [
    "singular writer other scheme",
    `${writeSetup} write(obj, "urn:example:property", []);`,
    "non-HTTP scheme",
  ],
  [
    "singular writer valid IRI",
    `${writeSetup} write(obj, "https://example/p", []);`,
  ],
  [
    "singular writer direct import",
    'import { withRawProperty } from "@fedify/vocab"; withRawProperty(obj, "content", undefined);',
    "must be a full",
  ],
  [
    "singular writer const chain",
    `${writeSetup} const iri = "content"; const key = iri; write(obj, key, []);`,
    "must be a full",
  ],
  [
    "singular writer template",
    `${writeSetup} write(obj, \`as:content\`, []);`,
    "non-HTTP scheme",
  ],
  [
    "singular writer inline URL",
    `${writeSetup} write(obj, new URL("as:content"), []);`,
    "non-HTTP scheme",
  ],
  [
    "singular writer normalized URL",
    `${writeSetup} write(obj, new URL("https://example/a b"), []);`,
  ],
  [
    "singular writer mutable URL constant",
    `${writeSetup} const iri = new URL("about:blank"); iri.href = "https://example/p"; write(obj, iri, []);`,
  ],
  [
    "singular writer shadowed URL",
    `${writeSetup} function f(URL) { write(obj, new URL("content"), []); }`,
  ],
  [
    "singular writer dynamic argument",
    `${writeSetup} write(obj, getIri(), []);`,
  ],
  [
    "singular writer ignores values",
    `${writeSetup} write(obj, "https://example/p", [{ "@value": "as:content" }]);`,
  ],
  [
    "singular writer namespace",
    'import * as vocab from "@fedify/vocab"; vocab.withRawProperty(obj, "content", []);',
    "must be a full",
  ],
  [
    "singular writer computed namespace",
    'import * as vocab from "@fedify/vocab"; vocab["withRawProperty"](obj, "as:content", []);',
    "non-HTTP scheme",
  ],
  [
    "batch writer direct import",
    'import { withRawProperties } from "@fedify/vocab"; withRawProperties(obj, { "content": undefined });',
    "must be a full",
  ],
  [
    "batch writer namespace",
    'import * as vocab from "@fedify/vocab"; vocab.withRawProperties(obj, { "content": [] });',
    "must be a full",
  ],
  [
    "batch writer computed namespace",
    'import * as vocab from "@fedify/vocab"; vocab["withRawProperties"](obj, [["content", []]]);',
    "must be a full",
  ],
  [
    "batch writer quoted key",
    `${batchSetup} batch(obj, { "as:content": [] });`,
    "non-HTTP scheme",
  ],
  [
    "batch writer valid key",
    `${batchSetup} batch(obj, { "https://example/p": [] });`,
  ],
  [
    "batch writer identifier key ignores binding",
    `${batchSetup} const content = "https://example/p"; batch(obj, { content: [] });`,
    "must be a full",
  ],
  [
    "batch writer shorthand key ignores binding",
    `${batchSetup} const content = "https://example/p"; batch(obj, { content });`,
    "must be a full",
  ],
  [
    "batch writer numeric key",
    `${batchSetup} batch(obj, { 42: [] });`,
    "must be a full",
  ],
  [
    "batch writer computed numeric key",
    `${batchSetup} batch(obj, { [42]: [] });`,
    "must be a full",
  ],
  [
    "batch writer review r1 prototype setter",
    `${batchSetup} batch(obj, { __proto__: null });`,
  ],
  [
    "batch writer review r1 quoted prototype setter",
    `${batchSetup} batch(obj, { "__proto__": null });`,
  ],
  [
    "batch writer review r1 escaped prototype setter",
    `${batchSetup} batch(obj, { "__pr\\u006fto__": null });`,
  ],
  [
    "batch writer review r1 prototype setter and own key",
    `${batchSetup} batch(obj, { __proto__: null, content: [] });`,
    'Raw property IRI "content"',
  ],
  [
    "batch writer review r1 computed prototype key",
    `${batchSetup} batch(obj, { ["__proto__"]: [] });`,
    'Raw property IRI "__proto__"',
  ],
  [
    "batch writer review r1 shorthand prototype key",
    `${batchSetup} const __proto__ = []; batch(obj, { __proto__ });`,
    'Raw property IRI "__proto__"',
  ],
  [
    "batch writer review r1 prototype method key",
    `${batchSetup} batch(obj, { __proto__() { return []; } });`,
  ],
  [
    "batch writer review r1 quoted prototype method key",
    `${batchSetup} batch(obj, { "__proto__"() { return []; } });`,
    'Raw property IRI "__proto__"',
  ],
  [
    "batch writer review r1 prototype getter key",
    `${batchSetup} batch(obj, { get __proto__() { return []; } });`,
  ],
  [
    "batch writer review r1 prototype setter accessor key",
    `${batchSetup} batch(obj, { set __proto__(value) {} });`,
  ],
  ...[
    ["1n", "1"],
    ["0x10n", "16"],
    ["0b101n", "5"],
    ["1_000n", "1000"],
    ["9007199254740993n", "9007199254740993"],
  ].map(([literal, value]): [string, string, string] => [
    `batch writer review r1 BigInt key ${literal}`,
    `${batchSetup} batch(obj, { ${literal}: [] });`,
    `Raw property IRI "${value}"`,
  ]),
  ...[
    ["true", "true"],
    ["false", "false"],
    ["null", "null"],
    ["(42 as const)!", "42"],
    ["(0x10n satisfies bigint)!", "16"],
    ["<boolean>true", "true"],
    ["(null as null)!", "null"],
  ].map(([expression, value]): [string, string, string] => [
    `batch writer review r1 computed primitive ${expression}`,
    `${batchSetup} batch(obj, { [${expression}]: [] });`,
    `Raw property IRI "${value}"`,
  ]),
  [
    "batch writer review r1 stored primitive remains ignored",
    `${batchSetup} const key = true; batch(obj, { [key]: [] });`,
  ],
  [
    "batch writer review r1 computed primitive call remains ignored",
    `${batchSetup} batch(obj, { [BigInt(1)]: [] });`,
  ],
  ...[
    ["1_000", "1000"],
    ["0x1_0", "16"],
    ["0b10_10", "10"],
    ["0o1_0", "8"],
    ["1_000.5", "1000.5"],
    ["1.2_5", "1.25"],
    ["1_0e2_0", "1e+21"],
    ["1e9_99", "Infinity"],
    ["1e999", "Infinity"],
  ].flatMap(([literal, value]): [string, string, string][] => [
    [
      `batch writer review r2 numeric key ${literal}`,
      `${batchSetup} batch(obj, { ${literal}: [] });`,
      `Raw property IRI "${value}"`,
    ],
    [
      `batch writer review r2 computed numeric key ${literal}`,
      `${batchSetup} batch(obj, { [${literal}]: [] });`,
      `Raw property IRI "${value}"`,
    ],
  ]),
  ...[
    ["(1_000 as const)!", "1000"],
    ["(0x1_0 satisfies number)!", "16"],
    ["<number>1_000.5", "1000.5"],
    ["(1_0e2_0)!", "1e+21"],
  ].map(([expression, value]): [string, string, string] => [
    `batch writer review r2 wrapped numeric key ${expression}`,
    `${batchSetup} batch(obj, { [${expression}]: [] });`,
    `Raw property IRI "${value}"`,
  ]),
  [
    "batch writer computed literal key",
    `${batchSetup} batch(obj, { ["as:content"]: [] });`,
    "non-HTTP scheme",
  ],
  [
    "batch writer computed template key",
    `${batchSetup} batch(obj, { [\`as:content\`]: [] });`,
    "non-HTTP scheme",
  ],
  [
    "batch writer computed const key",
    `${batchSetup} const iri = "as:content"; const key = iri; batch(obj, { [key]: [] });`,
    "non-HTTP scheme",
  ],
  [
    "batch writer inline URL key",
    `${batchSetup} batch(obj, { [new URL("as:content")]: [] });`,
    "non-HTTP scheme",
  ],
  [
    "batch writer computed const shadow",
    `${batchSetup} const iri = "content"; function f(iri) { batch(obj, { [iri]: [] }); }`,
  ],
  [
    "batch writer dynamic computed key",
    `${batchSetup} batch(obj, { [getIri()]: [] });`,
  ],
  [
    "batch writer ignores spread keys",
    `${batchSetup} batch(obj, { ...entries });`,
  ],
  [
    "batch writer checks explicit keys beside spread",
    `${batchSetup} batch(obj, { ...entries, "as:content": [] });`,
    "non-HTTP scheme",
  ],
  [
    "batch writer ignores raw value keys",
    `${batchSetup} batch(obj, { "https://example/p": [{ "as:content": [] }] });`,
  ],
  [
    "batch writer review r3 global iterator",
    `${batchSetup} batch(obj, { content: [], *[Symbol.iterator]() { yield ["https://example/p", []] as const; } });`,
  ],
  [
    "batch writer review r3 computed global iterator",
    `${batchSetup} batch(obj, { content: [], *[Symbol["iterator"]]() { yield ["https://example/p", []] as const; } });`,
  ],
  [
    "batch writer review r3 wrapped iterator member",
    `${batchSetup} batch(obj, { content: [], *[(Symbol.iterator as typeof Symbol.iterator)!]() { yield ["https://example/p", []] as const; } });`,
  ],
  [
    "batch writer review r3 wrapped global Symbol",
    `${batchSetup} batch(obj, { content: [], *[(Symbol as SymbolConstructor).iterator]() { yield ["https://example/p", []] as const; } });`,
  ],
  [
    "batch writer review r3 wrapped computed iterator name",
    `${batchSetup} batch(obj, { content: [], *[Symbol[("iterator" as const)!]]() { yield ["https://example/p", []] as const; } });`,
  ],
  [
    "batch writer review r3 iterator data property",
    `${batchSetup} batch(obj, { content: [], [Symbol.iterator]: function* () { yield ["https://example/p", []] as const; } });`,
  ],
  [
    "batch writer review r3 shadowed Symbol parameter",
    `${batchSetup} function f(Symbol) { batch(obj, { content: [], *[Symbol.iterator]() { yield ["https://example/p", []] as const; } }); }`,
    'Raw property IRI "content"',
  ],
  [
    "batch writer review r3 local Symbol binding",
    `${batchSetup} const Symbol = { iterator: "https://example/p" }; batch(obj, { content: [], *[Symbol.iterator]() { yield ["https://example/p", []] as const; } });`,
    'Raw property IRI "content"',
  ],
  [
    "batch writer review r3 async iterator is not a sync iterator",
    `${batchSetup} batch(obj, { content: [], async *[Symbol.asyncIterator]() { yield ["https://example/p", []] as const; } });`,
    'Raw property IRI "content"',
  ],
  [
    "batch writer review r3 generator entries are not analyzed",
    `${batchSetup} batch(obj, { content: [], *[Symbol.iterator]() { yield ["content", []] as const; } });`,
  ],
  ...[
    "content() {}",
    "get content() { return []; }",
    "set content(value) {}",
  ].map((member): [string, string] => [
    `batch writer review r4 ambiguous identifier ${member}`,
    `${batchSetup} batch(obj, { ${member} });`,
  ]),
  ...["https://example/p", "as:content"].flatMap((iri): [string, string][] => [
    [
      `batch writer review r4 ambiguous computed method ${iri}`,
      `${batchSetup} const K = ${JSON.stringify(iri)}; batch(obj, { [K]() {} });`,
    ],
    [
      `batch writer review r4 ambiguous computed getter ${iri}`,
      `${batchSetup} const K = ${JSON.stringify(iri)}; batch(obj, { get [K]() { return []; } });`,
    ],
    [
      `batch writer review r4 ambiguous computed setter ${iri}`,
      `${batchSetup} const K = ${JSON.stringify(iri)}; batch(obj, { set [K](value) {} });`,
    ],
  ]),
  ...["K as string", "K satisfies string", "K!", "<string>K"].map(
    (expression): [string, string, string] => [
      `batch writer review r4 wrapped identifier method ${expression}`,
      `${batchSetup} const K = "as:content"; batch(obj, { [${expression}]() {} });`,
      'Raw property IRI "as:content"',
    ],
  ),
  [
    "batch writer review r4 wrapped full IRI method",
    `${batchSetup} const K = "https://example/p"; batch(obj, { [K!]() {} });`,
  ],
  [
    "batch writer review r4 wrapped identifier getter",
    `${batchSetup} const K = "as:content"; batch(obj, { get [(K as string)!]() { return []; } });`,
    'Raw property IRI "as:content"',
  ],
  [
    "batch writer review r4 wrapped identifier setter",
    `${batchSetup} const K = "as:content"; batch(obj, { set [(K satisfies string)!](value) {} });`,
    'Raw property IRI "as:content"',
  ],
  [
    "batch writer review r4 literal method",
    `${batchSetup} batch(obj, { "as:content"() {} });`,
    'Raw property IRI "as:content"',
  ],
  [
    "batch writer review r4 literal getter",
    `${batchSetup} batch(obj, { get "as:content"() { return []; } });`,
    'Raw property IRI "as:content"',
  ],
  [
    "batch writer review r4 template method",
    `${batchSetup} batch(obj, { [\`as:content\`]() {} });`,
    'Raw property IRI "as:content"',
  ],
  [
    "batch writer review r4 full IRI template method",
    `${batchSetup} batch(obj, { [\`https://example/p\`]() {} });`,
  ],
  [
    "batch writer review r4 wrapped numeric method",
    `${batchSetup} batch(obj, { [(42 as const)!]() {} });`,
    'Raw property IRI "42"',
  ],
  [
    "batch writer stored record",
    `${batchSetup} const entries = { "content": [] } as const; batch(obj, entries);`,
  ],
  [
    "batch writer stored array",
    `${batchSetup} const entries = [["content", []]] as const; batch(obj, entries);`,
  ],
  [
    "batch writer inline Map",
    `${batchSetup} batch(obj, new Map([["content", []]]));`,
  ],
  ["batch writer generator", `${batchSetup} batch(obj, entries());`],
  [
    "batch writer tuple term",
    `${batchSetup} batch(obj, [["content", []]]);`,
    "must be a full",
  ],
  [
    "batch writer tuple prefix",
    `${batchSetup} batch(obj, [["as:content", null]]);`,
    "non-HTTP scheme",
  ],
  [
    "batch writer valid tuple",
    `${batchSetup} batch(obj, [["https://example/p", undefined]]);`,
  ],
  [
    "batch writer tuple constant",
    `${batchSetup} const iri = "as:content"; batch(obj, [[iri, []]]);`,
    "non-HTTP scheme",
  ],
  [
    "batch writer tuple URL",
    `${batchSetup} batch(obj, [[new URL("as:content"), []]]);`,
    "non-HTTP scheme",
  ],
  [
    "batch writer normalized tuple URL",
    `${batchSetup} batch(obj, [[new URL("https://example/a b"), []]]);`,
  ],
  [
    "batch writer mutable URL tuple key",
    `${batchSetup} const iri = new URL("about:blank"); batch(obj, [[iri, []]]);`,
  ],
  [
    "batch writer dynamic tuple key",
    `${batchSetup} batch(obj, [[getIri(), []]]);`,
  ],
  [
    "batch writer ignores outer spread",
    `${batchSetup} batch(obj, [...entries]);`,
  ],
  [
    "batch writer checks explicit tuple beside spread",
    `${batchSetup} batch(obj, [...entries, ["as:content", []]]);`,
    "non-HTTP scheme",
  ],
  [
    "batch writer ignores tuple spread",
    `${batchSetup} batch(obj, [[...entry]]);`,
  ],
  [
    "batch writer ignores spread tuple tail",
    `${batchSetup} batch(obj, [["content", ...values]]);`,
  ],
  ["batch writer ignores tuple holes", `${batchSetup} batch(obj, [[, []]]);`],
  [
    "batch writer ignores malformed tuple",
    `${batchSetup} batch(obj, [["content", [], null]]);`,
  ],
  [
    "batch writer ignores values in tuple",
    `${batchSetup} batch(obj, [["https://example/p", "as:content"]]);`,
  ],
  [
    "singular writer parameter shadow",
    `${writeSetup} function f(write) { write(obj, "content", []); }`,
  ],
  [
    "batch writer destructured parameter shadow",
    `${batchSetup} function f({ batch }) { batch(obj, { content: [] }); }`,
  ],
  [
    "batch writer hoisted shadow",
    `${batchSetup} function f() { batch(obj, { content: [] }); var batch; }`,
  ],
  [
    "batch writer namespace shadow",
    'import * as vocab from "@fedify/vocab"; function f(vocab) { vocab.withRawProperties(obj, { content: [] }); }',
  ],
  [
    "batch writer inside namespace",
    `${batchSetup} namespace N { batch(obj, { content: [] }); }`,
  ],
  [
    "batch writer enum initializer",
    `${batchSetup} enum E { V = (batch(obj, { content: [] }), 0) }`,
  ],
  [
    "batch writer opaque namespace binding",
    `${batchSetup} namespace batch {} batch(obj, { content: [] });`,
  ],
  [
    "batch writer switch discriminant",
    `${batchSetup} const iri = "https://example/p"; switch (batch(obj, { [iri]: [] })) { case 0: const iri = "content"; }`,
  ],
  [
    "singular writer helper alias ignored",
    `${writeSetup} const alias = write; alias(obj, "content", []);`,
  ],
  [
    "batch writer destructured helper ignored",
    'import * as vocab from "@fedify/vocab"; const { withRawProperties: batch } = vocab; batch(obj, { content: [] });',
  ],
  [
    "writer type import",
    'import type { withRawProperty } from "@fedify/vocab"; withRawProperty(obj, "content", []);',
  ],
  [
    "writer other module",
    'import { withRawProperties } from "other-vocab"; withRawProperties(obj, { content: [] });',
  ],
  [
    "reader wrapped constant",
    `${setup} const iri = "as:content" as const; read(obj, iri!);`,
    "non-HTTP scheme",
  ],
  ...[
    '"as:content" as const',
    '"as:content" satisfies string',
    '("as:content")!',
    '<string>"as:content"',
  ].map((expression): [string, string, string] => [
    `singular writer wrapper ${expression}`,
    `${writeSetup} write(obj, ${expression}, []);`,
    "non-HTTP scheme",
  ]),
  ...[
    '{ "as:content": [] } as const',
    '{ "as:content": [] } satisfies Entries',
    '({ "as:content": [] })!',
    '<Entries>{ "as:content": [] }',
  ].map((expression): [string, string, string] => [
    `batch writer object wrapper ${expression}`,
    `${batchSetup} batch(obj, ${expression});`,
    "non-HTTP scheme",
  ]),
  ...[
    '[["as:content", []] as const] as const',
    '[["as:content", []] satisfies Pair] satisfies Entries',
    '([( ["as:content", []] )!])!',
    '<Entries>[<Pair>["as:content", []]]',
  ].map((expression): [string, string, string] => [
    `batch writer tuple wrapper ${expression}`,
    `${batchSetup} batch(obj, ${expression});`,
    "non-HTTP scheme",
  ]),
  ...[
    "jsr:@fedify/vocab@^2.5.0",
    "npm:@fedify/vocab@2.5.0",
    "@fedify/fedify/vocab",
  ].flatMap((source): [string, string, string][] => [
    [
      `writer module ${source}`,
      `import { withRawProperty as write } from ${JSON.stringify(source)}; write(obj, "content", []);`,
      "must be a full",
    ],
    [
      `batch module ${source}`,
      `import { withRawProperties as batch } from ${JSON.stringify(source)}; batch(obj, { content: [] });`,
      "must be a full",
    ],
  ]),
];
for (const [label, code, expectedError] of [...cases, ...writerCases]) {
  test(
    `${ruleName}: ${label}`,
    lintTest({ rule, ruleName, code, federationSetup: "", expectedError }),
  );
}

function verify(code: string, options: { modules?: string[] } = {}) {
  return new Linter().verify(
    code,
    [
      {
        files: ["**/*.ts"],
        languageOptions: { parser },
        plugins: { fedify: { rules: { [ruleName]: rule.eslint } } },
        rules: { [`fedify/${ruleName}`]: ["warn", options] },
      },
    ],
    "test.ts",
  );
}

test("ESLint: modules option includes defaults and accepts frozen options", () => {
  const options = Object.freeze({ modules: Object.freeze(["other-vocab"]) });
  // ESLint normalizes configuration before invoking the rule; frozen input
  // also guards against accidental mutations of the caller's options.
  const code =
    'import { getRawPropertyValue as read } from "other-vocab"; read(obj, "content");';
  assert.equal(verify(code).length, 0);
  assert.equal(
    verify(code, options as { modules: string[] })[0].messageId,
    "invalid",
  );
  assert.equal(
    verify(`${setup} read(obj, "content");`, options as { modules: string[] })
      .length,
    1,
  );
});

test("ESLint: enum initializers are ignored", () => {
  assert.equal(
    verify(`${setup} enum E { V = (read(obj, "content"), 0) }`).length,
    0,
  );
});

test("ESLint: compact prefixes offer suggestions, never autofixes", () => {
  const code = `${setup} read(obj, "as:content");`;
  const [diagnostic] = verify(code);
  assert.equal(diagnostic.messageId, "nonHttp");
  assert.equal(diagnostic.fix, undefined);
  assert.equal(diagnostic.suggestions?.length, 1);
  const fix = diagnostic.suggestions![0].fix;
  const fixed =
    code.slice(0, fix.range[0]) + fix.text + code.slice(fix.range[1]);
  assert.equal(verify(fixed).length, 0);
  assert.equal(
    verify(`${setup} const iri = "as:content"; read(obj, iri);`)[0].suggestions,
    undefined,
  );
});

test("ESLint: template and URL suggestions produce valid code", () => {
  for (const code of [
    `${setup} read(obj, \`as:content\`);`,
    `${setup} read(obj, new URL("as:content"));`,
  ]) {
    const [diagnostic] = verify(code);
    const fix = diagnostic.suggestions![0].fix;
    assert.equal(
      verify(code.slice(0, fix.range[0]) + fix.text + code.slice(fix.range[1]))
        .length,
      0,
    );
  }
});

test(
  "Oxlint: default and configured modules",
  { skip: oxlintUnavailable },
  () => {
    for (const [source, options, expected] of [
      ["@fedify/vocab", {}, 1],
      ["other-vocab", {}, 0],
      ["other-vocab", { modules: ["other-vocab"] }, 1],
    ] as const) {
      const result = runOxlint(
        `import { getRawPropertyValue } from ${JSON.stringify(
          source,
        )}; getRawPropertyValue(obj, "content");`,
        {
          rules: { [`@fedify/lint/${ruleName}`]: ["warn", options] },
        },
      );
      assert.equal(
        result.diagnostics.filter((d) => d.code?.includes(ruleName)).length,
        expected,
        result.stdout + result.stderr,
      );
    }
  },
);

test("ESLint: every well-known prefix expands to its full IRI", () => {
  const prefixes = {
    as: "https://www.w3.org/ns/activitystreams#",
    dcterms: "http://purl.org/dc/terms/",
    fedibird: "http://fedibird.com/ns#",
    ldp: "http://www.w3.org/ns/ldp#",
    litepub: "http://litepub.social/ns#",
    misskey: "https://misskey-hub.net/ns#",
    schema: "http://schema.org#",
    sec: "https://w3id.org/security#",
    toot: "http://joinmastodon.org/ns#",
    vcard: "http://www.w3.org/2006/vcard/ns#",
  };
  for (const [prefix, namespace] of Object.entries(prefixes)) {
    const [diagnostic] = verify(`${setup} read(obj, "${prefix}:property");`);
    assert.ok(
      diagnostic.message.includes(`Did you mean "${namespace}property"?`),
    );
    assert.equal(
      diagnostic.suggestions![0].fix.text,
      JSON.stringify(namespace + "property"),
    );
  }
  assert.equal(
    verify(`${setup} read(obj, "constructor:property");`)[0].suggestions,
    undefined,
  );
});

test("ESLint: writer suggestions replace only use-site literals", () => {
  for (const [code, expectedSource] of [
    [`${writeSetup} write(obj, "as:content" as const, []);`, '"as:content"'],
    [`${batchSetup} batch(obj, { "as:content": [] });`, '"as:content"'],
    [`${batchSetup} batch(obj, { [\`as:content\`]: [] });`, "`as:content`"],
    [
      `${batchSetup} batch(obj, ([["as:content" as const, []] satisfies Pair] as const)!);`,
      '"as:content"',
    ],
    [
      `${writeSetup} write(obj, new URL(("as:content" as const)!), []);`,
      '"as:content"',
    ],
  ]) {
    const [diagnostic] = verify(code);
    assert.equal(diagnostic.messageId, "nonHttp");
    assert.equal(diagnostic.fix, undefined);
    assert.equal(diagnostic.suggestions?.length, 1);
    const fix = diagnostic.suggestions![0].fix;
    assert.equal(code.slice(fix.range[0], fix.range[1]), expectedSource);
    assert.equal(fix.text, '"https://www.w3.org/ns/activitystreams#content"');
    assert.equal(
      verify(code.slice(0, fix.range[0]) + fix.text + code.slice(fix.range[1]))
        .length,
      0,
    );
  }
});

test("ESLint: writer constants and identifier keys receive no rewrite", () => {
  for (const [code, value] of [
    [
      `${writeSetup} const iri = "as:content"; write(obj, iri!, []);`,
      "as:content",
    ],
    [
      `${writeSetup} const iri = "as:content"; write(obj, new URL(iri), []);`,
      "as:content",
    ],
    [
      `${batchSetup} const iri = "as:content"; batch(obj, { [iri]: [] });`,
      "as:content",
    ],
    [
      `${batchSetup} const iri = "as:content"; batch(obj, [[iri, []]]);`,
      "as:content",
    ],
    [
      `${batchSetup} const content = "https://example/p"; batch(obj, { content: [] });`,
      "content",
    ],
    [
      `${batchSetup} const content = "https://example/p"; batch(obj, { content });`,
      "content",
    ],
    [`${batchSetup} batch(obj, { 42: [] });`, "42"],
  ]) {
    const diagnostics = verify(code);
    assert.equal(diagnostics.length, 1);
    assert.ok(diagnostics[0].message.includes(`"${value}"`));
    assert.equal(diagnostics[0].fix, undefined);
    assert.equal(diagnostics[0].suggestions, undefined);
  }
});

test("ESLint: each explicit writer key has its own diagnostic", () => {
  for (const code of [
    `${batchSetup} batch(obj, { "as:content": [], "content": [] });`,
    `${batchSetup} batch(obj, [["as:content", []], ["content", []]]);`,
  ]) {
    const diagnostics = verify(code);
    assert.deepEqual(
      diagnostics.map((diagnostic) => diagnostic.messageId),
      ["nonHttp", "invalid"],
    );
    assert.equal(diagnostics[0].suggestions?.length, 1);
    assert.equal(diagnostics[1].suggestions, undefined);
  }
});

test("ESLint: primitive record keys use exact strings without rewrites", () => {
  for (const [label, code, expectedError] of writerCases) {
    if (
      expectedError == null ||
      (!label.startsWith("batch writer review r1 BigInt key ") &&
        !label.startsWith("batch writer review r1 computed primitive ") &&
        !label.startsWith("batch writer review r2 "))
    )
      continue;
    const diagnostics = verify(code);
    assert.equal(diagnostics.length, 1, label);
    assert.ok(diagnostics[0].message.includes(expectedError), label);
    assert.equal(diagnostics[0].fix, undefined, label);
    assert.equal(diagnostics[0].suggestions, undefined, label);
  }
});

test("ESLint: configured vocabulary modules include writer imports", () => {
  for (const code of [
    'import { withRawProperty as write } from "other-vocab"; write(obj, "content", []);',
    'import { withRawProperties as batch } from "other-vocab"; batch(obj, { content: [] });',
  ]) {
    assert.equal(verify(code).length, 0);
    assert.equal(
      verify(code, { modules: ["other-vocab"] })[0].messageId,
      "invalid",
    );
  }
});

test(
  "Oxlint: writer keys and wrappers use the built plugin",
  { skip: oxlintUnavailable },
  () => {
    const labels = new Set([
      "singular writer bare term",
      "singular writer compact prefix",
      "singular writer mutable URL constant",
      "batch writer computed namespace",
      "batch writer quoted key",
      "batch writer identifier key ignores binding",
      "batch writer shorthand key ignores binding",
      "batch writer numeric key",
      "batch writer computed const key",
      "batch writer stored record",
      "batch writer stored array",
      "batch writer dynamic computed key",
      "batch writer destructured parameter shadow",
      "batch writer namespace shadow",
    ]);
    for (const [label, code, expectedError] of writerCases) {
      if (
        !labels.has(label) &&
        !label.startsWith("batch writer tuple wrapper ") &&
        !label.startsWith("batch writer review r1 ") &&
        !label.startsWith("batch writer review r2 ") &&
        !label.startsWith("batch writer review r3 ") &&
        !label.startsWith("batch writer review r4 ")
      )
        continue;
      const result = runOxlint(code, {
        categories: { correctness: "off" },
        rules: { [`@fedify/lint/${ruleName}`]: "warn" },
      });
      const diagnostics = result.diagnostics.filter((diagnostic) =>
        diagnostic.code?.includes(ruleName),
      );
      assert.equal(
        diagnostics.length,
        expectedError == null ? 0 : 1,
        `${label}\n${result.stdout}\n${result.stderr}`,
      );
      if (expectedError != null)
        assert.ok(
          diagnostics[0].message?.includes(expectedError),
          `${label}\n${result.stdout}`,
        );
    }
  },
);

test(
  "Oxlint: writer imports honor configured vocabulary modules",
  { skip: oxlintUnavailable },
  () => {
    for (const [source, options, expected] of [
      ["@fedify/vocab", {}, 1],
      ["other-vocab", {}, 0],
      ["other-vocab", { modules: ["other-vocab"] }, 1],
    ] as const) {
      for (const call of [
        'withRawProperty(obj, "content", []);',
        "withRawProperties(obj, { content: [] });",
      ]) {
        const result = runOxlint(
          `import { withRawProperty, withRawProperties } from ${JSON.stringify(source)}; ${call}`,
          {
            categories: { correctness: "off" },
            rules: { [`@fedify/lint/${ruleName}`]: ["warn", options] },
          },
        );
        assert.equal(
          result.diagnostics.filter((diagnostic) =>
            diagnostic.code?.includes(ruleName),
          ).length,
          expected,
          result.stdout + result.stderr,
        );
      }
    }
  },
);
