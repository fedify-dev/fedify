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
  fetchKeyDetailed,
  type FetchKeyOptions,
  type FetchKeyResult,
  type KeyCache,
} from "./key.ts";
import { signJsonLd, verifyJsonLd } from "./ld.ts";
import { doesActorOwnKey, getKeyOwner } from "./owner.ts";
import { resolvePortableActorKey } from "./portable-key.ts";
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

test("verifyRequest() matches gateway keys listed under ap: URIs", async () => {
  // Mitra lists the keys of portable actors under ap: URIs, but signs
  // requests with compatible key IDs on its own gateway:
  const portableKeyId = parseIri(`${actorId}#main-key`);
  const cases: Record<string, Record<string, unknown>> = {
    "both properties": await actorJson({ key: portableKeyId }),
    "assertionMethod only": await actorJson({
      key: portableKeyId,
      publicKey: null,
    }),
    "publicKey only": await actorJson({
      key: portableKeyId,
      assertionMethod: false,
    }),
  };
  for (const [name, document] of Object.entries(cases)) {
    const documentLoader = createLoader({
      [compatibleId(gw1)]: await sign(document),
    });
    for (const spec of specs) {
      const key = await verifyRequest(await signedRequest(spec), {
        documentLoader,
        contextLoader,
        spec,
      });
      strictEqual(key?.id?.href, keyId.href, `${name}, ${spec}`);
      strictEqual(key?.ownerId?.href, parseIri(actorId).href, name);
    }
  }
});

test("verifyRequest() rejects ambiguous or foreign aliases of gateway keys", async () => {
  const portableKeyId = `${actorId}#main-key`;
  const base = await actorJson();
  const assertionMethod = base.assertionMethod as Record<string, unknown>;
  const publicKey = base.publicKey as Record<string, unknown>;
  const cases: Record<string, Record<string, unknown>> = {
    // The key ID and its ap: alias both in assertionMethod, even if one is
    // just a reference:
    "an exact entry and an ap: alias in assertionMethod": {
      ...base,
      assertionMethod: [assertionMethod, {
        ...assertionMethod,
        id: portableKeyId,
      }],
    },
    "a reference and an embedded ap: alias in assertionMethod": {
      ...base,
      assertionMethod: [keyId.href, { ...assertionMethod, id: portableKeyId }],
    },
    "an exact entry and an ap: alias in publicKey": {
      ...base,
      publicKey: [publicKey, { ...publicKey, id: portableKeyId }],
    },
    // Another gateway's key with the same fragment is not this gateway's:
    "a key of another gateway": await actorJson({
      key: new URL(`${compatibleId(gw2)}#main-key`),
    }),
    // URL parsing would resolve the dot segments into the key ID:
    "an ap: key ID with dot segments": {
      ...base,
      assertionMethod: {
        ...assertionMethod,
        id: portableKeyId.replace("/actor#", "/x/../actor#"),
      },
      publicKey: {
        ...publicKey,
        id: portableKeyId.replace("/actor#", "/x/../actor#"),
      },
    },
    "a compatible key ID with dot segments": {
      ...base,
      assertionMethod: {
        ...assertionMethod,
        id: keyId.href.replace("/actor#", "/x/../actor#"),
      },
      publicKey: {
        ...publicKey,
        id: keyId.href.replace("/actor#", "/x/../actor#"),
      },
    },
  };
  for (const [name, document] of Object.entries(cases)) {
    const documentLoader = createLoader({
      [compatibleId(gw1)]: await sign(document),
    });
    strictEqual(
      await verifyRequest(await signedRequest(), {
        documentLoader,
        contextLoader,
      }),
      null,
      name,
    );
  }
});

test("verifyRequest() refuses key IDs whose identity URL parsing changes", async () => {
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(await actorJson()),
  });
  // Draft-cavage signatures do not sign the keyId parameter, so it can be
  // replaced as it is written:
  const request = await signedRequest("draft-cavage-http-signatures-12");
  const dotted = keyId.href.replace("/actor#", "/x/../actor#");
  const headers = new Headers(request.headers);
  headers.set(
    "Signature",
    headers.get("Signature")!.replace(keyId.href, dotted),
  );
  strictEqual(
    await verifyRequest(new Request(request, { headers }), {
      documentLoader,
      contextLoader,
    }),
    null,
  );
  strictEqual(documentLoader.fetched.length, 0);
  // Nor can it be looked up as a string, however it is spelled:
  const dottedPortable = `${actorId.replace("/actor", "/x/../actor")}#main-key`;
  for (
    const id of [
      dotted,
      dottedPortable,
      // URL parsing strips leading spaces, and tabs anywhere:
      ` ${dotted}`,
      ` ${dottedPortable}`,
      ` ${parseIri(dottedPortable).href}`,
      dottedPortable.replace("ap+ef61:", "ap+\tef61:"),
      dotted.replace("did:key:", "did:ke\ty:"),
      // Dot segments can leave the gateway path altogether:
      `${gw1}/.well-known/apgateway/${did}/../../../users/alice#main-key`,
      ` ap://not-a-did/actor#main-key`,
    ]
  ) {
    let error: unknown;
    try {
      await fetchKey(id, CryptographicKey, { documentLoader, contextLoader });
    } catch (e) {
      error = e;
    }
    ok(error instanceof TypeError, id);
  }
});

// Keys of portable actors at ap: key IDs.  The actor's document lists them
// under ap: URIs, and the key ID names the gateways to fetch it from as
// @gateway location hints:
const apKeyId = parseIri(`${actorId}#main-key`);

function hinted(...gateways: string[]): URL {
  const query = gateways.map((g) => `@gateway=${encodeURIComponent(g)}`)
    .join("&");
  return parseIri(`${actorId}${query === "" ? "" : `?${query}`}#main-key`);
}

async function apActorJson(
  options: ActorOptions = {},
): Promise<Record<string, unknown>> {
  return await actorJson({ key: apKeyId, ...options });
}

test("verifyRequest() accepts keys of portable actors at ap: key IDs", async () => {
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(await apActorJson()),
  });
  const hintedKeyId = hinted(gw1);
  for (const spec of specs) {
    const key = await verifyRequest(await signedRequest(spec, hintedKeyId), {
      documentLoader,
      contextLoader,
      spec,
    });
    ok(key != null, spec);
    strictEqual(key.id?.href, hintedKeyId.href, spec);
    strictEqual(key.ownerId?.href, parseIri(actorId).href, spec);
  }
  // Whatever the scheme or the encoding of the DID in the key ID:
  const raw = `ap://${did}/actor?@gateway=${encodeURIComponent(gw1)}#main-key`;
  for (const written of [raw, raw.replace(/^ap:/, "ap+ef61:")]) {
    const request = await signedRequest(
      "draft-cavage-http-signatures-12",
      hintedKeyId,
    );
    const headers = new Headers(request.headers);
    headers.set(
      "Signature",
      headers.get("Signature")!.replace(hintedKeyId.href, written),
    );
    const key = await verifyRequest(new Request(request, { headers }), {
      documentLoader,
      contextLoader,
    });
    strictEqual(key?.ownerId?.href, parseIri(actorId).href, written);
  }
  // Only the gateways in the location hints were asked:
  deepStrictEqual(
    [...new Set(documentLoader.fetched)],
    [compatibleId(gw1)],
  );
});

test("verifyRequest() asks the document loader for ap: key IDs without hints", async () => {
  const documentLoader = createLoader({
    [actorId]: await sign(await apActorJson()),
  });
  const key = await verifyRequest(await signedRequest(undefined, apKeyId), {
    documentLoader,
    contextLoader,
  });
  strictEqual(key?.ownerId?.href, parseIri(actorId).href);
  deepStrictEqual(documentLoader.fetched, [actorId]);
  // A document loader that cannot resolve ap: URIs finds no key:
  const result = await verifyRequestDetailed(
    await signedRequest(undefined, apKeyId),
    { documentLoader: createLoader({}), contextLoader },
  );
  ok(!result.verified);
  strictEqual(result.reason.type, "keyFetchError");
});

test("verifyRequest() rejects keys at ap: key IDs that portable actors do not vouch for", async () => {
  const unsigned = await apActorJson();
  const ordinaryActorId = "https://gw1.example/users/alice";
  const cases: Record<string, Record<string, unknown>> = {
    "an unsigned actor document": unsigned,
    "an actor document signed by another DID": await sign(
      unsigned,
      otherKeyPair.privateKey,
      `${otherDid}#${otherDid.slice("did:key:".length)}`,
    ),
    "a key missing from both assertionMethod and publicKey": await sign(
      await apActorJson({ assertionMethod: false, publicKey: null }),
    ),
    "a key referred to by URL": await sign({
      ...await apActorJson({ publicKey: null, assertionMethod: false }),
      assertionMethod: [apKeyId.href],
    }),
    "a key only in publicKey without an owner": await sign(
      withoutPublicKeyOwner(await apActorJson({ assertionMethod: false })),
    ),
    "a publicKey entry with other key material": await sign(
      await apActorJson({ publicKey: rsaPublicKey3.publicKey! }),
    ),
    // A key at a compatible identifier is a gateway's, not the actor's own:
    "a key only at a compatible identifier": await sign(await actorJson()),
    "an actor without gateways": await sign(
      await apActorJson({ gateways: [] }),
    ),
    "the document of another actor": await sign(
      await apActorJson({ id: `${actorId}/other` }),
    ),
    // An ordinary actor listing the key does not speak for a portable one:
    "an ordinary actor": await actorJson({
      id: ordinaryActorId,
      key: apKeyId,
    }),
    "a standalone key": {
      "@context": "https://w3id.org/security/v1",
      id: apKeyId.href,
      type: "Key",
      owner: actorId,
      publicKeyPem: await exportSpki(gatewayPublicKey),
    },
  };
  for (const [name, document] of Object.entries(cases)) {
    const documentLoader = createLoader({ [compatibleId(gw1)]: document });
    const key = await verifyRequest(
      await signedRequest(undefined, hinted(gw1)),
      {
        documentLoader,
        contextLoader,
      },
    );
    strictEqual(key, null, name);
  }
  // A key ID without a fragment would be the actor itself:
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(await apActorJson()),
  });
  const actorKeyId = parseIri(`${actorId}?@gateway=${encodeURIComponent(gw1)}`);
  strictEqual(
    await verifyRequest(await signedRequest(undefined, actorKeyId), {
      documentLoader,
      contextLoader,
    }),
    null,
  );
  strictEqual(documentLoader.fetched.length, 0);
});

test("verifyRequest() tries the gateways of ap: key IDs in order", async () => {
  const signed = await sign(await apActorJson());
  const cases: Record<string, Record<string, unknown>> = {
    "an invalid document at the first gateway": {
      [compatibleId(gw1)]: await apActorJson(),
      [compatibleId(gw2)]: signed,
    },
    "an unreachable first gateway": { [compatibleId(gw2)]: signed },
  };
  for (const [name, responses] of Object.entries(cases)) {
    const documentLoader = createLoader(responses);
    const key = await verifyRequest(
      await signedRequest(undefined, hinted(gw1, gw2)),
      { documentLoader, contextLoader },
    );
    strictEqual(key?.ownerId?.href, parseIri(actorId).href, name);
    deepStrictEqual(
      documentLoader.fetched,
      [compatibleId(gw1), compatibleId(gw2)],
      name,
    );
  }
  // It stops at the first gateway that vouches for the key:
  const documentLoader = createLoader({
    [compatibleId(gw1)]: signed,
    [compatibleId(gw2)]: signed,
  });
  ok(
    await verifyRequest(await signedRequest(undefined, hinted(gw1, gw2)), {
      documentLoader,
      contextLoader,
    }) != null,
  );
  deepStrictEqual(documentLoader.fetched, [compatibleId(gw1)]);
  // At most three hints are followed, fewer than when dereferencing objects,
  // since whoever made the signature chose them:
  const gateways = Array.from(
    { length: 7 },
    (_, i) => `https://gw${i + 10}.example`,
  );
  const many = createLoader({});
  ok(
    !(await verifyRequestDetailed(
      await signedRequest(undefined, hinted(...gateways)),
      { documentLoader: many, contextLoader },
    )).verified,
  );
  deepStrictEqual(
    many.fetched,
    gateways.slice(0, 3).map((g) => compatibleId(g)),
  );
  // The key is accepted at the third gateway, but never at the fourth:
  for (const [index, expected] of [[2, true], [3, false]] as const) {
    const documentLoader = createLoader({
      [compatibleId(gateways[index])]: signed,
    });
    const key = await verifyRequest(
      await signedRequest(undefined, hinted(...gateways)),
      { documentLoader, contextLoader },
    );
    strictEqual(key != null, expected, `gateway ${index + 1}`);
    deepStrictEqual(
      documentLoader.fetched,
      gateways.slice(0, 3).map((g) => compatibleId(g)),
      `gateway ${index + 1}`,
    );
  }
  // Invalid and duplicate hints do not count:
  const sparse = createLoader({ [compatibleId(gateways[2])]: signed });
  ok(
    await verifyRequest(
      await signedRequest(
        undefined,
        hinted(
          "not a gateway",
          gateways[0],
          gateways[0].toUpperCase(),
          "https://gw.example/path",
          gateways[1],
          gateways[2],
        ),
      ),
      { documentLoader: sparse, contextLoader },
    ) != null,
  );
  deepStrictEqual(
    sparse.fetched,
    gateways.slice(0, 3).map((g) => compatibleId(g)),
  );
});

function failingLoader(
  responses: Record<string, unknown | number>,
): DocumentLoader & { readonly fetched: string[] } {
  // Unlike createLoader(), a number responds with that HTTP status, and
  // the responses are looked up when requested, so that they can change:
  const fetched: string[] = [];
  const loader = (url: string): Promise<RemoteDocument> => {
    fetched.push(url);
    const response = responses[url.replace(/#.*$/, "")] ?? 404;
    if (typeof response === "number") {
      return Promise.reject(
        new FetchError(
          url,
          `HTTP ${response}`,
          new Response(null, { status: response }),
        ),
      );
    }
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: structuredClone(response),
    });
  };
  return Object.assign(loader, { fetched });
}

test("verifyRequest() reports why keys at ap: key IDs could not be looked up", async () => {
  const hintedKeyId = hinted(gw1, gw2);
  const invalid = await apActorJson();
  const cases: {
    name: string;
    responses: Record<string, unknown | number>;
    reason: "invalidSignature" | "keyFetchError";
    status?: number;
    cached: boolean;
  }[] = [
    {
      name: "every gateway serves an invalid document",
      responses: { [compatibleId(gw1)]: invalid, [compatibleId(gw2)]: invalid },
      reason: "invalidSignature",
      cached: true,
    },
    {
      name: "every gateway responds with 410 Gone",
      responses: { [compatibleId(gw1)]: 410, [compatibleId(gw2)]: 410 },
      reason: "keyFetchError",
      status: 410,
      cached: true,
    },
    {
      name: "the gateways respond with different statuses",
      responses: { [compatibleId(gw1)]: 404, [compatibleId(gw2)]: 503 },
      reason: "keyFetchError",
      cached: true,
    },
    // Nothing tells what the unreachable gateway would have served:
    {
      name: "one gateway serves an invalid document, the other is gone",
      responses: { [compatibleId(gw1)]: invalid, [compatibleId(gw2)]: 410 },
      reason: "keyFetchError",
      cached: false,
    },
  ];
  for (const { name, responses, reason, status, cached } of cases) {
    for (const spec of specs) {
      const documentLoader = failingLoader(responses);
      const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
      const options = { documentLoader, contextLoader, keyCache, spec };
      for (let i = 0; i < 2; i++) {
        const result = await verifyRequestDetailed(
          await signedRequest(spec, hintedKeyId),
          options,
        );
        ok(!result.verified, `${name}, ${spec}`);
        strictEqual(result.reason.type, reason, `${name}, ${spec}`);
        if (result.reason.type === "keyFetchError") {
          strictEqual(
            "status" in result.reason.result
              ? result.reason.result.status
              : undefined,
            status,
            `${name}, ${spec}`,
          );
        }
      }
      strictEqual(
        documentLoader.fetched.length,
        cached ? 2 : 4,
        `${name}, ${spec}`,
      );
    }
  }
});

test("verifyRequest() accepts keys at ap: key IDs only for HTTP Signatures", async () => {
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(await apActorJson()),
  });
  const hintedKeyId = hinted(gw1);
  const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
  const options = { documentLoader, contextLoader, keyCache };
  // Other purposes never even fetch the key:
  for (const cls of [CryptographicKey, Multikey]) {
    const result = cls === CryptographicKey
      ? await fetchKey(hintedKeyId, CryptographicKey, options)
      : await fetchKey(hintedKeyId, Multikey, options);
    strictEqual(result.key, null);
  }
  strictEqual(documentLoader.fetched.length, 0);
  for (let i = 0; i < 3; i++) {
    const key = await verifyRequest(
      await signedRequest(undefined, hintedKeyId),
      options,
    );
    strictEqual(key?.id?.href, hintedKeyId.href);
    strictEqual(key?.ownerId?.href, parseIri(actorId).href);
  }
  strictEqual(documentLoader.fetched.length, 1);
  // The cached key is not accepted for other purposes either:
  for (const cls of [CryptographicKey, Multikey]) {
    const result = cls === CryptographicKey
      ? await fetchKey(hintedKeyId, CryptographicKey, options)
      : await fetchKey(hintedKeyId, Multikey, options);
    strictEqual(result.key, null);
  }
  const document = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    id: "https://gw1.example/activities/1",
    actor: compatibleId(gw1),
  };
  const { signature } = await signJsonLd(
    document,
    rsaPrivateKey2,
    hintedKeyId,
    { contextLoader },
  );
  ok(!await verifyJsonLd({ ...document, signature }, options));
  strictEqual(documentLoader.fetched.length, 1);
  // Nor is a key that an older version cached under the key ID:
  const legacyCache: KeyCache = {
    get: () =>
      Promise.resolve(
        new CryptographicKey({
          id: hintedKeyId,
          owner: parseIri(actorId),
          publicKey: gatewayPublicKey,
        }),
      ),
    set: () => Promise.resolve(),
  };
  const empty = createLoader({});
  strictEqual(
    await verifyRequest(await signedRequest(undefined, hintedKeyId), {
      documentLoader: empty,
      contextLoader,
      keyCache: legacyCache,
    }),
    null,
  );
  strictEqual(empty.fetched.length, 1);
});

test("verifyRequest() refreshes a cached key at an ap: key ID that fails to verify", async () => {
  for (const spec of specs) {
    const responses: Record<string, unknown | number> = {
      [compatibleId(gw1)]: await sign(await apActorJson()),
    };
    const documentLoader = failingLoader(responses);
    const hintedKeyId = hinted(gw1, gw2);
    const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
    const options = { documentLoader, contextLoader, keyCache, spec };
    ok(
      await verifyRequest(await signedRequest(spec, hintedKeyId), options) !=
        null,
    );
    strictEqual(documentLoader.fetched.length, 1, spec);
    // The actor's document changes so that nothing is determined anymore:
    responses[compatibleId(gw1)] = await apActorJson();
    responses[compatibleId(gw2)] = 503;
    const forged = await signRequest(
      new Request("https://recipient.example/inbox", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/activity+json" },
      }),
      rsaPrivateKey3,
      hintedKeyId,
      { spec },
    );
    const result = await verifyRequestDetailed(forged, options);
    ok(!result.verified, spec);
    strictEqual(documentLoader.fetched.length, 3, spec);
    // The stale key is not used anymore, and nothing was cached:
    const next = await verifyRequestDetailed(
      await signedRequest(spec, hintedKeyId),
      options,
    );
    ok(!next.verified, spec);
    strictEqual(next.reason.type, "keyFetchError", spec);
    strictEqual(documentLoader.fetched.length, 5, spec);
  }
});

test("doesActorOwnKey() and getKeyOwner() resolve keys at ap: key IDs to portable actors", async () => {
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(await apActorJson()),
  });
  const options = { documentLoader, contextLoader };
  const hintedKeyId = hinted(gw1);
  const key = new CryptographicKey({
    id: hintedKeyId,
    owner: parseIri(actorId),
    publicKey: gatewayPublicKey,
  });
  const activity = new Create({
    id: parseIri(`${actorId.replace("/actor", "")}/activities/1`),
    actor: parseIri(`ap://${did}/actor`),
  });
  ok(await doesActorOwnKey(activity, key, options));
  strictEqual(
    (await getKeyOwner(hintedKeyId, options))?.id?.href,
    parseIri(actorId).href,
  );
  strictEqual(
    (await getKeyOwner(key, options))?.id?.href,
    parseIri(actorId).href,
  );
  // Not for another actor, nor with other key material:
  ok(
    !await doesActorOwnKey(
      new Create({
        id: parseIri(`ap+ef61://${otherDid}/activities/1`),
        actor: parseIri(`ap+ef61://${otherDid}/actor`),
      }),
      key,
      options,
    ),
  );
  const other = key.clone({ publicKey: rsaPublicKey3.publicKey! });
  ok(!await doesActorOwnKey(activity, other, options));
  strictEqual(await getKeyOwner(other, options), null);
  // Nor if the actor's document does not vouch for the key, without falling
  // back to anything else:
  const unsigned = {
    documentLoader: createLoader({ [compatibleId(gw1)]: await apActorJson() }),
    contextLoader,
  };
  ok(!await doesActorOwnKey(activity, key, unsigned));
  strictEqual(await getKeyOwner(hintedKeyId, unsigned), null);
});

test("verifyRequest() does not trust a cached key at an ap: key ID for longer than its proof", async () => {
  let now = Temporal.Now.instant();
  const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"], {
    now: () => now,
  });
  const expires = now.add({ minutes: 30 });
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(
      await apActorJson(),
      ed25519PrivateKey,
      didKeyId,
      { expires: expires.toString() },
    ),
  });
  const options = { documentLoader, contextLoader, keyCache };
  const hintedKeyId = hinted(gw1);
  ok(
    await verifyRequest(await signedRequest(undefined, hintedKeyId), options) !=
      null,
  );
  now = expires.subtract({ seconds: 1 });
  ok(
    await verifyRequest(await signedRequest(undefined, hintedKeyId), options) !=
      null,
  );
  strictEqual(documentLoader.fetched.length, 1);
  now = expires;
  ok(
    await verifyRequest(await signedRequest(undefined, hintedKeyId), options) !=
      null,
  );
  strictEqual(documentLoader.fetched.length, 2);
});

test("verifyRequest() does not cache keys at ap: key IDs it could not process", async () => {
  // A context that fails to load once, e.g., because of a network error, does
  // not tell whether the actor's document vouches for the key:
  let failures = 1;
  const flakyContextLoader: DocumentLoader = (url, options) => {
    if (failures > 0) {
      failures--;
      return Promise.reject(new Error(`Temporarily failed to load ${url}`));
    }
    return contextLoader(url, options);
  };
  const documentLoader = createLoader({
    [compatibleId(gw1)]: await sign(await apActorJson()),
  });
  const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
  const options = {
    documentLoader,
    contextLoader: flakyContextLoader,
    keyCache,
  };
  const hintedKeyId = hinted(gw1);
  const result = await verifyRequestDetailed(
    await signedRequest(undefined, hintedKeyId),
    options,
  );
  ok(!result.verified);
  strictEqual(result.reason.type, "keyFetchError");
  if (result.reason.type === "keyFetchError") {
    ok(!("status" in result.reason.result));
  }
  const key = await verifyRequest(
    await signedRequest(undefined, hintedKeyId),
    options,
  );
  strictEqual(key?.ownerId?.href, parseIri(actorId).href);
  strictEqual(documentLoader.fetched.length, 2);
});

// Lookups of keys at ap: key IDs share one timeout among their gateways:

interface ControlledLoader extends DocumentLoader {
  readonly fetched: string[];
  readonly signals: (AbortSignal | undefined)[];
}

/**
 * A loader that serves the given responses, and never responds for the URLs
 * in `hanging`.  A hanging response is given up when its signal aborts,
 * unless `ignoreSignal` is set.
 */
function controlledLoader(
  responses: Record<string, unknown | number>,
  hanging: readonly string[],
  { ignoreSignal = false, delays = {} }: {
    ignoreSignal?: boolean;
    delays?: Record<string, number>;
  } = {},
): ControlledLoader {
  const fetched: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const respond = failingLoader(responses);
  const loader = async (
    url: string,
    options?: { signal?: AbortSignal },
  ): Promise<RemoteDocument> => {
    fetched.push(url);
    signals.push(options?.signal);
    const signal = ignoreSignal ? undefined : options?.signal;
    const delay = delays[url];
    if (delay != null) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (hanging.includes(url)) {
      return await new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason));
      });
    }
    return await respond(url);
  };
  return Object.assign(loader, { fetched, signals });
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

test("resolvePortableActorKey() gives up gateways that do not respond in time", async () => {
  const signed = await sign(await apActorJson());
  for (const ignoreSignal of [false, true]) {
    const documentLoader = controlledLoader(
      { [compatibleId(gw2)]: signed },
      [compatibleId(gw1)],
      { ignoreSignal },
    );
    const resolution = await resolvePortableActorKey(hinted(gw1, gw2), {
      documentLoader,
      contextLoader,
      lookupTimeout: 50,
    });
    // The first gateway used up the time, so the second one was never asked,
    // and nothing tells what it would have served:
    strictEqual(
      resolution.type,
      "unavailable",
      `ignoreSignal: ${ignoreSignal}`,
    );
    if (resolution.type === "unavailable") {
      strictEqual(resolution.cacheable, false);
    }
    deepStrictEqual(documentLoader.fetched, [compatibleId(gw1)]);
    // The loader is told that the lookup gave up:
    const [signal] = documentLoader.signals;
    ok(signal?.aborted);
    ok(isTimeoutError(signal.reason));
  }
});

test("resolvePortableActorKey() caches timeouts only as failures to fetch", async () => {
  const invalid = await apActorJson();
  const cases: {
    name: string;
    responses: Record<string, unknown | number>;
    hanging: string[];
    hints: string[];
    cacheable: boolean;
  }[] = [
    {
      name: "the only gateway times out",
      responses: {},
      hanging: [compatibleId(gw1)],
      hints: [gw1],
      cacheable: true,
    },
    {
      name: "a gateway responds with 404, and the last one times out",
      responses: { [compatibleId(gw1)]: 404 },
      hanging: [compatibleId(gw2)],
      hints: [gw1, gw2],
      cacheable: true,
    },
    {
      name: "a gateway serves an invalid document, and the last one times out",
      responses: { [compatibleId(gw1)]: invalid },
      hanging: [compatibleId(gw2)],
      hints: [gw1, gw2],
      cacheable: false,
    },
    {
      name: "the document loader cannot resolve the ap: URI in time",
      responses: {},
      hanging: [actorId],
      hints: [],
      cacheable: true,
    },
  ];
  for (const { name, responses, hanging, hints, cacheable } of cases) {
    const documentLoader = controlledLoader(responses, hanging);
    const resolution = await resolvePortableActorKey(hinted(...hints), {
      documentLoader,
      contextLoader,
      lookupTimeout: 50,
    });
    strictEqual(resolution.type, "unavailable", name);
    if (resolution.type !== "unavailable") continue;
    strictEqual(resolution.cacheable, cacheable, name);
    // A timeout has no HTTP status, so neither does the lookup as a whole:
    ok(!(resolution.error instanceof FetchError), name);
    if (hanging.length === 1 && hints.length < 2) {
      ok(isTimeoutError(resolution.error), name);
    }
  }
});

test("resolvePortableActorKey() shares one timeout among all gateways", async () => {
  // The first gateway takes most of the time before responding with
  // 404 Not Found, which leaves the second one only the rest of it; a timeout
  // for each gateway would let the lookup take 550 ms:
  const documentLoader = controlledLoader(
    { [compatibleId(gw1)]: 404 },
    [compatibleId(gw2)],
    { delays: { [compatibleId(gw1)]: 250 } },
  );
  const started = Date.now();
  const resolution = await resolvePortableActorKey(hinted(gw1, gw2), {
    documentLoader,
    contextLoader,
    lookupTimeout: 300,
  });
  const elapsed = Date.now() - started;
  ok(elapsed < 500, `took ${elapsed} ms`);
  strictEqual(resolution.type, "unavailable");
  deepStrictEqual(documentLoader.fetched, [
    compatibleId(gw1),
    compatibleId(gw2),
  ]);
  ok(documentLoader.signals[1]?.aborted);
});

test("resolvePortableActorKey() bounds loading the contexts of actor documents", async () => {
  // The actor's document is served at once, but a context it needs never is:
  const documentLoader = controlledLoader(
    { [compatibleId(gw1)]: await sign(await apActorJson()) },
    [],
  );
  const hangingContextLoader: DocumentLoader = (_url, options) =>
    new Promise((_, reject) => {
      options?.signal?.addEventListener(
        "abort",
        () => reject(options.signal!.reason),
      );
    });
  const resolution = await resolvePortableActorKey(hinted(gw1, gw2), {
    documentLoader,
    contextLoader: hangingContextLoader,
    lookupTimeout: 50,
  });
  // What the document says could not be told, which is not a rejection:
  strictEqual(resolution.type, "unavailable");
  if (resolution.type === "unavailable") {
    strictEqual(resolution.cacheable, false);
  }
  deepStrictEqual(documentLoader.fetched, [compatibleId(gw1)]);
});

test("resolvePortableActorKey() ignores what is resolved after the timeout", async () => {
  // A key cache that answers only after the lookup has returned holds up
  // verifying the document's proof without loading anything, so
  // the verification ends after the timeout:
  let verifiedLate: () => void = () => {};
  const late = new Promise<void>((resolve) => verifiedLate = resolve);
  let lookupDone: () => void = () => {};
  const done = new Promise<void>((resolve) => lookupDone = resolve);
  const slowKeyCache: KeyCache = {
    async get() {
      await done;
      return undefined;
    },
    set() {
      verifiedLate();
      return Promise.resolve();
    },
  };
  const documentLoader = controlledLoader(
    { [compatibleId(gw1)]: await sign(await apActorJson()) },
    [],
  );
  const resolution = await resolvePortableActorKey(hinted(gw1), {
    documentLoader,
    contextLoader,
    keyCache: slowKeyCache,
    lookupTimeout: 300,
  });
  lookupDone();
  strictEqual(resolution.type, "unavailable");
  if (resolution.type === "unavailable") {
    strictEqual(resolution.cacheable, false);
  }
  // The proof was verified after all, too late to count:
  await late;
  // A loader that rejects after the timeout does not leave an unhandled
  // rejection behind:
  const lateRejection = controlledLoader({}, [], {
    delays: { [compatibleId(gw1)]: 60 },
  });
  const rejected = await resolvePortableActorKey(hinted(gw1), {
    documentLoader: lateRejection,
    contextLoader,
    lookupTimeout: 20,
  });
  strictEqual(rejected.type, "unavailable");
  await new Promise((resolve) => setTimeout(resolve, 80));
});

test("resolvePortableActorKey() validates the lookup timeout", async () => {
  const documentLoader = controlledLoader({}, []);
  for (const lookupTimeout of [-1, NaN, Infinity, 2 ** 31]) {
    let error: unknown;
    try {
      await resolvePortableActorKey(hinted(gw1), {
        documentLoader,
        contextLoader,
        lookupTimeout,
      });
    } catch (e) {
      error = e;
    }
    ok(error instanceof RangeError, String(lookupTimeout));
  }
  // No time at all asks no gateway:
  const resolution = await resolvePortableActorKey(hinted(gw1), {
    documentLoader,
    contextLoader,
    lookupTimeout: 0,
  });
  strictEqual(resolution.type, "unavailable");
  if (resolution.type === "unavailable") {
    strictEqual(resolution.cacheable, false);
  }
  deepStrictEqual(documentLoader.fetched, []);
});

test("fetchKeyDetailed() caches keys at ap: key IDs that time out as fetch failures", async () => {
  const cases = [
    // Every gateway failed to serve the document, the last one in time:
    {
      responses: { [compatibleId(gw1)]: 404 },
      hanging: [compatibleId(gw2)],
      cached: true,
    },
    // The first gateway used up the time, so the second one was never asked:
    { responses: {}, hanging: [compatibleId(gw1)], cached: false },
  ];
  for (const { responses, hanging, cached } of cases) {
    const documentLoader = controlledLoader(responses, hanging);
    const keyCache = new KvKeyCache(new MemoryKvStore(), ["pk"]);
    const options: FetchKeyOptions = {
      documentLoader,
      contextLoader,
      keyCache,
      portableKeyResolvers: {
        gatewayKey: () => Promise.resolve({ type: "legacy" }),
        actorKey: (keyId) =>
          resolvePortableActorKey(keyId, {
            documentLoader,
            contextLoader,
            lookupTimeout: 50,
          }),
      },
    };
    const hintedKeyId = hinted(gw1, gw2);
    for (let i = 0; i < 2; i++) {
      const result = await fetchKeyDetailed(
        hintedKeyId,
        CryptographicKey,
        options,
      );
      strictEqual(result.key, null);
      strictEqual(result.cached, cached && i > 0, `${cached}, ${i}`);
      ok(
        result.fetchError == null || !("status" in result.fetchError),
        "a timeout has no HTTP status",
      );
    }
    strictEqual(
      documentLoader.fetched.filter((url) => url === compatibleId(gw1)).length,
      cached ? 1 : 2,
    );
  }
});

test("verifyRequestDetailed() reports keys at ap: key IDs that time out as fetch errors", async () => {
  const timeout = new DOMException("Timed out", "TimeoutError");
  const documentLoader: DocumentLoader = () => Promise.reject(timeout);
  for (const spec of specs) {
    const result = await verifyRequestDetailed(
      await signedRequest(spec, hinted(gw1)),
      { documentLoader, contextLoader, spec },
    );
    ok(!result.verified, spec);
    strictEqual(result.reason.type, "keyFetchError", spec);
    if (result.reason.type === "keyFetchError") {
      ok(!("status" in result.reason.result), spec);
    }
  }
});
