import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, Follow, Note } from "@fedify/vocab";
import type {
  DocumentLoader,
  PortableObjectVerifier,
} from "@fedify/vocab-runtime";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
} from "@std/assert";
import { actorDehydrator, autoIdAssigner } from "../compat/transformers.ts";
import { MemoryKvStore } from "../federation/kv.ts";
import { FederationImpl } from "../federation/middleware.ts";
import { createProof, signObject } from "../sig/proof.ts";
import { ed25519Multikey, ed25519PrivateKey } from "../testing/keys.ts";
import { getDefaultPortableObjectVerifier } from "./portable-verifier.ts";

const did = "did:key:z6Mkabc";
const compatibleNoteId =
  `https://gw.example/.well-known/apgateway/${did}/objects/1`;

const documentLoader: DocumentLoader = (url) => {
  if (url !== compatibleNoteId) return mockDocumentLoader(url);
  return Promise.resolve({
    contextUrl: null,
    documentUrl: url,
    document: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `ap://${did}/objects/1`,
      type: "Note",
      content: "Portable note",
    },
  });
};

function createRecordingVerifier(): PortableObjectVerifier & { calls: number } {
  const verifier = Object.assign(
    // deno-lint-ignore require-await
    async () => {
      verifier.calls++;
      return { verified: true as const };
    },
    { calls: 0 },
  );
  return verifier;
}

/**
 * Runs the callback while collecting warnings of the category that `clone()`
 * logs when it drops a default verifier.
 */
async function collectPortableWarnings(
  callback: () => Promise<void>,
): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  await reset();
  try {
    await configure({
      sinks: { buffer: (record: LogRecord) => records.push(record) },
      loggers: [
        { category: ["fedify", "vocab", "portable"], sinks: ["buffer"] },
        { category: ["logtape", "meta"], sinks: [] },
      ],
    });
    await callback();
  } finally {
    await reset();
  }
  return records;
}

/** Asserts that the object verifies its portable references with `verifier`. */
async function assertVerifiesWith(
  object: Create | Follow,
  verifier: PortableObjectVerifier & { calls: number },
): Promise<void> {
  const before = verifier.calls;
  assertInstanceOf(
    await object.getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
    }),
    Note,
  );
  assertEquals(verifier.calls, before + 1);
}

test("getDefaultPortableObjectVerifier()", () => {
  const verifier = createRecordingVerifier();
  assertStrictEquals(
    getDefaultPortableObjectVerifier(
      new Note({}, { verifyPortableObject: verifier }),
    ),
    verifier,
  );
  assertStrictEquals(getDefaultPortableObjectVerifier(new Note({})), undefined);
  assertStrictEquals(getDefaultPortableObjectVerifier({}), undefined);
});

test("signObject() keeps the default portable object verifier", async () => {
  const verifier = createRecordingVerifier();
  const create = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
    object: new URL(compatibleNoteId),
  }, { contextLoader: mockDocumentLoader, verifyPortableObject: verifier });
  let signed: Create | undefined;
  const warnings = await collectPortableWarnings(async () => {
    await createProof(create, ed25519PrivateKey, ed25519Multikey.id!, {
      contextLoader: mockDocumentLoader,
    });
    signed = await signObject(create, ed25519PrivateKey, ed25519Multikey.id!, {
      contextLoader: mockDocumentLoader,
      documentLoader: mockDocumentLoader,
    });
  });
  assertEquals(warnings, []);
  assertInstanceOf(signed, Create);
  await assertVerifiesWith(signed, verifier);
});

test("default activity transformers keep the default portable object verifier", async () => {
  const federation = new FederationImpl<void>({ kv: new MemoryKvStore() });
  const context = federation.createContext(new URL("http://example.com/"));
  const verifier = createRecordingVerifier();
  const follow = new Follow({
    actor: new URL("http://example.com/actors/1"),
    object: new URL(compatibleNoteId),
  }, { contextLoader: mockDocumentLoader, verifyPortableObject: verifier });
  let assigned: Follow | undefined;
  let dehydrated: Follow | undefined;
  const warnings = await collectPortableWarnings(() => {
    assigned = autoIdAssigner(follow, context) as Follow;
    dehydrated = actorDehydrator(
      assigned.clone({
        actor: new URL("http://example.com/actors/1"),
      }, { verifyPortableObject: verifier }),
      context,
    ) as Follow;
    return Promise.resolve();
  });
  assertEquals(warnings, []);
  assertInstanceOf(assigned, Follow);
  assertInstanceOf(dehydrated, Follow);
  await assertVerifiesWith(assigned, verifier);
  await assertVerifiesWith(dehydrated, verifier);
});
