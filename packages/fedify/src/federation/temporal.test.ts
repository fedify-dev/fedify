import { assert, assertFalse } from "@std/assert";
import { test } from "../testing/mod.ts";
import { hasMalformedKnownTemporalLiteral } from "./temporal.ts";

test(
  "hasMalformedKnownTemporalLiteral() detects expanded proof timestamps",
  async () => {
    assert(
      await hasMalformedKnownTemporalLiteral(
        {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/security/data-integrity/v1",
          ],
          id: "https://example.com/activities/invalid-proof-created",
          type: "Create",
          actor: "https://example.com/person2",
          object: {
            id: "https://example.com/notes/invalid-proof-created",
            type: "Note",
            attributedTo: "https://example.com/person2",
            content: "Hello, world!",
          },
          proof: {
            type: "DataIntegrityProof",
            cryptosuite: "eddsa-jcs-2022",
            verificationMethod: "https://example.com/person2#main-key",
            proofPurpose: "assertionMethod",
            created: { "@value": "not-a-date" },
            proofValue:
              "zLaewdp4H9kqtwyrLatK4cjY5oRHwVcw4gibPSUDYDMhi4M49v8pcYk3ZB6D69dNpAPbUmY8ocuJ3m9KhKJEEg7z",
          },
        },
        undefined,
      ),
    );
  },
);

test(
  "hasMalformedKnownTemporalLiteral() follows aliases in nested objects",
  async () => {
    assert(
      await hasMalformedKnownTemporalLiteral(
        {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            {
              publishedAt: "as:published",
            },
          ],
          id: "https://example.com/activities/invalid-nested-published",
          type: "Create",
          actor: "https://example.com/person2",
          object: {
            id: "https://example.com/notes/invalid-nested-published",
            type: "Note",
            attributedTo: "https://example.com/person2",
            content: "Hello, world!",
          },
          audience: {
            type: "Note",
            publishedAt: { "@value": "not-a-date" },
          },
        },
        undefined,
      ),
    );
  },
);

test(
  "hasMalformedKnownTemporalLiteral() does not over-classify ignored as:closed values",
  async () => {
    assertFalse(
      await hasMalformedKnownTemporalLiteral(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Question",
          closed: "not-a-date",
        },
        undefined,
      ),
    );
  },
);

test(
  "hasMalformedKnownTemporalLiteral() detects date-like invalid as:closed values",
  async () => {
    assert(
      await hasMalformedKnownTemporalLiteral(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Question",
          closed: "2024-02-31T00:00:00Z",
        },
        undefined,
      ),
    );
  },
);

test(
  "hasMalformedKnownTemporalLiteral() ignores custom-typed as:closed values",
  async () => {
    assertFalse(
      await hasMalformedKnownTemporalLiteral(
        {
          "https://www.w3.org/ns/activitystreams#closed": [{
            "@value": "2024-02-31T00:00:00Z",
            "@type": "https://example.com/ns#customDateTime",
          }],
        },
        undefined,
      ),
    );
  },
);
