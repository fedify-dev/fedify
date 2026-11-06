import assert from "node:assert/strict";
import { test } from "node:test";
import { Linter } from "eslint";
import * as parser from "@typescript-eslint/parser";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/raw-property-iri-invalid.ts";
import { oxlintUnavailable, runOxlint } from "../lib/oxlint.ts";

const ruleName = "raw-property-iri-invalid";
const setup = 'import { getRawPropertyValues as read } from "@fedify/vocab";';
const cases: [string, string, string?][] = [
  ...[
    "",
    "as:",
    "https://example/path[0]",
    "https://[abc]/x",
    "https://a[::1]/x",
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
  ].map((
    source,
  ): [string, string, string] => [
    source,
    `import { getRawPropertyValue } from ${
      JSON.stringify(source)
    }; getRawPropertyValue(obj, "content");`,
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
    "must be a full",
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
    "type-only namespace does not shadow",
    `${setup} namespace Outer { namespace read { export interface X {} } read(obj, "content"); }`,
    "must be a full",
  ],
  [
    "namespace with values shadows",
    `${setup} namespace Outer { namespace read { export const x = 1; } read(obj, "content"); }`,
  ],
  [
    "namespace with only an import alias does not shadow",
    `${setup} namespace Outer { namespace read { import X = Outer.Y; } read(obj, "content"); }`,
    "must be a full",
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
    "merged namespace exported variables shadow helpers",
    `${setup} namespace N { export const read = (o: unknown, i: string) => {}; } namespace N { read({}, "content"); }`,
  ],
  [
    "merged namespace locals do not shadow helpers",
    `${setup} namespace N { function read(o: unknown, i: string) {} } namespace N { read({}, "content"); }`,
    "must be a full",
  ],
  [
    "unrelated namespace exports do not shadow helpers",
    `${setup} namespace M { export function read(o: unknown, i: string) {} } namespace N { read({}, "content"); }`,
    "must be a full",
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
    "enum initializers are checked",
    `${setup} enum E { V = (read(obj, "content"), 0) }`,
    "must be a full",
  ],
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
for (const [label, code, expectedError] of cases) {
  test(
    `${ruleName}: ${label}`,
    lintTest({ rule, ruleName, code, federationSetup: "", expectedError }),
  );
}

function verify(code: string, options: { modules?: string[] } = {}) {
  return new Linter().verify(code, [{
    files: ["**/*.ts"],
    languageOptions: { parser },
    plugins: { fedify: { rules: { [ruleName]: rule.eslint } } },
    rules: { [`fedify/${ruleName}`]: ["warn", options] },
  }], "test.ts");
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

test("ESLint: compact prefixes offer suggestions, never autofixes", () => {
  const code = `${setup} read(obj, "as:content");`;
  const [diagnostic] = verify(code);
  assert.equal(diagnostic.messageId, "nonHttp");
  assert.equal(diagnostic.fix, undefined);
  assert.equal(diagnostic.suggestions?.length, 1);
  const fix = diagnostic.suggestions![0].fix;
  const fixed = code.slice(0, fix.range[0]) + fix.text +
    code.slice(fix.range[1]);
  assert.equal(verify(fixed).length, 0);
  assert.equal(
    verify(`${setup} const iri = "as:content"; read(obj, iri);`)[0].suggestions,
    undefined,
  );
});

test("ESLint: template and URL suggestions produce valid code", () => {
  for (
    const code of [
      `${setup} read(obj, \`as:content\`);`,
      `${setup} read(obj, new URL("as:content"));`,
    ]
  ) {
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
    for (
      const [source, options, expected] of [
        ["@fedify/vocab", {}, 1],
        ["other-vocab", {}, 0],
        ["other-vocab", { modules: ["other-vocab"] }, 1],
      ] as const
    ) {
      const result = runOxlint(
        `import { getRawPropertyValue } from ${
          JSON.stringify(source)
        }; getRawPropertyValue(obj, "content");`,
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
