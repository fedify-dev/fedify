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
  mechanism: InboxPrincipal["mechanism"] = "httpSignatures",
): InboxPrincipal {
  return { kind: "actor", id: parseIri(id), mechanism, keyId: null };
}

test("isActorAuthenticated() uses the effective principals", () => {
  const alice = new URL("https://example.com/users/alice");
  const relay = new URL("https://relay.example/actor");
  const forwarded = evidence({
    requestSigners: [actor(relay.href)],
    documentSigners: [actor(alice.href, "linkedDataSignatures")],
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
      kind: "portableAuthority",
      id: new URL(DID),
      mechanism: "objectIntegrityProofs",
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
      mechanism: "httpSignatures",
      keyId: new URL("https://example.com/users/alice#main-key"),
    }],
    documentSigners: [{
      kind: "portableAuthority",
      id: new URL(DID),
      mechanism: "objectIntegrityProofs",
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
