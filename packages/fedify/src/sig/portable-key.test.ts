import { test } from "@fedify/fixture";
import { Create, CryptographicKey, Multikey, Person } from "@fedify/vocab";
import {
  type DocumentLoader,
  encodeMultibase,
  exportDidKey,
  exportSpki,
  FetchError,
  parseIri,
  preloadedContexts,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import serialize from "json-canon";
import {
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import { signRequest, verifyRequest } from "./http.ts";
import { fetchKey, type KeyCache } from "./key.ts";
import { doesActorOwnKey, getKeyOwner } from "./owner.ts";

const did = await exportDidKey(ed25519PublicKey.publicKey);
const didKeyId = `${did}#${did.slice("did:key:".length)}`;
const otherKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]) as CryptoKeyPair;
const otherDid = await exportDidKey(otherKeyPair.publicKey);

const actorId = `ap+ef61://${did}/actor`;
const gw1 = "https://gw1.example";
const gw2 = "https://gw2.example";

function compatibleId(gateway: string, id: string = actorId): string {
  return `${gateway}/.well-known/apgateway/${id.replace(/^ap\+ef61:\/\//, "")}`;
}

const keyId = new URL(`${compatibleId(gw1)}#main-key`);
const gatewayPublicKey = rsaPublicKey2.publicKey!;

const contextLoader: DocumentLoader = (url) => {
  const document = preloadedContexts[url];
  if (document == null) return Promise.reject(new Error(`No context: ${url}`));
  return Promise.resolve({ contextUrl: null, documentUrl: url, document });
};

function createLoader(
  responses: Record<string, unknown>,
): DocumentLoader & { readonly fetched: string[] } {
  const fetched: string[] = [];
  const loader = (url: string): Promise<RemoteDocument> => {
    fetched.push(url);
    // Fragments are not sent to servers:
    const document = responses[url.replace(/#.*$/, "")];
    if (document == null) {
      return Promise.reject(
        new FetchError(url, "HTTP 404", new Response(null, { status: 404 })),
      );
    }
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: structuredClone(document),
    });
  };
  return Object.assign(loader, { fetched });
}

async function sign(
  document: Record<string, unknown>,
  privateKey: CryptoKey = ed25519PrivateKey,
  verificationMethod: string = didKeyId,
): Promise<Record<string, unknown>> {
  const proofConfig = {
    "@context": document["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod,
    proofPurpose: "assertionMethod",
    created: "2023-02-24T23:36:38Z",
  };
  const encoder = new TextEncoder();
  const proofDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(serialize(proofConfig)),
  );
  const messageDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(serialize(document)),
  );
  const digest = new Uint8Array(64);
  digest.set(new Uint8Array(proofDigest), 0);
  digest.set(new Uint8Array(messageDigest), 32);
  const signature = await crypto.subtle.sign("Ed25519", privateKey, digest);
  return {
    ...document,
    proof: {
      ...proofConfig,
      proofValue: new TextDecoder().decode(
        encodeMultibase("base58btc", new Uint8Array(signature)),
      ),
    },
  };
}

interface ActorOptions {
  readonly id?: string;
  readonly gateways?: readonly string[];
  readonly assertionMethod?: boolean;
  readonly publicKey?: CryptoKey | null;
  readonly key?: URL;
}

async function actorJson(
  options: ActorOptions = {},
): Promise<Record<string, unknown>> {
  const id = parseIri(options.id ?? actorId);
  const key = options.key ?? keyId;
  const person = new Person({
    id,
    preferredUsername: "alice",
    inbox: parseIri(`${options.id ?? actorId}/inbox`),
    gateways: (options.gateways ?? [gw1, gw2]).map((g) => new URL(g)),
    assertionMethods: options.assertionMethod === false ? [] : [
      new Multikey({ id: key, controller: id, publicKey: gatewayPublicKey }),
    ],
    publicKeys: options.publicKey === null ? [] : [
      new CryptographicKey({
        id: key,
        owner: id,
        publicKey: options.publicKey ?? gatewayPublicKey,
      }),
    ],
  });
  const json = await person.toJsonLd({
    format: "compact",
    contextLoader,
  }) as Record<string, unknown>;
  const context = json["@context"] as unknown[];
  if (!context.includes("https://w3id.org/security/data-integrity/v1")) {
    json["@context"] = [
      ...context,
      "https://w3id.org/security/data-integrity/v1",
    ];
  }
  return json;
}

async function signedRequest(
  spec?: "draft-cavage-http-signatures-12" | "rfc9421",
  key: URL = keyId,
): Promise<Request> {
  const request = new Request("https://recipient.example/inbox", {
    method: "POST",
    body: "{}",
    headers: { "Content-Type": "application/activity+json" },
  });
  return await signRequest(request, rsaPrivateKey2, key, { spec });
}

test("verifyRequest() accepts gateway keys vouched for by portable actors", async () => {
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(await actorJson()),
  });
  for (const spec of ["draft-cavage-http-signatures-12", "rfc9421"] as const) {
    const key = await verifyRequest(await signedRequest(spec), {
      documentLoader,
      contextLoader,
      spec,
    });
    ok(key != null, spec);
    strictEqual(key.id?.href, keyId.href);
    strictEqual(key.ownerId?.href, parseIri(actorId).href);
  }
});

test("verifyRequest() accepts gateway keys only in assertionMethod", async () => {
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(await actorJson({ publicKey: null })),
  });
  const key = await verifyRequest(await signedRequest(), {
    documentLoader,
    contextLoader,
  });
  strictEqual(key?.id?.href, keyId.href);
});

test("verifyRequest() rejects gateway keys that portable actors do not vouch for", async () => {
  const unsigned = await actorJson();
  const cases: Record<string, Record<string, unknown>> = {
    "an unsigned actor document": unsigned,
    "an actor document signed by another DID": await sign(
      unsigned,
      otherKeyPair.privateKey,
      `${otherDid}#${otherDid.slice("did:key:".length)}`,
    ),
    "an unlisted gateway": await sign(await actorJson({ gateways: [gw2] })),
    "a key missing from both assertionMethod and publicKey": await sign(
      await actorJson({ assertionMethod: false, publicKey: null }),
    ),
    "a key referred to by URL in assertionMethod, embedded in publicKey":
      await sign({
        ...await actorJson({ assertionMethod: false }),
        assertionMethod: [keyId.href],
      }),
    "a key only in publicKey without an owner": await sign(
      withoutPublicKeyOwner(await actorJson({ assertionMethod: false })),
    ),
    "two keys with the same ID in publicKey": await sign(
      await duplicatePublicKey(await actorJson({ assertionMethod: false })),
    ),
    "a key referred to by URL": await sign({
      ...await actorJson({ publicKey: null, assertionMethod: false }),
      assertionMethod: [keyId.href],
    }),
    "a publicKey entry with other key material": await sign(
      await actorJson({ publicKey: rsaPublicKey3.publicKey! }),
    ),
    "a key ID for another actor": await sign(
      await actorJson({
        key: new URL(`${compatibleId(gw1, `${actorId}/other`)}#main-key`),
      }),
    ),
  };
  for (const [name, document] of Object.entries(cases)) {
    const documentLoader = createLoader({ [compatibleId(gw1)]: document });
    const key = await verifyRequest(await signedRequest(), {
      documentLoader,
      contextLoader,
    });
    strictEqual(key, null, name);
  }
  // The key ID of another actor dereferences to that actor's document:
  const otherActorKey = new URL(
    `${compatibleId(gw1, `${actorId}/other`)}#main-key`,
  );
  const documentLoader = createLoader({
    [compatibleId(gw1, `${actorId}/other`)]: await sign(await actorJson()),
  });
  strictEqual(
    await verifyRequest(await signedRequest(undefined, otherActorKey), {
      documentLoader,
      contextLoader,
    }),
    null,
  );
});

function withoutPublicKeyOwner(
  json: Record<string, unknown>,
): Record<string, unknown> {
  const { owner: _, ...publicKey } = json.publicKey as Record<string, unknown>;
  return { ...json, publicKey };
}

async function duplicatePublicKey(
  json: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const publicKey = json.publicKey as Record<string, unknown>;
  return {
    ...json,
    publicKey: [publicKey, {
      ...publicKey,
      publicKeyPem: await exportSpki(rsaPublicKey3.publicKey!),
    }],
  };
}

test("verifyRequest() accepts gateway keys referred to by URL in publicKey", async () => {
  // The publicKey entry names the key embedded in assertionMethod:
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign({
      ...await actorJson({ publicKey: null }),
      publicKey: keyId.href,
    }),
  });
  const key = await verifyRequest(await signedRequest(), {
    documentLoader,
    contextLoader,
  });
  strictEqual(key?.id?.href, keyId.href);
});

test("verifyRequest() accepts gateway keys only in publicKey", async () => {
  // Some publishers, e.g., tootik, list their RSA keys only in publicKey;
  // the DID's proof covers them all the same:
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(
      await actorJson({ assertionMethod: false }),
    ),
  });
  const key = await verifyRequest(await signedRequest(), {
    documentLoader,
    contextLoader,
  });
  strictEqual(key?.id?.href, keyId.href);
  strictEqual(key?.ownerId?.href, parseIri(actorId).href);
});

test("verifyRequest() resolves gateway keys of compatible-ID actors", async () => {
  // An actor whose own ID is a compatible identifier, as tootik's are, is
  // a portable actor:
  const id = compatibleId(gw1);
  const signed = await sign(await actorJson({ id, gateways: [gw1] }));
  let key = await verifyRequest(await signedRequest(), {
    documentLoader: createLoader({ [id]: signed }),
    contextLoader,
  });
  strictEqual(key?.id?.href, keyId.href);
  strictEqual(key?.ownerId?.href, id);
  // Also as tootik's, with the RSA key only in publicKey:
  key = await verifyRequest(await signedRequest(), {
    documentLoader: createLoader({
      [id]: await sign(
        await actorJson({ id, gateways: [gw1], assertionMethod: false }),
      ),
    }),
    contextLoader,
  });
  strictEqual(key?.id?.href, keyId.href);
  // Its document is signed by its DID; the gateway that serves it does not
  // vouch for it, so an unsigned document, e.g., at an attacker's gateway,
  // does not resolve to a key at all:
  const evil = "https://evil.example";
  const evilId = compatibleId(evil);
  const evilKeyId = new URL(`${evilId}#main-key`);
  const unsigned = await actorJson({
    id: evilId,
    gateways: [evil],
    key: evilKeyId,
  });
  const documentLoader = createLoader({ [evilId]: unsigned });
  strictEqual(
    await verifyRequest(await signedRequest(undefined, evilKeyId), {
      documentLoader,
      contextLoader,
    }),
    null,
  );
  strictEqual(
    await getKeyOwner(evilKeyId, { documentLoader, contextLoader }),
    null,
  );
  // Nor does one signed by another DID:
  strictEqual(
    await verifyRequest(await signedRequest(), {
      documentLoader: createLoader({
        [id]: await sign(
          await actorJson({ id, gateways: [gw1] }),
          otherKeyPair.privateKey,
          `${otherDid}#${otherDid.slice("did:key:".length)}`,
        ),
      }),
      contextLoader,
    }),
    null,
  );
});

test("keys at ordinary URLs cannot belong to portable actors", async () => {
  // An ordinary key URL naming a compatible-ID actor as its owner, whose
  // unsigned document at the same host lists the key back:
  const evil = "https://evil.example";
  const evilActorId = compatibleId(evil);
  const evilKeyId = new URL(`${evil}/keys/1`);
  const documentLoader = createLoader({
    [evilKeyId.href]: {
      "@context": "https://w3id.org/security/v1",
      id: evilKeyId.href,
      type: "Key",
      owner: evilActorId,
      publicKeyPem: await exportSpki(gatewayPublicKey),
    },
    [evilActorId]: await actorJson({
      id: evilActorId,
      gateways: [evil],
      key: evilKeyId,
      assertionMethod: false,
    }),
  });
  const options = { documentLoader, contextLoader };
  strictEqual(
    await verifyRequest(await signedRequest(undefined, evilKeyId), options),
    null,
  );
  strictEqual(
    (await fetchKey(evilKeyId, CryptographicKey, options)).key,
    null,
  );
  strictEqual(await getKeyOwner(evilKeyId, options), null);
  const key = new CryptographicKey({
    id: evilKeyId,
    owner: new URL(evilActorId),
    publicKey: gatewayPublicKey,
  });
  strictEqual(await getKeyOwner(key, options), null);
  ok(
    !await doesActorOwnKey(
      new Create({
        id: new URL(`${evil}/activities/1`),
        actor: new URL(evilActorId),
      }),
      key,
      options,
    ),
  );
  // Nor does the document at an ordinary key URL speak for the portable
  // actor it claims to be, even at the same origin:
  const actorKeyId = new URL(`${evil}/users/alice#main-key`);
  for (
    const document of [
      await actorJson({ id: evilActorId, gateways: [evil], key: actorKeyId }),
      // A key without an owner would belong to the actor it is embedded in:
      withoutPublicKeyOwner(
        await actorJson({
          id: evilActorId,
          gateways: [evil],
          key: actorKeyId,
          assertionMethod: false,
        }),
      ),
    ]
  ) {
    const actorOptions = {
      documentLoader: createLoader({ [`${evil}/users/alice`]: document }),
      contextLoader,
    };
    strictEqual(
      await verifyRequest(
        await signedRequest(undefined, actorKeyId),
        actorOptions,
      ),
      null,
    );
    strictEqual(
      (await fetchKey(actorKeyId, CryptographicKey, actorOptions)).key,
      null,
    );
    strictEqual(await getKeyOwner(actorKeyId, actorOptions), null);
  }
  // Nor does an ordinary owner URL that serves a portable actor document:
  const ownerKeyId = new URL(`${evil}/keys/2`);
  const ownerOptions = {
    documentLoader: createLoader({
      [ownerKeyId.href]: {
        "@context": "https://w3id.org/security/v1",
        id: ownerKeyId.href,
        type: "Key",
        owner: `${evil}/users/bob`,
        publicKeyPem: await exportSpki(gatewayPublicKey),
      },
      [`${evil}/users/bob`]: await actorJson({
        id: evilActorId,
        gateways: [evil],
        key: ownerKeyId,
        assertionMethod: false,
      }),
    }),
    contextLoader,
  };
  strictEqual(await getKeyOwner(ownerKeyId, ownerOptions), null);
  strictEqual(
    await getKeyOwner(
      new CryptographicKey({
        id: ownerKeyId,
        owner: new URL(`${evil}/users/bob`),
        publicKey: gatewayPublicKey,
      }),
      ownerOptions,
    ),
    null,
  );
  // A key cached by an older version that trusted the web origin is not
  // taken from the cache either:
  const keyCache: KeyCache = {
    get: () => Promise.resolve(key),
    set: () => Promise.resolve(),
  };
  strictEqual(
    (await fetchKey(evilKeyId, CryptographicKey, { ...options, keyCache }))
      .key,
    null,
  );
});

test("gateway keys are neither cached nor accepted outside HTTP Signatures", async () => {
  const calls: string[] = [];
  const keyCache: KeyCache = {
    get(id) {
      calls.push(`get ${id.href}`);
      return Promise.resolve(undefined);
    },
    set(id) {
      calls.push(`set ${id.href}`);
      return Promise.resolve();
    },
  };
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(await actorJson()),
  });
  ok(
    await verifyRequest(await signedRequest(), {
      documentLoader,
      contextLoader,
      keyCache,
    }) != null,
  );
  // Linked Data Signatures and Object Integrity Proofs resolve keys through
  // fetchKey() without the gateway key resolver:
  const fetchOptions = { documentLoader, contextLoader, keyCache };
  strictEqual(
    (await fetchKey(keyId, CryptographicKey, fetchOptions)).key,
    null,
  );
  strictEqual((await fetchKey(keyId, Multikey, fetchOptions)).key, null);
  deepStrictEqual(calls.filter((c) => c.includes(keyId.origin)), []);
});

test("doesActorOwnKey() and getKeyOwner() resolve gateway keys to portable actors", async () => {
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(await actorJson()),
  });
  const options = { documentLoader, contextLoader };
  const key = await verifyRequest(await signedRequest(), options);
  ok(key != null);
  const activity = (actor: string) =>
    new Create({
      id: parseIri(`ap+ef61://${did}/activities/1`),
      actor: parseIri(actor),
    });
  ok(await doesActorOwnKey(activity(actorId), key, options));
  // The actor's compatible identifier on any gateway is the same actor:
  ok(await doesActorOwnKey(activity(compatibleId(gw2)), key, options));
  // Another actor under the same DID is not:
  ok(!await doesActorOwnKey(activity(`${actorId}/other`), key, options));
  strictEqual(
    (await getKeyOwner(keyId, options))?.id?.href,
    parseIri(actorId).href,
  );
  strictEqual((await getKeyOwner(key, options))?.id?.href, key.ownerId?.href);
  // The same key ID with other key material is not the actor's key:
  const forged = key.clone({ publicKey: rsaPublicKey3.publicKey });
  strictEqual(await getKeyOwner(forged, options), null);
  ok(!await doesActorOwnKey(activity(actorId), forged, options));
});

test("doesActorOwnKey() and getKeyOwner() do not fall back for rejected gateway keys", async () => {
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await actorJson(),
  });
  const options = { documentLoader, contextLoader };
  const key = new CryptographicKey({
    id: keyId,
    owner: parseIri(actorId),
    publicKey: gatewayPublicKey,
  });
  const activity = new Create({
    id: parseIri(`ap+ef61://${did}/activities/1`),
    actor: parseIri(actorId),
  });
  ok(!await doesActorOwnKey(activity, key, options));
  strictEqual(await getKeyOwner(keyId, options), null);
  strictEqual(await getKeyOwner(key, options), null);
});

test("verifyRequest() binds gateway keys to the actor whose document is signed", async () => {
  // A remote context that changes between loads could make the document
  // identify one actor when parsed and another when its proof is verified.
  // Here it first says the document is the victim's actor, and then that it
  // is the attacker's, whose DID signs it:
  const attackerDid = otherDid;
  const attackerActorId = `ap+ef61://${attackerDid}/actor`;
  const shiftingContext = "https://attacker.example/context";
  let loads = 0;
  const shiftingContextLoader: DocumentLoader = (url) => {
    if (url !== shiftingContext) return contextLoader(url);
    loads++;
    // Parsing the fetched document loads the context twice before its proof
    // is verified:
    const document = {
      "@context": loads <= 2
        ? { victimId: "@id", attackerId: "https://attacker.example/ns#a" }
        : { victimId: "https://attacker.example/ns#v", attackerId: "@id" },
    };
    return Promise.resolve({ contextUrl: null, documentUrl: url, document });
  };
  const { id: _, ...victim } = await actorJson({ gateways: [gw1] });
  const document = await sign(
    {
      ...victim,
      "@context": [...victim["@context"] as unknown[], shiftingContext],
      victimId: actorId,
      attackerId: attackerActorId,
    },
    otherKeyPair.privateKey,
    `${attackerDid}#${attackerDid.slice("did:key:".length)}`,
  );
  const documentLoader = createLoader({ [compatibleId(gw1)]: document });
  strictEqual(
    await verifyRequest(await signedRequest(), {
      documentLoader,
      contextLoader: shiftingContextLoader,
    }),
    null,
  );
  ok(loads > 2, "the shifting context was loaded for the proof");
  loads = 0;
  strictEqual(
    await getKeyOwner(keyId, {
      documentLoader,
      contextLoader: shiftingContextLoader,
    }),
    null,
  );
});
