import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { test } from "node:test";
import {
  enterSignedValueScope,
  getRetainedSignedRepresentation,
  isMarkerSafeContext,
  isPlainJsonTree,
  resolveSignedValues,
  retainedSignedValueRef,
  retainSignedRepresentation,
  type SignedValueScope,
} from "./internal/signed-representation.ts";

const securedDocument = {
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
  ],
  id: "ap://did:key:z6Mkabc/objects/1",
  type: "Note",
  content: "Hello",
  proof: {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: "2023-02-24T23:36:38Z",
    verificationMethod: "did:key:z6Mkabc#z6Mkabc",
    proofPurpose: "assertionMethod",
    proofValue: "z3FXQ",
  },
};

function newScope(options: Record<string, unknown> = {}): SignedValueScope {
  return enterSignedValueScope(options).scope;
}

function retainedSubject(): object {
  const subject = {};
  retainSignedRepresentation(subject, structuredClone(securedDocument));
  return subject;
}

test("isPlainJsonTree() accepts plain JSON and rejects everything else", () => {
  ok(isPlainJsonTree(securedDocument));
  ok(isPlainJsonTree([1, "two", null, { three: true }]));
  ok(isPlainJsonTree(Object.create(null)));

  ok(!isPlainJsonTree(undefined));
  ok(!isPlainJsonTree(Number.NaN));
  ok(!isPlainJsonTree(Number.POSITIVE_INFINITY));
  ok(!isPlainJsonTree(new Date()));
  ok(!isPlainJsonTree(new URL("https://example.com/")));
  ok(!isPlainJsonTree({ nested: { deeper: undefined } }));

  const withSymbolKey: Record<string | symbol, unknown> = { a: 1 };
  withSymbolKey[Symbol("b")] = 2;
  ok(!isPlainJsonTree(withSymbolKey));

  const withAccessor = {};
  Object.defineProperty(withAccessor, "a", { get: () => 1, enumerable: true });
  ok(!isPlainJsonTree(withAccessor));

  const withHiddenProperty = {};
  Object.defineProperty(withHiddenProperty, "a", {
    value: 1,
    enumerable: false,
  });
  ok(!isPlainJsonTree(withHiddenProperty));
});

test("retainSignedRepresentation() attaches a frozen, hidden snapshot", () => {
  const subject: Record<string, unknown> = {};
  retainSignedRepresentation(subject, structuredClone(securedDocument));
  const retained = getRetainedSignedRepresentation(subject);

  deepStrictEqual(retained, securedDocument);
  ok(Object.isFrozen(retained));
  ok(Object.isFrozen((retained as Record<string, unknown>).proof));
  // The carrier must not show up in ordinary enumeration or serialization.
  deepStrictEqual(Object.keys(subject), []);
  strictEqual(JSON.stringify(subject), "{}");
  // A fresh object, such as the one `clone()` builds, has no snapshot.
  strictEqual(getRetainedSignedRepresentation({}), undefined);
  strictEqual(getRetainedSignedRepresentation(null), undefined);
  strictEqual(getRetainedSignedRepresentation("string"), undefined);
});

test("retainSignedRepresentation() rejects a value that is not plain JSON", () => {
  throws(
    () =>
      retainSignedRepresentation({}, {
        created: new Date(),
      } as unknown as Record<string, unknown>),
    TypeError,
  );
  throws(
    () =>
      retainSignedRepresentation(
        {},
        [1, 2] as unknown as Record<string, unknown>,
      ),
    TypeError,
  );
});

test("isMarkerSafeContext() accepts contexts Fedify can vet offline", () => {
  ok(isMarkerSafeContext(null));
  ok(isMarkerSafeContext("https://www.w3.org/ns/activitystreams"));
  ok(isMarkerSafeContext([
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
    "https://w3id.org/fep/ef61",
  ]));
  ok(isMarkerSafeContext([
    "https://www.w3.org/ns/activitystreams",
    { ex: "https://example.com/ns#" },
  ]));
});

test("isMarkerSafeContext() rejects contexts that could hide a placeholder", () => {
  // A context Fedify cannot resolve offline cannot be vetted at all.
  ok(!isMarkerSafeContext("https://example.com/unknown-context"));
  // An `@id` alias other than ActivityStreams' own `id`.
  ok(!isMarkerSafeContext({ identifier: "@id" }));
  ok(!isMarkerSafeContext({ identifier: { "@id": "@id" } }));
  // An indirect alias: `i` resolves through `id`, which ActivityStreams maps
  // to `@id`.  A target with no scheme separator is never an IRI.
  ok(
    !isMarkerSafeContext([
      "https://www.w3.org/ns/activitystreams",
      { i: "id" },
    ]),
  );
  ok(!isMarkerSafeContext({ relative: { "@id": "ns#term" } }));
  // `@nest` moves a property value into a wrapper map.
  ok(!isMarkerSafeContext({ payload: "@nest" }));
  ok(
    !isMarkerSafeContext({
      object: {
        "@id": "https://www.w3.org/ns/activitystreams#object",
        "@nest": "payload",
      },
    }),
  );
  // An id map or type map turns the identifier into a map key.
  ok(
    !isMarkerSafeContext({
      object: {
        "@id": "https://www.w3.org/ns/activitystreams#object",
        "@container": "@id",
      },
    }),
  );
  ok(
    !isMarkerSafeContext({
      object: {
        "@id": "https://www.w3.org/ns/activitystreams#object",
        "@container": ["@set", "@type"],
      },
    }),
  );
  // A prefix, `@vocab` or `@base` covering the placeholder namespace lets
  // compaction emit a shortened or relative marker.
  ok(!isMarkerSafeContext({ urn: "urn:" }));
  // A term named after the placeholder's scheme makes a JSON-LD processor
  // read the marker as a compact IRI, whatever the term points at.
  ok(!isMarkerSafeContext({ urn: "https://example.com/ns#" }));
  ok(!isMarkerSafeContext({ urn: { "@id": "https://example.com/ns#urn" } }));
  ok(!isMarkerSafeContext({ "@vocab": "urn:x-fedify-signed-value:" }));
  ok(!isMarkerSafeContext({ "@base": "urn:" }));
  ok(!isMarkerSafeContext({ everything: "" }));
  // A scoped context is only as safe as its own definitions.
  ok(isMarkerSafeContext({
    Note: {
      "@id": "https://www.w3.org/ns/activitystreams#Note",
      "@context": { ex: "https://example.com/ns#" },
    },
  }));
  ok(
    !isMarkerSafeContext({
      Note: {
        "@id": "https://www.w3.org/ns/activitystreams#Note",
        "@context": { identifier: "@id" },
      },
    }),
  );
});

test("enterSignedValueScope() gives each call its own scope", () => {
  const callerOptions = { format: "compact" as const };
  const first = { ...callerOptions };
  const second = { ...callerOptions };
  const firstEntry = enterSignedValueScope(first);
  const secondEntry = enterSignedValueScope(second);

  ok(firstEntry.owner);
  ok(secondEntry.owner);
  ok(firstEntry.scope !== secondEntry.scope);
  // The caller's own object is never touched.
  deepStrictEqual(Object.getOwnPropertySymbols(callerOptions), []);

  // A nested frame inherits the scope through the generated spread.
  const nested = enterSignedValueScope({ ...first, format: "expand" });
  ok(!nested.owner);
  strictEqual(nested.scope, firstEntry.scope);
});

test("enterSignedValueScope() disables retention where it cannot apply", () => {
  ok(enterSignedValueScope({}).scope.enabled);
  ok(enterSignedValueScope({ format: "compact" }).scope.enabled);
  // An expanded document has no compact representation to preserve.
  ok(!enterSignedValueScope({ format: "expand" }).scope.enabled);
  // A context that could hide a placeholder turns the whole mechanism off
  // rather than risking a corrupted document.
  ok(
    !enterSignedValueScope({
      format: "compact",
      context: { identifier: "@id" } as unknown as Record<string, string>,
    }).scope.enabled,
  );
});

test("retainedSignedValueRef() mints one marker per instance", () => {
  const scope = newScope();
  const subject = retainedSubject();
  const first = retainedSignedValueRef(subject, scope);
  const second = retainedSignedValueRef(subject, scope);

  ok(first != null);
  deepStrictEqual(first, second);
  ok(first["@id"].startsWith("urn:x-fedify-signed-value:"));
  strictEqual(
    scope.documents.get(first["@id"]),
    scope.documents.get(second!["@id"]),
  );
  strictEqual(retainedSignedValueRef({}, scope), undefined);
  strictEqual(retainedSignedValueRef(null, scope), undefined);
  strictEqual(
    retainedSignedValueRef(subject, newScope({ format: "expand" })),
    undefined,
  );
});

test("resolveSignedValues() restores every supported reference shape", () => {
  const scope = newScope();
  const subject = retainedSubject();
  const marker = retainedSignedValueRef(subject, scope)!["@id"];
  retainedSignedValueRef(subject, scope);
  retainedSignedValueRef(subject, scope);

  const resolved = resolveSignedValues({
    "@context": ["https://www.w3.org/ns/activitystreams"],
    object: marker,
    attachment: [{ "@id": marker }],
    tag: { id: marker },
  }, scope) as Record<string, unknown>;

  deepStrictEqual(resolved.object, securedDocument);
  deepStrictEqual((resolved.attachment as unknown[])[0], securedDocument);
  deepStrictEqual(resolved.tag, securedDocument);
  // Each site gets its own copy.
  ok(resolved.object !== resolved.tag);
});

test("resolveSignedValues() leaves a document without placeholders alone", () => {
  const scope = newScope();
  const document = { id: "https://example.com/notes/1" };
  strictEqual(resolveSignedValues(document, scope), document);
});

test("resolveSignedValues() does not rewrite a context definition", () => {
  const scope = newScope();
  const subject = retainedSubject();
  const marker = retainedSignedValueRef(subject, scope)!["@id"];
  // A placeholder that only survives inside `@context` was never restored,
  // so the accounting check has to reject the document.
  throws(
    () => resolveSignedValues({ "@context": { marker } }, scope),
    TypeError,
  );
});

test("resolveSignedValues() rejects a document that lost a placeholder", () => {
  const scope = newScope();
  const subject = retainedSubject();
  retainedSignedValueRef(subject, scope);

  throws(
    () => resolveSignedValues({ id: "https://example.com/notes/1" }, scope),
    TypeError,
  );
});

test("resolveSignedValues() rejects a document that kept a placeholder trace", () => {
  const scope = newScope();
  const subject = retainedSubject();
  const marker = retainedSignedValueRef(subject, scope)!["@id"];
  const uuid = marker.slice("urn:x-fedify-signed-value:".length);

  throws(
    () => resolveSignedValues({ object: marker, note: `sv:${uuid}` }, scope),
    TypeError,
  );
});

test("resolveSignedValues() restores a placeholder only where it is a reference", () => {
  const scope = newScope();
  const subject = retainedSubject();
  const marker = retainedSignedValueRef(subject, scope)!["@id"];

  // A map with more than the identifier is a node of its own, not a
  // reference, so only the string inside it is replaced.
  const resolved = resolveSignedValues(
    { object: { "@id": marker, type: "Note" } },
    scope,
  ) as Record<string, unknown>;
  const object = resolved.object as Record<string, unknown>;
  deepStrictEqual(object["@id"], securedDocument);
  strictEqual(object.type, "Note");
});

test("resolveSignedValues() refuses a document too deep to walk", () => {
  const scope = newScope();
  const subject = retainedSubject();
  const marker = retainedSignedValueRef(subject, scope)!["@id"];
  // The shallow occurrence alone must not satisfy the check: a placeholder in
  // an unvisited subtree would otherwise reach the wire.
  let deep: unknown = { "@id": marker };
  for (let i = 0; i < 300; i++) deep = { attachment: deep };

  throws(
    () => resolveSignedValues({ object: marker, tag: deep }, scope),
    TypeError,
  );
});
