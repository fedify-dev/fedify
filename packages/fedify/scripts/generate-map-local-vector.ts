// Generates the deterministic, implementation-neutral FEP-8b32 map-local
// compound-proof fixture.  Run this only when intentionally updating the
// vector, then review the JSON and confirm repeated runs are byte-identical.
// The private keys below are deterministic test material; never reuse them.
// https://github.com/fedify-dev/fedify/issues/938

import { encodeMultibase, exportDidKey } from "@fedify/vocab-runtime";
import { encodeHex } from "byte-encodings/hex";
import serialize from "json-canon";

const context = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/data-integrity/v1",
];
const created = "2023-02-24T23:36:38Z";
const replacementCreated = "2023-02-25T23:36:38Z";

const outerPrivateJwk: JsonWebKey = {
  kty: "OKP",
  crv: "Ed25519",
  // cSpell: disable
  d: "yW756hDF5BTEcXI6_53nLDX6W3D66X6IMuysfS4rjtY",
  x: "sA2Nk45_dz1RVlqtNqYj9TRPf10ZYPnPPo4SYg6igQ8",
  // cSpell: enable
  key_ops: ["sign"],
  ext: true,
};
const innerPrivateJwk: JsonWebKey = {
  kty: "OKP",
  crv: "Ed25519",
  // cSpell: disable
  d: "LledL195fP9TQGQrkE2l2Y2k48UvqCzYI9M1zXyh7zQ",
  x: "LR8epAGDe-cVq5p2Tx49CCfphpk1rNhkNoY9i-XEUfg",
  // cSpell: enable
  key_ops: ["sign"],
  ext: true,
};

function publicJwk(privateJwk: JsonWebKey): JsonWebKey {
  const { d: _privateScalar, ...publicKey } = privateJwk;
  return { ...publicKey, key_ops: ["verify"] };
}

interface SecuredDocumentDetails {
  readonly securedDocument: Record<string, unknown>;
  readonly proof: Record<string, unknown>;
  readonly proofConfiguration: Record<string, unknown>;
  readonly canonicalDocument: string;
  readonly canonicalProofConfiguration: string;
  readonly documentHash: string;
  readonly proofConfigurationHash: string;
  readonly combinedHash: string;
}

async function importKeyPair(jwk: JsonWebKey): Promise<CryptoKeyPair> {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    "Ed25519",
    true,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { ...jwk, d: undefined, key_ops: ["verify"] },
    "Ed25519",
    true,
    ["verify"],
  );
  return { privateKey, publicKey };
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function secure(
  unsecuredDocument: Record<string, unknown>,
  privateKey: CryptoKey,
  verificationMethod: string,
  proofCreated: string,
): Promise<SecuredDocumentDetails> {
  const proofConfiguration = {
    "@context": unsecuredDocument["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod,
    proofPurpose: "assertionMethod",
    created: proofCreated,
  };
  const canonicalDocument = serialize(unsecuredDocument);
  const canonicalProofConfiguration = serialize(proofConfiguration);
  const documentHashBytes = await sha256(canonicalDocument);
  const proofConfigurationHashBytes = await sha256(
    canonicalProofConfiguration,
  );
  const combined = new Uint8Array(64);
  combined.set(proofConfigurationHashBytes, 0);
  combined.set(documentHashBytes, 32);
  const signature = new Uint8Array(
    await crypto.subtle.sign("Ed25519", privateKey, combined),
  );
  const proof = {
    ...proofConfiguration,
    proofValue: new TextDecoder().decode(
      encodeMultibase("base58btc", signature),
    ),
  };
  return {
    securedDocument: { ...unsecuredDocument, proof },
    proof,
    proofConfiguration,
    canonicalDocument,
    canonicalProofConfiguration,
    documentHash: encodeHex(documentHashBytes),
    proofConfigurationHash: encodeHex(proofConfigurationHashBytes),
    combinedHash: encodeHex(combined),
  };
}

const outerKeys = await importKeyPair(outerPrivateJwk);
const innerKeys = await importKeyPair(innerPrivateJwk);
const outerDid = await exportDidKey(outerKeys.publicKey);
const innerDid = await exportDidKey(innerKeys.publicKey);
const outerMethod = outerDid.substring("did:key:".length);
const innerMethod = innerDid.substring("did:key:".length);
const outerVerificationMethod = `${outerDid}#${outerMethod}`;
const innerVerificationMethod = `${innerDid}#${innerMethod}`;

const innerUnsecuredDocument = {
  "@context": context,
  id: `ap+ef61://${innerDid}/objects/1`,
  type: "Note",
  attributedTo: `ap+ef61://${innerDid}/actor`,
  content: "A portable note",
};
const inner = await secure(
  innerUnsecuredDocument,
  innerKeys.privateKey,
  innerVerificationMethod,
  created,
);
const replacementInner = await secure(
  innerUnsecuredDocument,
  innerKeys.privateKey,
  innerVerificationMethod,
  replacementCreated,
);
const outerUnsecuredDocument = {
  "@context": context,
  id: `ap+ef61://${outerDid}/activities/1`,
  type: "Create",
  actor: `ap+ef61://${outerDid}/actor`,
  object: inner.securedDocument,
};
const outer = await secure(
  outerUnsecuredDocument,
  outerKeys.privateKey,
  outerVerificationMethod,
  created,
);

const vector = {
  id: "fedify-fep-8b32-map-local-create-note-v1",
  profile: "Fedify map-local compound proof profile",
  cryptosuite: "eddsa-jcs-2022",
  notes: [
    "Each map has one direct literal proof property.",
    "Each map has an explicit local context.",
    "The outer unsecured document retains the complete secured inner map.",
    "Combined inputs concatenate proof-configuration SHA-256 first and document SHA-256 second.",
  ],
  keys: {
    outer: {
      controller: outerDid,
      verificationMethod: outerVerificationMethod,
      publicKeyMultibase: outerMethod,
      publicKeyJwk: publicJwk(outerPrivateJwk),
      testPrivateKeyJwk: outerPrivateJwk,
    },
    inner: {
      controller: innerDid,
      verificationMethod: innerVerificationMethod,
      publicKeyMultibase: innerMethod,
      publicKeyJwk: publicJwk(innerPrivateJwk),
      testPrivateKeyJwk: innerPrivateJwk,
    },
  },
  documents: {
    finalSecuredCompound: outer.securedDocument,
    securedInner: inner.securedDocument,
    outerUnsecuredDocument,
    innerUnsecuredDocument,
    outerProofConfiguration: outer.proofConfiguration,
    innerProofConfiguration: inner.proofConfiguration,
    replacementInnerProof: replacementInner.proof,
  },
  canonicalization: {
    outer: {
      documentJcs: outer.canonicalDocument,
      proofConfigurationJcs: outer.canonicalProofConfiguration,
    },
    inner: {
      documentJcs: inner.canonicalDocument,
      proofConfigurationJcs: inner.canonicalProofConfiguration,
    },
    replacementInner: {
      documentJcs: replacementInner.canonicalDocument,
      proofConfigurationJcs: replacementInner.canonicalProofConfiguration,
    },
  },
  hashes: {
    outer: {
      documentSha256: outer.documentHash,
      proofConfigurationSha256: outer.proofConfigurationHash,
      combinedSigningInput: outer.combinedHash,
    },
    inner: {
      documentSha256: inner.documentHash,
      proofConfigurationSha256: inner.proofConfigurationHash,
      combinedSigningInput: inner.combinedHash,
    },
    replacementInner: {
      documentSha256: replacementInner.documentHash,
      proofConfigurationSha256: replacementInner.proofConfigurationHash,
      combinedSigningInput: replacementInner.combinedHash,
    },
  },
  proofValues: {
    outer: outer.proof.proofValue,
    inner: inner.proof.proofValue,
    replacementInner: replacementInner.proof.proofValue,
  },
  expectedVerification: {
    original: { inner: true, outer: true },
    tamperedInnerContent: { inner: false, outer: false },
    replacedInnerProof: { inner: true, outer: false },
    standaloneInner: true,
    standaloneOuter: true,
  },
};

const output = new URL(
  "../test-vectors/fep-8b32/map-local-create-note.json",
  import.meta.url,
);
await Deno.mkdir(new URL("./", output), { recursive: true });
await Deno.writeTextFile(output, JSON.stringify(vector, null, 2) + "\n");

const contextConflictOuterContext = [
  ...context,
  { "@language": "en" },
];
const contextConflictInnerUnsecuredDocument = {
  "@context": context,
  id: `ap+ef61://${innerDid}/objects/context-conflict`,
  type: "Note",
  attributedTo: `ap+ef61://${innerDid}/actor`,
  content: "A portable note with inherited language",
};
const contextConflictInner = await secure(
  contextConflictInnerUnsecuredDocument,
  innerKeys.privateKey,
  innerVerificationMethod,
  created,
);
const contextConflictOuterUnsecuredDocument = {
  "@context": contextConflictOuterContext,
  id: `ap+ef61://${outerDid}/activities/context-conflict`,
  type: "Create",
  actor: `ap+ef61://${outerDid}/actor`,
  object: contextConflictInner.securedDocument,
};
const contextConflictOuter = await secure(
  contextConflictOuterUnsecuredDocument,
  outerKeys.privateKey,
  outerVerificationMethod,
  created,
);
const contextConflictVector = {
  id: "fedify-fep-8b32-map-local-context-conflict-v1",
  profile: "Fedify map-local compound proof profile",
  cryptosuite: "eddsa-jcs-2022",
  notes: [
    "The parent sets a default language that the child's local context does not reset.",
    "The inner proof authenticates the extracted standalone child JSON map.",
    "The outer proof authenticates the complete compound JSON snapshot.",
    "Both proofs can be valid even though standalone and in-parent JSON-LD expansions differ.",
  ],
  keys: {
    outer: {
      controller: outerDid,
      verificationMethod: outerVerificationMethod,
      publicKeyMultibase: outerMethod,
      publicKeyJwk: publicJwk(outerPrivateJwk),
      testPrivateKeyJwk: outerPrivateJwk,
    },
    inner: {
      controller: innerDid,
      verificationMethod: innerVerificationMethod,
      publicKeyMultibase: innerMethod,
      publicKeyJwk: publicJwk(innerPrivateJwk),
      testPrivateKeyJwk: innerPrivateJwk,
    },
  },
  documents: {
    finalSecuredCompound: contextConflictOuter.securedDocument,
    securedInner: contextConflictInner.securedDocument,
    outerUnsecuredDocument: contextConflictOuterUnsecuredDocument,
    innerUnsecuredDocument: contextConflictInnerUnsecuredDocument,
    outerProofConfiguration: contextConflictOuter.proofConfiguration,
    innerProofConfiguration: contextConflictInner.proofConfiguration,
  },
  canonicalization: {
    outer: {
      documentJcs: contextConflictOuter.canonicalDocument,
      proofConfigurationJcs: contextConflictOuter.canonicalProofConfiguration,
    },
    inner: {
      documentJcs: contextConflictInner.canonicalDocument,
      proofConfigurationJcs: contextConflictInner.canonicalProofConfiguration,
    },
  },
  hashes: {
    outer: {
      documentSha256: contextConflictOuter.documentHash,
      proofConfigurationSha256: contextConflictOuter.proofConfigurationHash,
      combinedSigningInput: contextConflictOuter.combinedHash,
    },
    inner: {
      documentSha256: contextConflictInner.documentHash,
      proofConfigurationSha256: contextConflictInner.proofConfigurationHash,
      combinedSigningInput: contextConflictInner.combinedHash,
    },
  },
  proofValues: {
    outer: contextConflictOuter.proof.proofValue,
    inner: contextConflictInner.proof.proofValue,
  },
  expectedVerification: {
    original: { inner: true, outer: true },
  },
  expectedInterpretation: {
    standaloneAndInParentExpansionsEqual: false,
    standaloneContentLanguage: null,
    inParentContentLanguage: "en",
  },
};

const contextConflictOutput = new URL(
  "../test-vectors/fep-8b32/map-local-context-conflict.json",
  import.meta.url,
);
await Deno.writeTextFile(
  contextConflictOutput,
  JSON.stringify(contextConflictVector, null, 2) + "\n",
);
