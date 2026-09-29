import { test } from "@fedify/fixture";
import {
  Create,
  CryptographicKey,
  Multikey,
  Note,
  Person,
} from "@fedify/vocab";
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
import { KvKeyCache } from "../federation/keycache.ts";
import { MemoryKvStore } from "../federation/kv.ts";
import {
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import { signRequest, verifyRequest, verifyRequestDetailed } from "./http.ts";
import {
  fetchKey,
  type FetchKeyOptions,
  type FetchKeyResult,
  type KeyCache,
} from "./key.ts";
import { signJsonLd, verifyJsonLd } from "./ld.ts";
import { doesActorOwnKey, getKeyOwner } from "./owner.ts";
import { createProof, verifyProof } from "./proof.ts";

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
  proofOptions: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const proofConfig = {
    "@context": document["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod,
    proofPurpose: "assertionMethod",
    created: "2023-02-24T23:36:38Z",
    ...proofOptions,
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

const specs = ["draft-cavage-http-signatures-12", "rfc9421"] as const;

function fetchKeyOf(
  cls: typeof CryptographicKey | typeof Multikey,
  options: FetchKeyOptions,
): Promise<FetchKeyResult<CryptographicKey | Multikey>> {
  return cls === CryptographicKey
    ? fetchKey(keyId, CryptographicKey, options)
    : fetchKey(keyId, Multikey, options);
}

function fetchCount(
  loader: DocumentLoader & { readonly fetched: string[] },
  url: URL = keyId,
): number {
  const document = url.href.replace(/#.*$/, "");
  return loader.fetched.filter((u) => u.replace(/#.*$/, "") === document)
    .length;
}

test("verifyRequest() caches failures to fetch compatible key IDs", async () => {
  const unreachable: Record<string, DocumentLoader> = {
    "404 Not Found": createLoader({}),
    "a network error": (url) => Promise.reject(new TypeError(`${url}`)),
  };
  for (const spec of specs) {
    for (const [name, inner] of Object.entries(unreachable)) {
      const fetched: string[] = [];
      const documentLoader = Object.assign(
        (url: string) => {
          fetched.push(url);
          return inner(url);
        },
        { fetched },
      );
      const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
      const options = { documentLoader, contextLoader, keyCache, spec };
      for (let i = 0; i < 3; i++) {
        const result = await verifyRequestDetailed(
          await signedRequest(spec),
          options,
        );
        ok(!result.verified, `${spec}, ${name}`);
        strictEqual(result.reason.type, "keyFetchError", `${spec}, ${name}`);
      }
      strictEqual(fetchCount(documentLoader), 1, `${spec}, ${name}`);
      // A failure to fetch the key fails every purpose alike:
      for (const cls of [CryptographicKey, Multikey]) {
        const result = await fetchKeyOf(cls, options);
        strictEqual(result.key, null);
        ok(result.cached, `${spec}, ${name}, ${cls.name}`);
      }
      strictEqual(fetchCount(documentLoader), 1, `${spec}, ${name}`);
    }
  }
});

test("verifyRequest() caches gateway keys only for HTTP Signatures", async () => {
  for (const spec of specs) {
    const documentLoader = createLoader({
      [compatibleId(gw1)]: await sign(await actorJson()),
    });
    const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
    const options = { documentLoader, contextLoader, keyCache, spec };
    for (let i = 0; i < 3; i++) {
      const key = await verifyRequest(await signedRequest(spec), options);
      strictEqual(key?.ownerId?.href, parseIri(actorId).href, spec);
    }
    strictEqual(fetchCount(documentLoader), 1, spec);
    // The cached gateway key is not accepted for a Linked Data Signature...
    const document = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Create",
      id: "https://gw1.example/activities/1",
      actor: compatibleId(gw1),
    };
    const { signature } = await signJsonLd(document, rsaPrivateKey2, keyId, {
      contextLoader,
    });
    ok(
      !await verifyJsonLd({ ...document, signature }, options),
      spec,
    );
    // ...nor for an Object Integrity Proof:
    const note = new Note({
      id: new URL("https://gw1.example/notes/1"),
      attribution: new URL(compatibleId(gw1)),
      content: "Hello",
    });
    const proof = await createProof(note, ed25519PrivateKey, keyId, {
      contextLoader,
    });
    strictEqual(
      await verifyProof(
        await note.toJsonLd({ format: "compact", contextLoader }),
        proof,
        options,
      ),
      null,
      spec,
    );
    for (const cls of [CryptographicKey, Multikey]) {
      strictEqual((await fetchKeyOf(cls, options)).key, null, spec);
    }
    // Neither did they spoil the key for HTTP Signatures:
    const fetched = fetchCount(documentLoader);
    ok(await verifyRequest(await signedRequest(spec), options) != null, spec);
    strictEqual(fetchCount(documentLoader), fetched, spec);
  }
});

test("verifyRequest() is not rejected by other purposes' negative entries", async () => {
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(await actorJson()),
  });
  const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
  const options = { documentLoader, contextLoader, keyCache };
  for (const cls of [CryptographicKey, Multikey]) {
    const result = await fetchKeyOf(cls, options);
    strictEqual(result.key, null);
  }
  ok(await verifyRequest(await signedRequest(), options) != null);
  // The negative entries are still there for their own purposes:
  const fetched = fetchCount(documentLoader);
  for (const cls of [CryptographicKey, Multikey]) {
    const result = await fetchKeyOf(cls, options);
    strictEqual(result.key, null);
    ok(result.cached);
  }
  strictEqual(fetchCount(documentLoader), fetched);
});

test("fetchKey() does not share negative entries of compatible key IDs across key classes", async () => {
  // A standalone Multikey document at a compatible URL is not
  // a CryptographicKey, but is a valid Multikey of its controller:
  const ownerId = new URL("https://gw1.example/users/bob");
  const multikey = new Multikey({
    id: keyId,
    controller: ownerId,
    publicKey: ed25519PublicKey.publicKey,
  });
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await multikey.toJsonLd({ contextLoader }),
    [ownerId.href]: await new Person({
      id: ownerId,
      assertionMethods: [multikey],
    }).toJsonLd({ contextLoader }),
  });
  const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
  const options = { documentLoader, contextLoader, keyCache };
  strictEqual((await fetchKey(keyId, CryptographicKey, options)).key, null);
  strictEqual(await verifyRequest(await signedRequest(), options), null);
  const result = await fetchKey(keyId, Multikey, options);
  strictEqual(result.key?.id?.href, keyId.href);
  ok(!result.cached);
  const cached = await fetchKey(keyId, Multikey, options);
  strictEqual(cached.key?.id?.href, keyId.href);
  ok(cached.cached);
  const other = await fetchKey(keyId, CryptographicKey, options);
  strictEqual(other.key, null);
  ok(other.cached);
});

test("verifyRequest() caches rejected portable actor documents", async () => {
  for (const spec of specs) {
    const documentLoader = createLoader({
      [compatibleId(gw1)]: await actorJson(),
    });
    const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
    const options = { documentLoader, contextLoader, keyCache, spec };
    for (let i = 0; i < 3; i++) {
      const result = await verifyRequestDetailed(
        await signedRequest(spec),
        options,
      );
      ok(!result.verified, spec);
      // A rejected document is not a failure to fetch it:
      strictEqual(result.reason.type, "invalidSignature", spec);
    }
    strictEqual(fetchCount(documentLoader), 1, spec);
  }
});

test("verifyRequest() refetches a cached gateway key that fails to verify", async () => {
  for (const spec of specs) {
    const responses: Record<string, unknown> = {
      [compatibleId(gw1)]: await sign(await actorJson()),
    };
    const documentLoader = createLoader(responses);
    const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
    const options = { documentLoader, contextLoader, keyCache, spec };
    ok(await verifyRequest(await signedRequest(spec), options) != null);
    // The gateway replaces its key:
    responses[compatibleId(gw1)] = await sign(
      await actorJson({
        publicKey: rsaPublicKey3.publicKey!,
        assertionMethod: false,
      }),
    );
    const rotated = async () =>
      await signRequest(
        new Request("https://recipient.example/inbox", {
          method: "POST",
          body: "{}",
          headers: { "Content-Type": "application/activity+json" },
        }),
        rsaPrivateKey3,
        keyId,
        { spec },
      );
    ok(await verifyRequest(await rotated(), options) != null, spec);
    strictEqual(fetchCount(documentLoader), 2, spec);
    // The freshly fetched key replaced the cached one:
    ok(await verifyRequest(await rotated(), options) != null, spec);
    strictEqual(fetchCount(documentLoader), 2, spec);
  }
});

test("verifyRequest() drops a cached gateway key when its refetch fails", async () => {
  for (const spec of specs) {
    const responses: Record<string, unknown> = {
      [compatibleId(gw1)]: await sign(await actorJson()),
    };
    const documentLoader = createLoader(responses);
    const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
    const options = { documentLoader, contextLoader, keyCache, spec };
    ok(await verifyRequest(await signedRequest(spec), options) != null);
    delete responses[compatibleId(gw1)];
    // A signature the cached key does not verify makes Fedify refetch it:
    const forged = await signRequest(
      new Request("https://recipient.example/inbox", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/activity+json" },
      }),
      rsaPrivateKey3,
      keyId,
      { spec },
    );
    const result = await verifyRequestDetailed(forged, options);
    ok(!result.verified, spec);
    strictEqual(result.reason.type, "keyFetchError", spec);
    strictEqual(fetchCount(documentLoader), 2, spec);
    // The stale key is not used anymore, and the failure is cached:
    const next = await verifyRequestDetailed(
      await signedRequest(spec),
      options,
    );
    ok(!next.verified, spec);
    strictEqual(next.reason.type, "keyFetchError", spec);
    strictEqual(fetchCount(documentLoader), 2, spec);
  }
});

test("verifyRequest() does not trust a cached gateway key for longer than its proof", async () => {
  let now = Temporal.Now.instant();
  const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"], {
    now: () => now,
  });
  const expires = now.add({ minutes: 30 });
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(
      await actorJson(),
      ed25519PrivateKey,
      didKeyId,
      { expires: expires.toString() },
    ),
  });
  const options = { documentLoader, contextLoader, keyCache };
  ok(await verifyRequest(await signedRequest(), options) != null);
  now = expires.subtract({ seconds: 1 });
  ok(await verifyRequest(await signedRequest(), options) != null);
  strictEqual(fetchCount(documentLoader), 1);
  now = expires;
  ok(await verifyRequest(await signedRequest(), options) != null);
  strictEqual(fetchCount(documentLoader), 2);
});

test("verifyRequest() looks up a cached gateway key again after an hour", async () => {
  let now = Temporal.Now.instant();
  const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"], {
    now: () => now,
  });
  const responses: Record<string, unknown> = {
    [compatibleId(gw1)]: await sign(await actorJson()),
  };
  const documentLoader = createLoader(responses);
  const options = { documentLoader, contextLoader, keyCache };
  const start = now;
  ok(await verifyRequest(await signedRequest(), options) != null);
  now = start.add({ minutes: 59 });
  ok(await verifyRequest(await signedRequest(), options) != null);
  strictEqual(fetchCount(documentLoader), 1);
  // The actor drops the gateway, which keeps signing with the same key:
  responses[compatibleId(gw1)] = await sign(
    await actorJson({ gateways: [gw2] }),
  );
  now = start.add({ hours: 1 });
  strictEqual(await verifyRequest(await signedRequest(), options), null);
  strictEqual(fetchCount(documentLoader), 2);
});

test("verifyRequest() rejects and caches gateway keys of expired documents", async () => {
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(
      await actorJson(),
      ed25519PrivateKey,
      didKeyId,
      { expires: "2000-01-01T00:00:00Z" },
    ),
  });
  const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
  const options = { documentLoader, contextLoader, keyCache };
  strictEqual(await verifyRequest(await signedRequest(), options), null);
  strictEqual(await verifyRequest(await signedRequest(), options), null);
  strictEqual(fetchCount(documentLoader), 1);
});

test("verifyRequest() takes the expiration of a proof whatever its context", async () => {
  // The document's context maps the expires term to another property, but
  // proof verification still honors a literal expires option, so the cache
  // has to as well:
  let now = Temporal.Now.instant();
  const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"], {
    now: () => now,
  });
  const expires = now.add({ minutes: 30 });
  const actor = await actorJson();
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(
      {
        ...actor,
        "@context": [
          ...actor["@context"] as unknown[],
          { expires: "https://example.com/ns#notExpiration" },
        ],
      },
      ed25519PrivateKey,
      didKeyId,
      { expires: expires.toString() },
    ),
  });
  const options = { documentLoader, contextLoader, keyCache };
  ok(await verifyRequest(await signedRequest(), options) != null);
  now = expires.subtract({ seconds: 1 });
  ok(await verifyRequest(await signedRequest(), options) != null);
  strictEqual(fetchCount(documentLoader), 1);
  now = expires;
  ok(await verifyRequest(await signedRequest(), options) != null);
  strictEqual(fetchCount(documentLoader), 2);
});

test("a key cache without namespaces caches only fetch failures of compatible key IDs", async () => {
  const calls: string[] = [];
  const entries = new Map<string, CryptographicKey | Multikey | null>();
  const keyCache: KeyCache = {
    get(id) {
      calls.push(`get ${id.href}`);
      return Promise.resolve(entries.get(id.href));
    },
    set(id, key) {
      calls.push(`set ${id.href} ${key == null ? "null" : "key"}`);
      entries.set(id.href, key);
      return Promise.resolve();
    },
  };
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(await actorJson()),
  });
  const options = { documentLoader, contextLoader, keyCache };
  ok(await verifyRequest(await signedRequest(), options) != null);
  for (const cls of [CryptographicKey, Multikey]) {
    strictEqual((await fetchKeyOf(cls, options)).key, null);
  }
  ok(await verifyRequest(await signedRequest(), options) != null);
  deepStrictEqual(
    calls.filter((c) => c.startsWith("set ") && c.includes(keyId.origin)),
    [],
  );
  const unreachable = new URL(`${compatibleId(gw2)}#main-key`);
  strictEqual(
    (await fetchKey(unreachable, CryptographicKey, options)).key,
    null,
  );
  deepStrictEqual(
    calls.filter((c) => c.startsWith("set ") && c.includes(gw2)),
    [`set ${unreachable.href} null`],
  );
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
