import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  Create,
  DataIntegrityProof,
  Note,
  type Object,
  Question,
} from "@fedify/vocab";
import { encodeMultibase, exportDidKey, parseIri } from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { assert, assertEquals } from "@std/assert";
import { encodeHex } from "byte-encodings/hex";
import serialize from "json-canon";
import vector from "../../test-vectors/fep-8b32/map-local-create-note.json" with {
  type: "json",
};
import conflictVector from "../../test-vectors/fep-8b32/map-local-context-conflict.json" with {
  type: "json",
};
import { normalizeOutgoingActivityJsonLd } from "../compat/outgoing-jsonld.ts";
import { preloadedOnlyDocumentLoader } from "../compat/preloaded-context-loader.ts";
import { ed25519PrivateKey, ed25519PublicKey } from "../testing/keys.ts";
import {
  type CompoundProofDiscoveryLimits,
  verifyCompoundProofDocuments,
} from "./compound-proof.ts";
import { signObject, verifyProof } from "./proof.ts";

const outerPrivateKey = await crypto.subtle.importKey(
  "jwk",
  {
    kty: "OKP",
    crv: "Ed25519",
    // cSpell: disable
    d: "yW756hDF5BTEcXI6_53nLDX6W3D66X6IMuysfS4rjtY",
    x: "sA2Nk45_dz1RVlqtNqYj9TRPf10ZYPnPPo4SYg6igQ8",
    // cSpell: enable
    key_ops: ["sign"],
    ext: true,
  },
  "Ed25519",
  true,
  ["sign"],
);
const outerPublicKey = await crypto.subtle.importKey(
  "jwk",
  {
    kty: "OKP",
    crv: "Ed25519",
    // cSpell: disable
    x: "sA2Nk45_dz1RVlqtNqYj9TRPf10ZYPnPPo4SYg6igQ8",
    // cSpell: enable
    key_ops: ["verify"],
    ext: true,
  },
  "Ed25519",
  true,
  ["verify"],
);
const outerDid = await exportDidKey(outerPublicKey);
const innerDid = await exportDidKey(ed25519PublicKey.publicKey);
const outerMethod = outerDid.substring("did:key:".length);
const innerMethod = innerDid.substring("did:key:".length);
const outerKeyId = new URL(`${outerDid}#${outerMethod}`);
const innerKeyId = new URL(`${innerDid}#${innerMethod}`);
const vectorInnerKeyId = new URL(vector.keys.inner.verificationMethod);
const conflictVectorInnerKeyId = new URL(
  conflictVector.keys.inner.verificationMethod,
);
const context = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
];
const distinctInnerContext = [
  ...context,
  { ex: "https://example.com/ns#" },
];
const options = {
  context,
  contextLoader: mockDocumentLoader,
  documentLoader: mockDocumentLoader,
};
const inboundOptions = {
  contextLoader: preloadedOnlyDocumentLoader,
  documentLoader: preloadedOnlyDocumentLoader,
};
const compoundLimits: CompoundProofDiscoveryLimits = {
  maxDepth: 16,
  maxMaps: 32,
  maxProofs: 8,
  maxBytes: 16_384,
};

async function parseProof(
  document: Record<string, unknown>,
): Promise<DataIntegrityProof> {
  const proof = document.proof;
  assert(proof != null && typeof proof === "object" && !Array.isArray(proof));
  return await DataIntegrityProof.fromJsonLd(
    { "@context": document["@context"], ...proof },
    options,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  assert(value != null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function withoutDirectProof(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const unsecuredDocument = structuredClone(document);
  delete unsecuredDocument.proof;
  return unsecuredDocument;
}

function withoutProofValue(
  proof: Record<string, unknown>,
): Record<string, unknown> {
  const proofConfiguration = structuredClone(proof);
  delete proofConfiguration.proofValue;
  return proofConfiguration;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

interface RecordedProofEntry {
  readonly document: Record<string, unknown>;
  readonly proofConfiguration: Record<string, unknown>;
  readonly proof: Record<string, unknown>;
  readonly key: {
    readonly controller: string;
    readonly verificationMethod: string;
    readonly publicKeyMultibase: string;
    readonly publicKeyJwk: JsonWebKey;
    readonly testPrivateKeyJwk: JsonWebKey;
  };
  readonly canonicalization: {
    readonly documentJcs: string;
    readonly proofConfigurationJcs: string;
  };
  readonly hashes: {
    readonly documentSha256: string;
    readonly proofConfigurationSha256: string;
    readonly combinedSigningInput: string;
  };
  readonly proofValue: string;
}

async function assertRecordedProof(entry: RecordedProofEntry): Promise<void> {
  assertEquals(withoutProofValue(entry.proof), entry.proofConfiguration);
  assertEquals(entry.proof.proofValue, entry.proofValue);

  const documentJcs = serialize(entry.document);
  const proofConfigurationJcs = serialize(entry.proofConfiguration);
  assertEquals(documentJcs, entry.canonicalization.documentJcs);
  assertEquals(
    proofConfigurationJcs,
    entry.canonicalization.proofConfigurationJcs,
  );

  const documentDigest = await sha256(documentJcs);
  const proofConfigurationDigest = await sha256(proofConfigurationJcs);
  assertEquals(encodeHex(documentDigest), entry.hashes.documentSha256);
  assertEquals(
    encodeHex(proofConfigurationDigest),
    entry.hashes.proofConfigurationSha256,
  );

  const combinedSigningInput = new Uint8Array(
    proofConfigurationDigest.length + documentDigest.length,
  );
  combinedSigningInput.set(proofConfigurationDigest);
  combinedSigningInput.set(documentDigest, proofConfigurationDigest.length);
  assertEquals(
    encodeHex(combinedSigningInput),
    entry.hashes.combinedSigningInput,
  );
  assertEquals(
    entry.hashes.combinedSigningInput,
    entry.hashes.proofConfigurationSha256 + entry.hashes.documentSha256,
  );

  const privateJwk = structuredClone(entry.key.testPrivateKeyJwk);
  const publicJwk = structuredClone(entry.key.publicKeyJwk);
  assertEquals(privateJwk.x, publicJwk.x);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    "Ed25519",
    true,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicJwk,
    "Ed25519",
    true,
    ["verify"],
  );
  const controller = await exportDidKey(publicKey);
  assertEquals(controller, entry.key.controller);
  const publicKeyMultibase = controller.replace(/^did:key:/, "");
  assertEquals(publicKeyMultibase, entry.key.publicKeyMultibase);
  assertEquals(
    entry.key.verificationMethod,
    `${controller}#${publicKeyMultibase}`,
  );
  assertEquals(
    entry.proofConfiguration.verificationMethod,
    entry.key.verificationMethod,
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign("Ed25519", privateKey, combinedSigningInput),
  );
  assert(
    await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      signature,
      combinedSigningInput,
    ),
  );
  const derivedProofValue = new TextDecoder().decode(
    encodeMultibase("base58btc", signature),
  );
  assertEquals(derivedProofValue, entry.proofValue);
}

test("map-local compound vector records independently reproducible proofs", async () => {
  const securedOuter = asRecord(vector.documents.finalSecuredCompound);
  const securedInner = asRecord(vector.documents.securedInner);
  const outerProof = asRecord(securedOuter.proof);
  const innerProof = asRecord(securedInner.proof);
  const replacementInnerProof = asRecord(
    vector.documents.replacementInnerProof,
  );
  const replacementInnerProofConfiguration = withoutProofValue(
    replacementInnerProof,
  );

  assertEquals(
    withoutDirectProof(securedOuter),
    vector.documents.outerUnsecuredDocument,
  );
  assertEquals(
    withoutDirectProof(securedInner),
    vector.documents.innerUnsecuredDocument,
  );
  assertEquals(
    withoutProofValue(outerProof),
    vector.documents.outerProofConfiguration,
  );
  assertEquals(
    withoutProofValue(innerProof),
    vector.documents.innerProofConfiguration,
  );

  const entries = [
    {
      document: vector.documents.outerUnsecuredDocument,
      proofConfiguration: vector.documents.outerProofConfiguration,
      proof: outerProof,
      key: vector.keys.outer,
      canonicalization: vector.canonicalization.outer,
      hashes: vector.hashes.outer,
      proofValue: vector.proofValues.outer,
    },
    {
      document: vector.documents.innerUnsecuredDocument,
      proofConfiguration: vector.documents.innerProofConfiguration,
      proof: innerProof,
      key: vector.keys.inner,
      canonicalization: vector.canonicalization.inner,
      hashes: vector.hashes.inner,
      proofValue: vector.proofValues.inner,
    },
    {
      document: vector.documents.innerUnsecuredDocument,
      proofConfiguration: replacementInnerProofConfiguration,
      proof: replacementInnerProof,
      key: vector.keys.inner,
      canonicalization: vector.canonicalization.replacementInner,
      hashes: vector.hashes.replacementInner,
      proofValue: vector.proofValues.replacementInner,
    },
  ] as const;

  for (const entry of entries) await assertRecordedProof(entry);
});

test("the context-conflict vector records valid proofs and divergent semantics", async () => {
  const compound = asRecord(conflictVector.documents.finalSecuredCompound);
  const embedded = asRecord(compound.object);
  const securedInner = asRecord(conflictVector.documents.securedInner);
  const outerProof = asRecord(compound.proof);
  const innerProof = asRecord(embedded.proof);

  assertEquals(embedded, securedInner);
  assertEquals(
    withoutDirectProof(compound),
    conflictVector.documents.outerUnsecuredDocument,
  );
  assertEquals(
    withoutDirectProof(embedded),
    conflictVector.documents.innerUnsecuredDocument,
  );

  await assertRecordedProof({
    document: conflictVector.documents.outerUnsecuredDocument,
    proofConfiguration: conflictVector.documents.outerProofConfiguration,
    proof: outerProof,
    key: conflictVector.keys.outer,
    canonicalization: conflictVector.canonicalization.outer,
    hashes: conflictVector.hashes.outer,
    proofValue: conflictVector.proofValues.outer,
  });
  await assertRecordedProof({
    document: conflictVector.documents.innerUnsecuredDocument,
    proofConfiguration: conflictVector.documents.innerProofConfiguration,
    proof: innerProof,
    key: conflictVector.keys.inner,
    canonicalization: conflictVector.canonicalization.inner,
    hashes: conflictVector.hashes.inner,
    proofValue: conflictVector.proofValues.inner,
  });

  const verifiedInner = await verifyProof(
    embedded,
    await parseProof(embedded),
    inboundOptions,
  );
  assertEquals(
    verifiedInner != null,
    conflictVector.expectedVerification.original.inner,
  );
  assertEquals(verifiedInner?.id, conflictVectorInnerKeyId);
  const verifiedOuter = await verifyProof(
    compound,
    await parseProof(compound),
    inboundOptions,
  );
  assertEquals(
    verifiedOuter != null,
    conflictVector.expectedVerification.original.outer,
  );
  assertEquals(verifiedOuter?.id, outerKeyId);

  const standaloneExpansion = await jsonld.expand(embedded, {
    documentLoader: preloadedOnlyDocumentLoader,
  });
  const compoundExpansion = await jsonld.expand(compound, {
    documentLoader: preloadedOnlyDocumentLoader,
  });
  const content = "https://www.w3.org/ns/activitystreams#content";
  const object = "https://www.w3.org/ns/activitystreams#object";
  const standaloneContent = asRecord(standaloneExpansion[0])[content];
  const inParentObject = asRecord(
    (asRecord(compoundExpansion[0])[object] as unknown[])[0],
  );
  const inParentContent = inParentObject[content];
  assertEquals(
    serialize(standaloneExpansion[0]) === serialize(inParentObject),
    conflictVector.expectedInterpretation.standaloneAndInParentExpansionsEqual,
  );
  assertEquals(standaloneContent, [{
    "@value": "A portable note with inherited language",
  }]);
  assertEquals(inParentContent, [{
    "@value": "A portable note with inherited language",
    "@language": conflictVector.expectedInterpretation.inParentContentLanguage,
  }]);
  assertEquals(
    (standaloneContent as Array<Record<string, unknown>>)[0]["@language"] ??
      null,
    conflictVector.expectedInterpretation.standaloneContentLanguage,
  );
  assertEquals(
    serialize(standaloneContent) !== serialize(inParentContent),
    !conflictVector.expectedInterpretation.standaloneAndInParentExpansionsEqual,
  );
});

test("the raw same-context baseline verifies map-locally", async () => {
  const compound = structuredClone(vector.documents.finalSecuredCompound);
  const embedded = compound.object as Record<string, unknown>;
  const embeddedProof = embedded.proof as Record<string, unknown>;

  assertEquals(embedded, vector.documents.securedInner);
  assertEquals(embeddedProof["@context"], context);
  assertEquals(embedded["@context"], context);
  assert("proof" in embedded);
  const verifiedInnerKey = await verifyProof(
    embedded,
    await parseProof(embedded),
    options,
  );
  assertEquals(
    verifiedInnerKey != null,
    vector.expectedVerification.original.inner,
  );
  assertEquals(
    verifiedInnerKey != null,
    vector.expectedVerification.standaloneInner,
  );
  assertEquals(verifiedInnerKey?.id, vectorInnerKeyId);
  const verifiedOuterKey = await verifyProof(
    compound,
    await parseProof(compound),
    options,
  );
  assertEquals(
    verifiedOuterKey != null,
    vector.expectedVerification.original.outer,
  );
  assertEquals(
    verifiedOuterKey != null,
    vector.expectedVerification.standaloneOuter,
  );
  assertEquals(verifiedOuterKey?.id, outerKeyId);

  const tampered = structuredClone(compound);
  const tamperedInner = tampered.object as Record<string, unknown>;
  tamperedInner.content = "A tampered portable note";
  const tamperedInnerKey = await verifyProof(
    tamperedInner,
    await parseProof(tamperedInner),
    options,
  );
  assertEquals(
    tamperedInnerKey != null,
    vector.expectedVerification.tamperedInnerContent.inner,
  );
  const tamperedOuterKey = await verifyProof(
    tampered,
    await parseProof(tampered),
    options,
  );
  assertEquals(
    tamperedOuterKey != null,
    vector.expectedVerification.tamperedInnerContent.outer,
  );

  const replaced = structuredClone(compound);
  const replacedInner = replaced.object as Record<string, unknown>;
  replacedInner.proof = structuredClone(
    vector.documents.replacementInnerProof,
  );
  const replacementInnerKey = await verifyProof(
    replacedInner,
    await parseProof(replacedInner),
    options,
  );
  assertEquals(
    replacementInnerKey != null,
    vector.expectedVerification.replacedInnerProof.inner,
  );
  assertEquals(replacementInnerKey?.id, vectorInnerKeyId);
  const replacementOuterKey = await verifyProof(
    replaced,
    await parseProof(replaced),
    options,
  );
  assertEquals(
    replacementOuterKey != null,
    vector.expectedVerification.replacedInnerProof.outer,
  );
});

async function signDistinctContextNote(
  created: Temporal.Instant,
  path: string,
): Promise<Note> {
  return await signObject(
    new Note({
      id: parseIri(`ap+ef61://${innerDid}/objects/${path}`),
      attribution: parseIri(`ap+ef61://${innerDid}/actor`),
      content: "A portable note with its own context",
    }),
    ed25519PrivateKey,
    innerKeyId,
    { ...options, context: distinctInnerContext, created },
  );
}

async function serializeOutgoing(
  object: Object,
  context?: typeof distinctInnerContext,
): Promise<Record<string, unknown>> {
  return await normalizeOutgoingActivityJsonLd(
    await object.toJsonLd({
      format: "compact",
      ...options,
      context: context ?? options.context,
    }),
    mockDocumentLoader,
    { preserveNestedSecuredDocuments: true },
  ) as Record<string, unknown>;
}

async function signOuterCreate(
  created: Temporal.Instant,
  path: string,
  child: Note,
): Promise<Create> {
  return await signObject(
    new Create({
      id: parseIri(`ap+ef61://${outerDid}/activities/${path}`),
      actor: parseIri(`ap+ef61://${outerDid}/actor`),
      object: child,
    }),
    outerPrivateKey,
    outerKeyId,
    { ...options, created },
  );
}

test("typed Create serialization embeds the signed child representation", async () => {
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const inner = await signDistinctContextNote(created, "distinct-context");
  assert(inner instanceof Note);
  const standaloneInner = await serializeOutgoing(inner, distinctInnerContext);
  const outer = await signOuterCreate(created, "distinct-context", inner);
  assert(outer instanceof Create);
  const compound = await serializeOutgoing(outer);
  const embedded = compound.object as Record<string, unknown>;
  const embeddedProof = embedded.proof as Record<string, unknown>;

  // The child keeps its own document and proof contexts, which differ from
  // the parent's, and is byte-identical to its standalone secured form.
  assertEquals(embedded["@context"], distinctInnerContext);
  assertEquals(embeddedProof["@context"], distinctInnerContext);
  assertEquals(compound["@context"], context);
  assertEquals(serialize(embedded), serialize(standaloneInner));
  assertEquals(embedded.type, "Note");

  assertEquals(
    (await verifyProof(embedded, await parseProof(embedded), options))?.id,
    innerKeyId,
  );
  assertEquals(
    (await verifyProof(compound, await parseProof(compound), options))?.id,
    outerKeyId,
  );

  // The bytes on the wire also pass the inbound map-local verifier, which
  // has no outgoing-normalization fallback to fall back on.
  const mapLocal = await verifyCompoundProofDocuments(
    compound,
    compoundLimits,
    inboundOptions,
  );
  assertEquals(mapLocal.status, "ok");
  assert(mapLocal.status === "ok");
  assert(mapLocal.verified);
  assertEquals(
    mapLocal.documents.map(({ path, verified }) => ({ path, verified })),
    [{ path: "/object", verified: true }, { path: "", verified: true }],
  );
});

test("tampering with an embedded signed child invalidates both proofs", async () => {
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const inner = await signDistinctContextNote(created, "tampered");
  const outer = await signOuterCreate(created, "tampered", inner);
  const tampered = await serializeOutgoing(outer);
  const tamperedInner = tampered.object as Record<string, unknown>;
  tamperedInner.content = "A tampered portable note";

  assertEquals(
    await verifyProof(tamperedInner, await parseProof(tamperedInner), options),
    null,
  );
  assertEquals(
    await verifyProof(tampered, await parseProof(tampered), options),
    null,
  );
});

test("replacing an embedded child proof invalidates only the outer proof", async () => {
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const replacementCreated = Temporal.Instant.from("2023-02-25T23:36:38Z");
  const inner = await signDistinctContextNote(created, "replaced-proof");
  const replacement = await signDistinctContextNote(
    replacementCreated,
    "replaced-proof",
  );
  const replacementProof =
    (await serializeOutgoing(replacement, distinctInnerContext))
      .proof as Record<string, unknown>;
  const outer = await signOuterCreate(created, "replaced-proof", inner);
  const compound = await serializeOutgoing(outer);
  const replacedInner = compound.object as Record<string, unknown>;
  replacedInner.proof = replacementProof;

  assertEquals(
    (await verifyProof(replacedInner, await parseProof(replacedInner), options))
      ?.id,
    innerKeyId,
  );
  assertEquals(
    await verifyProof(compound, await parseProof(compound), options),
    null,
  );
});

test("cloning or re-signing a signed child drops its retained representation", async () => {
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const inner = await signDistinctContextNote(created, "cloned");

  // A clone may differ from the document the proof covers, so it must not
  // reuse the retained JSON.
  const cloned = inner.clone({});
  assert(cloned instanceof Note);
  const clonedCompound = await serializeOutgoing(
    await signOuterCreate(created, "cloned", cloned),
  );
  const clonedEmbedded = clonedCompound.object as Record<string, unknown>;
  assertEquals(clonedEmbedded["@context"], undefined);
  assertEquals(
    (clonedEmbedded.proof as Record<string, unknown>)["@context"],
    undefined,
  );

  // A second proof puts the child outside the map-local profile, which
  // accepts exactly one direct proof per map, so nothing is retained.
  const reSigned = await signObject(
    inner,
    ed25519PrivateKey,
    innerKeyId,
    { ...options, context: distinctInnerContext, created },
  );
  const reSignedCompound = await serializeOutgoing(
    await signOuterCreate(created, "re-signed", reSigned),
  );
  const reSignedEmbedded = reSignedCompound.object as Record<string, unknown>;
  assertEquals(reSignedEmbedded["@context"], undefined);
});

test("mutating a signed child does not change its embedded representation", async () => {
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const inner = await signDistinctContextNote(created, "mutated");
  const standaloneInner = await serializeOutgoing(inner, distinctInnerContext);

  // `signObject()` captures the document its proof covers.  Mutating the
  // returned object in place is unsupported and leaves the snapshot alone,
  // so the embedded child still verifies.
  const proof = (await Array.fromAsync(inner.getProofs(options)))[0];
  assert(proof.proofValue != null);
  proof.proofValue[0] ^= 0xff;

  const compound = await serializeOutgoing(
    await signOuterCreate(created, "mutated", inner),
  );
  const embedded = compound.object as Record<string, unknown>;
  assertEquals(serialize(embedded), serialize(standaloneInner));
  assertEquals(
    (await verifyProof(embedded, await parseProof(embedded), options))?.id,
    innerKeyId,
  );
});

test("a signed child is embedded through a compactable ancestor too", async () => {
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const inner = await signDistinctContextNote(created, "compactable-parent");
  const standaloneInner = await serializeOutgoing(inner, distinctInnerContext);
  // `Note` is compactable and `Question` is not, so the inner note is
  // embedded by the fast path and then passed through the enclosing
  // question's JSON-LD compaction.
  const wrapper = new Note({
    id: parseIri(`ap+ef61://${innerDid}/objects/wrapper`),
    attachments: [inner],
  });
  const question = new Question({
    id: parseIri(`ap+ef61://${outerDid}/objects/question`),
    exclusiveOptions: [wrapper],
  });
  const serialized = await question.toJsonLd() as Record<string, unknown>;
  const embeddedWrapper = serialized.oneOf as Record<string, unknown>;
  const embedded = embeddedWrapper.attachment as Record<string, unknown>;

  assertEquals(serialize(embedded), serialize(standaloneInner));
  assertEquals(
    (await verifyProof(embedded, await parseProof(embedded), options))?.id,
    innerKeyId,
  );
});

test("typed Create serialization bypasses a parsed child's JSON-LD cache", async () => {
  // Parsing does not establish which representation was signed, so
  // `fromJsonLd()` does not retain one and a reparsed secured child still
  // loses its contexts when it is embedded through a typed parent.
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const inner = await signDistinctContextNote(created, "reparsed-context");
  const standaloneInner = await serializeOutgoing(inner, distinctInnerContext);
  const standaloneProof = await parseProof(standaloneInner);
  const reparsedInner = await Note.fromJsonLd(standaloneInner, {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
  });
  assert(reparsedInner instanceof Note);
  assertEquals(await reparsedInner.toJsonLd(), standaloneInner);

  const reparsedCompound = await serializeOutgoing(
    await signOuterCreate(created, "reparsed-context", reparsedInner),
  );
  const reparsedEmbedded = reparsedCompound.object as Record<string, unknown>;
  const reparsedEmbeddedProof = reparsedEmbedded.proof as Record<
    string,
    unknown
  >;

  assertEquals(reparsedEmbedded["@context"], undefined);
  assertEquals(reparsedEmbeddedProof["@context"], undefined);
  assertEquals(
    reparsedEmbeddedProof.proofValue,
    (standaloneInner.proof as Record<string, unknown>).proofValue,
  );
  assertEquals(
    await verifyProof(reparsedEmbedded, standaloneProof, options),
    null,
  );
  assertEquals(
    (await verifyProof(
      reparsedCompound,
      await parseProof(reparsedCompound),
      options,
    ))?.id,
    outerKeyId,
  );
});

test("verifyProof() does not invent a missing child context", async () => {
  const received = structuredClone(vector.documents.finalSecuredCompound);
  const receivedInner = received.object as Record<string, unknown>;
  const receivedInnerProof = receivedInner.proof as Record<string, unknown>;
  delete receivedInner["@context"];
  delete receivedInnerProof["@context"];
  const snapshot = structuredClone(received);
  const proof = await DataIntegrityProof.fromJsonLd(
    received.proof,
    inboundOptions,
  );

  assertEquals(
    await verifyProof(received, proof, inboundOptions),
    null,
  );
  assertEquals(received, snapshot);

  const guessed = structuredClone(received);
  const guessedInner = guessed.object as Record<string, unknown>;
  const guessedInnerProof = guessedInner.proof as Record<string, unknown>;
  guessedInner["@context"] = structuredClone(guessed["@context"]);
  guessedInnerProof["@context"] = structuredClone(guessed["@context"]);
  assertEquals(
    (await verifyProof(guessed, proof, inboundOptions))?.id,
    outerKeyId,
  );
});

test("signing a document too deep to retain still succeeds", async () => {
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  // A retained representation has to pass a bounded plain-JSON check.  A
  // document that exceeds those bounds must fall back to ordinary
  // serialization rather than make `signObject()` fail.
  let deep = new Note({
    id: parseIri(`ap+ef61://${innerDid}/objects/deep-leaf`),
    content: "A portable note nested past the retention bounds",
  });
  for (let i = 0; i < 40; i++) {
    deep = new Note({
      id: parseIri(`ap+ef61://${innerDid}/objects/deep-${i}`),
      attachments: [deep],
    });
  }
  const signed = await signObject(deep, ed25519PrivateKey, innerKeyId, {
    ...options,
    context: distinctInnerContext,
    created,
  });

  assertEquals((await Array.fromAsync(signed.getProofs(options))).length, 1);
  const compound = await serializeOutgoing(
    await signOuterCreate(created, "deep", signed),
  );
  const embedded = compound.object as Record<string, unknown>;
  assertEquals(embedded["@context"], undefined);
});
