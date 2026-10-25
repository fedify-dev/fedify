import { test } from "@fedify/fixture";
import { parseIri } from "@fedify/vocab-runtime";
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  createAuthenticationEvidence,
  deserializeAuthentication,
  getEmptyAuthenticationEvidence,
  type InboxAuthenticationEvidence,
  type InboxPrincipal,
  isActorAuthenticated,
  serializeAuthentication,
  toProofPrincipal,
} from "./inbox-authentication.ts";

const DID = "did:key:z6MkhVPuyvgG1RkMv67azDqDCDERPXVrUg1i3qchXY5EACE3";
const OTHER_DID = "did:key:z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2";

function evidence(
  overrides: Partial<InboxAuthenticationEvidence>,
): InboxAuthenticationEvidence {
  return createAuthenticationEvidence({
    ...getEmptyAuthenticationEvidence(),
    verified: true,
    ...overrides,
  });
}

function actor(
  id: string,
  mechanism: InboxPrincipal["mechanism"] = "http-signatures",
): InboxPrincipal {
  return { kind: "actor", id: parseIri(id), mechanism, keyId: null };
}

test("isActorAuthenticated() uses the effective principals", () => {
  const alice = new URL("https://example.com/users/alice");
  const relay = new URL("https://relay.example/actor");
  const forwarded = evidence({
    requestSigners: [actor(relay.href)],
    documentSigners: [actor(alice.href, "linked-data-signatures")],
  });
  assert(isActorAuthenticated(forwarded, alice));
  // When the document is signed, the deliverer does not speak for it:
  assertFalse(isActorAuthenticated(forwarded, relay));
  const delivered = evidence({ requestSigners: [actor(alice.href)] });
  assert(isActorAuthenticated(delivered, alice));
  assertFalse(isActorAuthenticated(delivered, alice, { scope: "document" }));
  const fetched = evidence({
    originAuthenticated: [actor(alice.href, "origin")],
  });
  assert(isActorAuthenticated(fetched, alice));
  assertFalse(isActorAuthenticated(getEmptyAuthenticationEvidence(), alice));
  // IDs are compared exactly:
  assertFalse(
    isActorAuthenticated(
      delivered,
      new URL("https://example.com/users/alice/"),
    ),
  );
});

test("isActorAuthenticated() compares portable actors canonically", () => {
  const portable = parseIri(`ap://${DID}/actor`);
  const compatible = new URL(
    `https://gateway.example/.well-known/apgateway/${DID}/actor`,
  );
  const otherGateway = new URL(
    `https://other.example/.well-known/apgateway/${DID}/actor`,
  );
  const byActor = evidence({ requestSigners: [actor(portable.href)] });
  assert(isActorAuthenticated(byActor, compatible));
  assert(isActorAuthenticated(byActor, otherGateway));
  assertFalse(
    isActorAuthenticated(byActor, parseIri(`ap://${DID}/other`)),
  );
  const byAuthority = evidence({
    documentSigners: [{
      kind: "portable-authority",
      id: new URL(DID),
      mechanism: "object-integrity-proofs",
      keyId: new URL(`${DID}#${DID.slice(8)}`),
    }],
  });
  assert(isActorAuthenticated(byAuthority, portable));
  assert(isActorAuthenticated(byAuthority, compatible));
  assertFalse(
    isActorAuthenticated(byAuthority, parseIri(`ap://${OTHER_DID}/actor`)),
  );
  // A DID authenticates no ordinary web actor:
  assertFalse(
    isActorAuthenticated(byAuthority, new URL("https://example.com/users/a")),
  );
  // Malformed compatible identifiers never match:
  assertFalse(
    isActorAuthenticated(
      byActor,
      new URL("https://gateway.example/.well-known/apgateway/did:bogus"),
    ),
  );
});

test("serializeAuthentication() round-trips through JSON", () => {
  const original = evidence({
    requestSigners: [{
      kind: "actor",
      id: new URL("https://example.com/users/alice"),
      mechanism: "http-signatures",
      keyId: new URL("https://example.com/users/alice#main-key"),
    }],
    documentSigners: [{
      kind: "portable-authority",
      id: new URL(DID),
      mechanism: "object-integrity-proofs",
      keyId: null,
    }],
  });
  const expanded = [{ "@id": "https://example.com/activities/1" }];
  const restored = deserializeAuthentication(
    JSON.parse(JSON.stringify(serializeAuthentication(original))),
    expanded,
    null,
  );
  assertEquals(restored, { ...original, expandedActivity: expanded });
  for (
    const malformed of [
      null,
      {},
      { ...serializeAuthentication(original), verified: "yes" },
      { ...serializeAuthentication(original), documentSigners: null },
      {
        ...serializeAuthentication(original),
        requestSigners: [{ kind: "server", id: "x", mechanism: "origin" }],
      },
      {
        ...serializeAuthentication(original),
        requestSigners: [{
          kind: "actor",
          id: "not a url",
          mechanism: "httpSignatures",
          keyId: null,
        }],
      },
    ]
  ) {
    assertEquals(deserializeAuthentication(malformed, [], null), null);
  }
});

test("authentication preserves the queued principal wire format", () => {
  // These are literal queued values, independently of the serializer.
  const queued = {
    verified: true,
    requestSigners: [{
      kind: "actor",
      id: "https://example.com/users/alice",
      mechanism: "httpSignatures",
      keyId: "https://example.com/users/alice#main-key",
    }, {
      kind: "actor",
      id: "https://example.com/users/alice",
      mechanism: "linkedDataSignatures",
      keyId: null,
    }],
    documentSigners: [{
      kind: "portableAuthority",
      id: DID,
      mechanism: "objectIntegrityProofs",
      keyId: `${DID}#${DID.slice(8)}`,
    }],
    originAuthenticated: [{
      kind: "actor",
      id: "https://example.com/users/alice",
      mechanism: "origin",
      keyId: null,
    }],
  } as const;
  const expanded = [{ "@id": "https://example.com/activities/1" }];
  const baseUrl = new URL("https://example.com/activities/1");
  const restored = deserializeAuthentication(queued, expanded, baseUrl);
  assert(restored != null);
  assertEquals(restored, {
    verified: true,
    requestSigners: [{
      kind: "actor",
      id: new URL("https://example.com/users/alice"),
      mechanism: "http-signatures",
      keyId: new URL("https://example.com/users/alice#main-key"),
    }, {
      kind: "actor",
      id: new URL("https://example.com/users/alice"),
      mechanism: "linked-data-signatures",
      keyId: null,
    }],
    documentSigners: [{
      kind: "portable-authority",
      id: new URL(DID),
      mechanism: "object-integrity-proofs",
      keyId: new URL(`${DID}#${DID.slice(8)}`),
    }],
    originAuthenticated: [{
      kind: "actor",
      id: new URL("https://example.com/users/alice"),
      mechanism: "origin",
      keyId: null,
    }],
    expandedActivity: expanded,
    baseUrl,
  });
  assertEquals(serializeAuthentication(restored), queued);
  // The public spelling must never become accepted queued input.  Check
  // inherited object names too, since the adapters use lookup tables.
  for (const kind of ["portable-authority", "toString", "__proto__"]) {
    assertEquals(
      deserializeAuthentication(
        {
          ...queued,
          documentSigners: [{ ...queued.documentSigners[0], kind }],
        },
        [],
        null,
      ),
      null,
    );
  }
  for (
    const mechanism of [
      "http-signatures",
      "linked-data-signatures",
      "object-integrity-proofs",
      "toString",
      "__proto__",
    ]
  ) {
    assertEquals(
      deserializeAuthentication(
        {
          ...queued,
          requestSigners: [{ ...queued.requestSigners[0], mechanism }],
        },
        [],
        null,
      ),
      null,
    );
  }
});

test("proof principals adapt internal signer kinds at the public boundary", () => {
  const id = new URL(DID);
  const keyId = new URL(`${DID}#${DID.slice(8)}`);
  for (const kind of ["actor", "portableAuthority"] as const) {
    const principal = toProofPrincipal({ kind, id, keyId });
    assertEquals(principal, {
      kind: kind === "actor" ? "actor" : "portable-authority",
      id,
      mechanism: "object-integrity-proofs",
      keyId,
    });
    assert(principal.id === id);
    assert(principal.keyId === keyId);
  }
});
