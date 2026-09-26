import { test } from "@fedify/fixture";
import { assert } from "@std/assert/assert";
import { isSelfContainedSecuredDocument } from "./secured-document.ts";

function securedDocument(): Record<string, unknown> {
  return {
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
}

test("isSelfContainedSecuredDocument() accepts a complete secured document", () => {
  assert(isSelfContainedSecuredDocument(securedDocument()));

  const expandedType = securedDocument();
  (expandedType.proof as Record<string, unknown>).type =
    "https://w3id.org/security#DataIntegrityProof";
  assert(isSelfContainedSecuredDocument(expandedType));

  const typeArray = securedDocument();
  (typeArray.proof as Record<string, unknown>).type = ["DataIntegrityProof"];
  assert(isSelfContainedSecuredDocument(typeArray));
});

test("isSelfContainedSecuredDocument() rejects anything less", () => {
  assert(!isSelfContainedSecuredDocument(null));
  assert(!isSelfContainedSecuredDocument("string"));
  assert(!isSelfContainedSecuredDocument([securedDocument()]));

  for (
    const mutate of [
      // Without its own context the map cannot be extracted and verified
      // on its own, so it is not a self-contained secured document.
      (d: Record<string, unknown>) => delete d["@context"],
      (d: Record<string, unknown>) => d["@context"] = null,
      (d: Record<string, unknown>) => delete d.proof,
      (d: Record<string, unknown>) => d.proof = null,
      // A proof set is outside the map-local compound-proof profile.
      (d: Record<string, unknown>) => d.proof = [d.proof],
      // Anything short of a complete `eddsa-jcs-2022` proof could be an
      // application's own unrelated `proof` term.
      (d: Record<string, unknown>) =>
        (d.proof as Record<string, unknown>).type = "SomethingElse",
      (d: Record<string, unknown>) =>
        delete (d.proof as Record<string, unknown>).cryptosuite,
      (d: Record<string, unknown>) =>
        delete (d.proof as Record<string, unknown>).created,
      (d: Record<string, unknown>) =>
        delete (d.proof as Record<string, unknown>).verificationMethod,
      (d: Record<string, unknown>) =>
        delete (d.proof as Record<string, unknown>).proofPurpose,
      (d: Record<string, unknown>) =>
        (d.proof as Record<string, unknown>).proofValue = "",
      (d: Record<string, unknown>) =>
        (d.proof as Record<string, unknown>).proofValue = 42,
    ]
  ) {
    const document = securedDocument();
    mutate(document);
    assert(!isSelfContainedSecuredDocument(document));
  }
});
