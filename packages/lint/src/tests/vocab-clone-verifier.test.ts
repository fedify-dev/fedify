import assert from "node:assert/strict";
import { test } from "node:test";
import * as parser from "@typescript-eslint/parser";
import { Linter } from "eslint";
import { oxlintUnavailable, runOxlint } from "../lib/oxlint.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/vocab-clone-verifier.ts";

const ruleName = "vocab-clone-verifier";
const reported = "does not inherit";
const imports =
  'import { Article, Collection, Create, Note, Object as APObject, lookupObject } from "@fedify/vocab";\n';

/** `[label, code, expected?]`; with `expected`, the rule must report. */
const cases: [string, string, string?][] = [
  // The pattern fixed in #1396:
  [
    "backfill shape",
    `${imports}async function f(note: Note) {
      return await note.clone().getContextHistory({
        crossOrigin: "trust",
        documentLoader: (url) => fetch(url),
      });
    }`,
    reported,
  ],
  [
    "aliased Object parameter",
    `${imports}async function f(note: APObject) {
      return await note.clone().getContextHistory({ crossOrigin: "trust" });
    }`,
    reported,
  ],
  [
    "same-scope variable",
    `${imports}async function f(note: Note) {
      const copy = note.clone();
      return await copy.getContextHistory({ crossOrigin: "trust" });
    }`,
    reported,
  ],
  [
    "alias of a clone",
    `${imports}async function f(note: Note) {
      const copy = note.clone({ content: "x" });
      const other = copy;
      await other.getAttribution();
    }`,
    reported,
  ],
  [
    "type-only import",
    `import type { Note } from "@fedify/vocab";
    async function f(note: Note) { await note.clone().getObject(); }`,
    reported,
  ],
  [
    "type-only specifier",
    `import { type Note } from "@fedify/vocab";
    async function f(note: Note) { await note.clone().getObject(); }`,
    reported,
  ],
  [
    "namespace type annotation",
    `import * as vocab from "@fedify/vocab";
    async function f(note: vocab.Note) { await note.clone().getObject(); }`,
    reported,
  ],
  [
    "@fedify/fedify/vocab",
    `import { Note } from "@fedify/fedify/vocab";
    async function f(note: Note) { await note.clone().getObject(); }`,
    reported,
  ],
  [
    "versioned jsr specifier",
    `import { Note } from "jsr:@fedify/vocab@^2.5.0";
    async function f(note: Note) { await note.clone().getObject(); }`,
    reported,
  ],
  [
    "nullable union",
    `${imports}async function f(note: Note | null) { await note?.clone().getObject(); }`,
    reported,
  ],
  [
    "parenthesized union",
    `${imports}async function f(note: (Note | Article) | undefined) { await note!.clone().getObject(); }`,
    reported,
  ],
  [
    "optional chaining",
    `${imports}async function f(note?: Note) { await note?.clone()?.getObject?.(); }`,
    reported,
  ],
  [
    "casts",
    `${imports}async function f(note: Note) {
      await (note as Note).clone().getObject();
      await (note!.clone() satisfies Note).getObject();
    }`,
    reported,
  ],
  [
    "default parameter",
    `${imports}async function f(note: Note = new Note({})) { await note.clone().getObject(); }`,
    reported,
  ],
  [
    "parameter property",
    `${imports}class C { constructor(private readonly note: Note) {} }
    async function f(note: Note) { await note.clone().getObject(); }`,
    reported,
  ],
  [
    "annotated clone variable",
    `${imports}async function f(note: Note) {
      const copy: Note = note.clone();
      await copy.getObject();
    }`,
    reported,
  ],
  [
    "constructor with a verifier",
    `${imports}async function f(verifyPortableObject: never) {
      const note = new Note({}, { verifyPortableObject });
      await note.clone().getObject();
    }`,
    reported,
  ],
  [
    "constructor with a context",
    `${imports}import * as vocab from "@fedify/vocab";
    async function f(ctx: unknown) {
      const note = new vocab.Note({}, ctx as never);
      await note.clone().getObject();
    }`,
    reported,
  ],
  [
    "fromJsonLd with options",
    `${imports}async function f(doc: unknown, ctx: never) {
      const note = await Note.fromJsonLd(doc, ctx);
      await note.clone().getObject();
    }`,
    reported,
  ],
  [
    "lookupObject with options",
    `${imports}async function f(ctx: never) {
      const object = await lookupObject("https://example.com/", ctx);
      await object?.clone().getAttribution();
    }`,
    reported,
  ],
  [
    "this in a subclass",
    `${imports}class MyNote extends Note {
      async history() { return await this.clone().getContextHistory(); }
    }`,
    reported,
  ],
  [
    "arrow field in a subclass",
    `${imports}class MyNote extends Note {
      history = () => this.clone().getContextHistory();
    }`,
    reported,
  ],
  [
    "super in a subclass",
    `${imports}class MyNote extends Note {
      async history() { return await super.clone().getContextHistory(); }
    }`,
    reported,
  ],
  [
    "accessor result",
    `${imports}async function f(create: Create) {
      const object = await create.getObject();
      await object?.clone().getAttribution();
    }`,
    reported,
  ],
  [
    "for-await binding",
    `${imports}async function f(create: Create) {
      for await (const object of create.getObjects()) {
        await object.clone().getAttribution();
      }
    }`,
    reported,
  ],
  [
    "unconsumed plural accessor",
    `${imports}async function f(note: Note) {
      for await (const _ of note.clone().getAttachments()) break;
    }`,
    reported,
  ],
  [
    "deepClone after clone",
    `${imports}async function f(note: Note) { await note.clone().deepClone().getObject(); }`,
    reported,
  ],
  [
    "deepClone with nullish verifier after clone",
    `${imports}async function f(note: Note) {
      await note.clone().deepClone({}, { verifyPortableObject: undefined }).getObject();
      await note.clone().deepClone({}, { verifyPortableObject: null }).getObject();
    }`,
    reported,
  ],
  [
    "clone of a clone",
    `${imports}async function f(note: Note) { await note.clone().clone().getObject(); }`,
    "a later `clone()` in the chain",
  ],
  [
    "computed clone",
    `${imports}async function f(note: Note) { await note["clone"]()[\`getObject\`](); }`,
    reported,
  ],
  [
    "explicit undefined options",
    `${imports}async function f(note: Note) {
      await note.clone({}, undefined).getObject(undefined);
      await note.clone({}, void 0).getObject();
    }`,
    reported,
  ],
  [
    "options without a verifier",
    `${imports}async function f(note: Note, loader: never) {
      await note.clone({}, { documentLoader: loader }).getObject({ documentLoader: loader });
    }`,
    reported,
  ],
  [
    "last dereference option wins",
    `${imports}async function f(note: Note) {
      await note.clone().getObject({ dereference: false, dereference: true });
    }`,
    reported,
  ],
  [
    "earlier spread may supply a verifier",
    `${imports}async function f(note: Note, base: never) {
      await note.clone().getObject({ ...base, documentLoader: base });
    }`,
  ],
  [
    "closure over an outer clone",
    `${imports}function f(note: Note) {
      const copy = note.clone();
      return async () => await copy.getObject();
    }`,
    reported,
  ],
  [
    "block-local function does not shadow outside the block",
    `${imports}async function f(note: Note) {
      { function Note() {} }
      await note.clone().getObject();
    }`,
    reported,
  ],
  [
    "inheriting accessor result",
    `${imports}async function f(note: Note, ctx: never) {
      const object = await note.clone().getObject(ctx);
      await object?.clone().getAttribution();
    }`,
    reported,
  ],

  // Negative cases:
  [
    "Request, Response, and Router clones",
    `${imports}async function f(request: Request, response: Response, router: { clone(): { getRoute(): void } }) {
      await request.clone().text();
      await response.clone().json();
      router.clone().getRoute();
    }`,
  ],
  [
    "Context clone",
    `import type { Context } from "@fedify/fedify";
    ${imports}async function f(ctx: Context<void>) { (ctx as any).clone().getActorUri("x"); }`,
  ],
  [
    "deepClone",
    `${imports}async function f(note: Note) { await note.deepClone().getContextHistory(); }`,
  ],
  [
    "clone with a verifier",
    `${imports}async function f(note: Note, verifyPortableObject: never) {
      await note.clone({}, { verifyPortableObject }).getObject();
      await note.clone({}, { verifyPortableObject: verifyPortableObject }).getObject();
    }`,
  ],
  [
    "clone with a context",
    `${imports}async function f(note: Note, ctx: never) { await note.clone({}, ctx).getObject(); }`,
  ],
  [
    "clone with an explicit nullish verifier",
    `${imports}async function f(note: Note) {
      await note.clone({}, { verifyPortableObject: undefined }).getObject();
    }`,
  ],
  [
    "accessor with a verifier",
    `${imports}async function f(note: Note, ctx: never, verifyPortableObject: never) {
      await note.clone().getObject(ctx);
      await note.clone().getObject({ verifyPortableObject });
      await note.clone().getObject({ verifyPortableObject: undefined });
    }`,
  ],
  [
    "accessor without dereferencing",
    `${imports}async function f(note: Note) {
      await note.clone().getObject({ dereference: false });
    }`,
  ],
  [
    "unknown computed key",
    `${imports}async function f(note: Note, k: string) {
      await note.clone().getObject({ dereference: false, [k]: true });
    }`,
  ],
  [
    "spread options",
    `${imports}async function f(note: Note, args: never[], base: never) {
      await note.clone(...args).getObject();
      await note.clone().getObject({ verifyPortableObject: undefined, ...base });
      await note.clone({}, { ...base }).getObject();
    }`,
  ],
  [
    "shadowed undefined",
    `${imports}async function f(note: Note, undefined: never) {
      await note.clone({}, undefined).getObject();
    }`,
  ],
  [
    "locally constructed objects",
    `${imports}async function f(doc: unknown) {
      await new Note({}).clone().getObject();
      await new Note({}, {}).clone().getObject();
      const note: Note = new Note({ content: "x" });
      await note.clone().getObject();
      const parsed: APObject = await Note.fromJsonLd(doc, {});
      await parsed.clone().getObject();
      await (await Note.fromJsonLd(doc)).clone().getObject();
      const found = await lookupObject("https://example.com/");
      await found?.clone().getObject();
    }`,
  ],
  [
    "type-only import cannot construct",
    `import type { Note } from "@fedify/vocab";
    async function f(ctx: never) { await new (Note as any)({}, ctx).clone().getObject(); }`,
  ],
  [
    "serialized clones",
    `${imports}async function f(note: Note) {
      const copy = note.clone({ content: "x" });
      return await copy.toJsonLd();
    }`,
  ],
  [
    "shadowed import",
    `${imports}async function f(Note: any, note: Note) {}
    async function g(note: Note) {
      const Note = 1;
      await new Note({}, {} as never).clone().getObject();
    }`,
  ],
  [
    "no vocabulary import",
    `class Note { clone() { return this; } async getObject() {} }
    async function f(note: Note) { await note.clone().getObject(); }`,
  ],
  [
    "other module",
    `import { Note } from "other-vocab";
    async function f(note: Note) { await note.clone().getObject(); }`,
  ],
  [
    "reassigned variable",
    `${imports}async function f(note: Note) {
      let copy = note.clone();
      copy = note.deepClone();
      await copy.getObject();
    }`,
  ],
  [
    "destructuring reassignments",
    `${imports}async function f(note: Note, o: never, items: never[]) {
      let a = note.clone();
      let b = note.clone();
      let c = note.clone();
      ({ a } = o);
      ({ x: b } = o);
      for ([c] of items);
      await a.getObject();
      await b.getObject();
      await c.getObject();
    }`,
  ],
  [
    "untyped parameter",
    `${imports}async function f(note) { await note.clone().getObject(); }`,
  ],
  [
    "static this",
    `${imports}class MyNote extends Note {
      static async history() { return await this.clone().getContextHistory(); }
    }`,
  ],
  [
    "nested function this",
    `${imports}class MyNote extends Note {
      async history() {
        return function (this: any) { return this.clone().getContextHistory(); };
      }
      field = function (this: any) { return this.clone().getObject(); };
    }`,
  ],
  [
    "class not extending a vocabulary type",
    `${imports}class Plain { async history() { return await (this as any).clone().getObject(); } }`,
  ],
  [
    "cyclic aliases",
    `${imports}async function f() {
      var a = b;
      var b = a;
      await a.clone().getObject();
    }`,
  ],
  [
    "non-vocabulary annotations",
    `${imports}async function f(a: null | undefined, b: Promise<Note>, c: Note[]) {
      await (a as any).clone().getObject();
      await (b as any).clone().getObject();
      await (c as any).clone().getObject();
    }`,
  ],
  [
    "accessor result that does not inherit",
    `${imports}async function f(note: Note, verifyPortableObject: never) {
      const a = await note.clone({}, { verifyPortableObject: undefined }).getObject({
        verifyPortableObject,
        inheritPortableObjectVerifier: false,
      });
      await a?.clone().getObject();
    }`,
  ],
  [
    "deepClone of a clone with a verifier",
    `${imports}async function f(note: Note, ctx: never) {
      await note.clone().deepClone({}, ctx).getObject();
    }`,
  ],
  [
    "var annotation resolved in its block",
    `${imports}async function f() {
      {
        class Note { clone() { return this; } async getObject() {} }
        var value: Note = new Note();
        await value.clone().getObject();
      }
    }`,
  ],
  [
    "default import",
    `import vocab from "@fedify/vocab";
    async function f(note: vocab) { await (note as any).clone().getObject(); }`,
  ],
  [
    "namespace bodies are ignored",
    `${imports}namespace N { export async function f(note: Note) { await note.clone().getObject(); } }`,
  ],
];

for (const [label, code, expectedError] of cases) {
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

function applySuggestion(code: string, message: Linter.LintMessage): string {
  const { fix } = message.suggestions![0];
  return code.slice(0, fix.range[0]) + fix.text + code.slice(fix.range[1]);
}

test("ESLint: reports once per clone, at the clone property", () => {
  const code = `${imports}async function f(note: Note) {
  const copy = note.clone();
  await copy.getObject();
  await copy.getAttribution();
}`;
  const messages = verify(code);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].messageId, "dropsVerifier");
  assert.equal(messages[0].line, 3);
  assert.equal(messages[0].column, 21);
  assert.equal(messages[0].endColumn, 26);
});

test("ESLint: reports separate clones in source order", () => {
  const code = `${imports}async function f(note: Note, other: Note) {
  const b = other.clone();
  await note.clone().getObject();
  await b.getObject();
}`;
  const messages = verify(code);
  assert.deepEqual(
    messages.map((m) => m.line),
    [3, 4],
  );
});

test("ESLint: suggests deepClone(), never autofixes", () => {
  const code = `${imports}async function f(note: Note) {
  await note.clone().getContextHistory({ crossOrigin: "trust" });
}`;
  const [message] = verify(code);
  assert.equal(message.fix, undefined);
  assert.equal(message.suggestions?.length, 1);
  assert.equal(message.suggestions![0].messageId, "useDeepClone");
  const fixed = applySuggestion(code, message);
  assert.ok(fixed.includes("note.deepClone().getContextHistory("));
  assert.equal(verify(fixed).length, 0);
});

test("ESLint: no suggestion for computed clones", () => {
  const [message] = verify(
    `${imports}async function f(note: Note) { await note["clone"]().getObject(); }`,
  );
  assert.equal(message.messageId, "dropsVerifier");
  assert.equal(message.suggestions, undefined);
});

test("ESLint: no suggestion for this.clone() inside a clone() override", () => {
  const code = `${imports}class MyNote extends Note {
  override clone(values = {}, options = {}) {
    void this.clone().getObject();
    return super.clone(values, options);
  }
}`;
  const [message] = verify(code);
  assert.equal(message.messageId, "dropsVerifier");
  assert.equal(message.suggestions, undefined);
});

test("ESLint: no suggestion inside super.clone(), computed clone(), or deepClone() overrides", () => {
  for (const code of [
    `${imports}class MyNote extends Note {
  override clone(values = {}, options = {}) {
    void super.clone().getObject();
    return super.clone(values, options);
  }
}`,
    `${imports}class MyNote extends Note {
  override ["clone"](values = {}, options = {}) {
    void this.clone().getObject();
    return super.clone(values, options);
  }
}`,
    `${imports}class MyNote extends Note {
  override deepClone(values = {}, options = {}) {
    const copy = this.clone();
    void copy.getAttachments();
    return super.deepClone(values, options);
  }
}`,
    `${imports}class MyNote extends Note {
  override deepClone(values = {}, options = {}) {
    const self = this;
    void self.clone().getAttachments();
    return super.deepClone(values, options);
  }
}`,
    `${imports}class MyNote extends Note {
  override clone = (values = {}, options = {}) => {
    void super.clone().getAttachments();
    return super.clone(values, options);
  };
}`,
  ]) {
    const [message] = verify(code);
    assert.equal(message.messageId, "dropsVerifier");
    assert.equal(message.suggestions, undefined);
  }
});

test("ESLint: re-cloned copies report the first clone without a suggestion", () => {
  for (const body of [
    "await c.getObject();\n  await c.clone().getObject();",
    "await c.clone().getObject();\n  await c.getObject();",
  ]) {
    const code = `${imports}async function f(note: Note) {
  const c = note.clone();
  ${body}
}`;
    const messages = verify(code);
    assert.equal(messages.length, 1, body);
    assert.equal(messages[0].messageId, "dropsVerifierRechained");
    assert.equal(messages[0].line, 3);
    assert.equal(messages[0].suggestions, undefined);
  }
});

test("ESLint: modules option adds other vocabulary modules", () => {
  const code = `import { Note } from "@example/vocab";
async function f(note: Note) { await note.clone().getObject(); }`;
  assert.equal(verify(code).length, 0);
  assert.equal(verify(code, { modules: ["@example/vocab"] }).length, 1);
  // lookupObject() is recognized only from Fedify's own module:
  assert.equal(
    verify(
      `import { lookupObject } from "@example/vocab";
async function f(ctx: never) { await (await lookupObject("x", ctx))?.clone().getObject(); }`,
      { modules: ["@example/vocab"] },
    ).length,
    0,
  );
});

const OXLINT_BAD = `import type { Object as APObject } from "@fedify/vocab";
import { Note } from "@fedify/vocab";

export async function a(note: APObject | null) {
  return await (note as APObject)?.clone().getContextHistory({
    crossOrigin: "trust",
  });
}

export async function b(note: Note) {
  const copy = note.clone();
  return await copy.getObject();
}

export async function c(note: Note) {
  return await note.clone({}, note as never).getObject();
}
`;

test("Oxlint: reports dropped verifiers", { skip: oxlintUnavailable }, () => {
  const { diagnostics, stdout, stderr } = runOxlint(OXLINT_BAD, {
    rules: { [`@fedify/lint/${ruleName}`]: "warn" },
  });
  const ours = diagnostics.filter((d) => d.code?.includes(ruleName));
  assert.equal(ours.length, 2, `stdout: ${stdout}\nstderr: ${stderr}`);
  assert.ok(ours.every((d) => d.message?.includes(reported)));
});

test("Oxlint: stays quiet unless enabled", { skip: oxlintUnavailable }, () => {
  const { diagnostics } = runOxlint(OXLINT_BAD, { rules: {} });
  assert.equal(diagnostics.filter((d) => d.code?.includes(ruleName)).length, 0);
});
