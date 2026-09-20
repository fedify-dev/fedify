import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, DataIntegrityProof, Note } from "@fedify/vocab";
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

  const inboundOptions = {
    contextLoader: preloadedOnlyDocumentLoader,
    documentLoader: preloadedOnlyDocumentLoader,
  };
  const verifiedInner = await verifyProof(
    embedded,
    await parseProof(embedded),
    inboundOptions,
  );
  assertEquals(
    verifiedInner != null,
    conflictVector.expectedVerification.original.inner,
  );
  assertEquals(verifiedInner?.id, innerKeyId);
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
  assertEquals(verifiedInnerKey?.id, innerKeyId);
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
  assertEquals(replacementInnerKey?.id, innerKeyId);
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

test("typed Create serialization bypasses a parsed child's JSON-LD cache", async () => {
  const created = Temporal.Instant.from("2023-02-24T23:36:38Z");
  const unsignedInner = new Note({
    id: parseIri(`ap+ef61://${innerDid}/objects/distinct-context`),
    attribution: parseIri(`ap+ef61://${innerDid}/actor`),
    content: "A portable note with its own context",
  });
  const inner = await signObject(
    unsignedInner,
    ed25519PrivateKey,
    innerKeyId,
    { ...options, context: distinctInnerContext, created },
  );
  const standaloneInner = await normalizeOutgoingActivityJsonLd(
    await inner.toJsonLd({
      format: "compact",
      ...options,
      context: distinctInnerContext,
    }),
    mockDocumentLoader,
  ) as Record<string, unknown>;
  const outer = await signObject(
    new Create({
      id: parseIri(`ap+ef61://${outerDid}/activities/distinct-context`),
      actor: parseIri(`ap+ef61://${outerDid}/actor`),
      object: inner,
    }),
    outerPrivateKey,
    outerKeyId,
    { ...options, created },
  );
  const compound = await normalizeOutgoingActivityJsonLd(
    await outer.toJsonLd({ format: "compact", ...options }),
    mockDocumentLoader,
  ) as Record<string, unknown>;
  const embedded = compound.object as Record<string, unknown>;
  const embeddedProof = embedded.proof as Record<string, unknown>;
  const standaloneProof = await parseProof(standaloneInner);

  assertEquals(standaloneInner["@context"], distinctInnerContext);
  assertEquals(
    (standaloneInner.proof as Record<string, unknown>)["@context"],
    distinctInnerContext,
  );
  assertEquals(embedded["@context"], undefined);
  assertEquals(embeddedProof["@context"], undefined);
  assertEquals(
    embeddedProof.proofValue,
    (standaloneInner.proof as Record<string, unknown>).proofValue,
  );
  const compactedStandalone = structuredClone(standaloneInner);
  const compactedStandaloneProof = compactedStandalone.proof as Record<
    string,
    unknown
  >;
  delete compactedStandalone["@context"];
  delete compactedStandaloneProof["@context"];
  assertEquals(embedded, compactedStandalone);
  assertEquals(
    (await verifyProof(standaloneInner, standaloneProof, options))?.id,
    innerKeyId,
  );
  const rewrittenContext = structuredClone(standaloneInner);
  rewrittenContext["@context"] = context;
  assertEquals(
    await verifyProof(rewrittenContext, standaloneProof, options),
    null,
  );
  assertEquals(
    await verifyProof(embedded, standaloneProof, options),
    null,
  );
  assertEquals(
    (await verifyProof(compound, await parseProof(compound), options))?.id,
    outerKeyId,
  );

  const reparsedInner = await Note.fromJsonLd(standaloneInner, {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
  });
  assert(reparsedInner instanceof Note);
  assertEquals(await reparsedInner.toJsonLd(), standaloneInner);
  const reparsedOuter = await signObject(
    new Create({
      id: parseIri(`ap+ef61://${outerDid}/activities/reparsed-context`),
      actor: parseIri(`ap+ef61://${outerDid}/actor`),
      object: reparsedInner,
    }),
    outerPrivateKey,
    outerKeyId,
    { ...options, created },
  );
  const reparsedCompound = await normalizeOutgoingActivityJsonLd(
    await reparsedOuter.toJsonLd({ format: "compact", ...options }),
    mockDocumentLoader,
  ) as Record<string, unknown>;
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
  assertEquals(reparsedEmbedded, compactedStandalone);
  assertEquals(reparsedEmbedded, embedded);
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
  const inboundOptions = {
    contextLoader: preloadedOnlyDocumentLoader,
    documentLoader: preloadedOnlyDocumentLoader,
  };
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
