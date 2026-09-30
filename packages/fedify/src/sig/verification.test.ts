import { mockDocumentLoader, test } from "@fedify/fixture";
import { Activity, Create, CryptographicKey, Multikey } from "@fedify/vocab";
import { FetchError } from "@fedify/vocab-runtime";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { signRequest, verifyRequestDetailed } from "./http.ts";
import { signJsonLd, verifyJsonLd } from "./ld.ts";
import { signObject, verifyObject } from "./proof.ts";
import {
  type VerificationObservation,
  verificationObservation,
} from "./verification.ts";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  rsaPrivateKey2,
  rsaPublicKey1,
  rsaPublicKey2,
} from "../testing/keys.ts";

const loaders = {
  documentLoader: mockDocumentLoader,
  contextLoader: mockDocumentLoader,
};
function observation(): VerificationObservation {
  return { attempts: [] };
}

test("signature evidence preserves stale and fresh HTTP keys for both specs", async () => {
  for (const spec of ["draft-cavage-http-signatures-12", "rfc9421"] as const) {
    const evidence = observation();
    const signed = await signRequest(
      new Request("https://example.com/inbox", { method: "POST", body: "{}" }),
      rsaPrivateKey2,
      rsaPublicKey2.id!,
      { spec },
    );
    const stale = rsaPublicKey1.clone({ id: rsaPublicKey2.id });
    const result = await verifyRequestDetailed(signed, {
      ...loaders,
      [verificationObservation]: evidence,
      keyCache: {
        get: () => Promise.resolve(stale),
        set: () => Promise.resolve(),
      },
    });
    strictEqual(result.verified, true);
    const attempt = evidence.attempts[0];
    ok(attempt.status === "verified");
    strictEqual(attempt.checks.length, 1);
    const check = attempt.checks[0];
    ok(check.status === "verified");
    strictEqual(check.triedKeys.length, 2);
    strictEqual(check.triedKeys[0].publicKey, rsaPublicKey1.publicKey);
    // The freshly loaded key has the same material as key2.
    deepStrictEqual(
      await crypto.subtle.exportKey("jwk", check.triedKeys[1].publicKey),
      await crypto.subtle.exportKey("jwk", rsaPublicKey2.publicKey),
    );
    strictEqual(check.key, check.triedKeys[1]);
    strictEqual(attempt.signatures[0], check);
  }
});

test("signature evidence retains the failed key when HTTP refresh cannot load", async () => {
  for (const spec of ["draft-cavage-http-signatures-12", "rfc9421"] as const) {
    const evidence = observation();
    const signed = await signRequest(
      new Request("https://example.com/inbox", { method: "POST", body: "{}" }),
      rsaPrivateKey2,
      rsaPublicKey2.id!,
      { spec },
    );
    const response = new Response(null, { status: 410 });
    const result = await verifyRequestDetailed(signed, {
      ...loaders,
      [verificationObservation]: evidence,
      documentLoader: () =>
        Promise.reject(new FetchError(rsaPublicKey2.id!, "gone", response)),
      keyCache: {
        get: () =>
          Promise.resolve(rsaPublicKey1.clone({ id: rsaPublicKey2.id })),
        set: () => Promise.resolve(),
      },
    });
    strictEqual(result.verified, false);
    const check = evidence.attempts[0].checks[0];
    ok(check.status === "rejected");
    strictEqual(check.reason.type, "keyFetchError");
    strictEqual(check.triedKeys[0].publicKey, rsaPublicKey1.publicKey);
  }
});

test("signature evidence preserves failed LDS keys and successful stale-key refresh", async () => {
  const activity = await new Create({
    actor: new URL("https://example.com/person"),
  }).toJsonLd(loaders);
  const signed = await signJsonLd(
    activity,
    rsaPrivateKey2,
    rsaPublicKey2.id!,
    loaders,
  );
  const evidence = observation();
  // key2 has no owner, so crypto verifies but full LDS authentication rejects.
  strictEqual(
    await verifyJsonLd(signed, {
      ...loaders,
      [verificationObservation]: evidence,
      keyCache: {
        get: () =>
          Promise.resolve(rsaPublicKey1.clone({ id: rsaPublicKey2.id })),
        set: () => Promise.resolve(),
      },
    }),
    false,
  );
  const attempt = evidence.attempts[0];
  ok(attempt.status === "rejected");
  strictEqual(attempt.reason.type, "missingOwner");
  strictEqual(attempt.checks[0].status, "verified");
  strictEqual(attempt.checks[0].triedKeys.length, 2);
  const bad = observation();
  strictEqual(
    await verifyJsonLd(signed, {
      ...loaders,
      [verificationObservation]: bad,
      documentLoader: async () => ({
        contextUrl: null,
        documentUrl: rsaPublicKey2.id!.href,
        document: await new CryptographicKey({
          id: rsaPublicKey2.id,
          publicKey: rsaPublicKey1.publicKey,
        }).toJsonLd(loaders),
      }),
    }),
    false,
  );
  strictEqual(bad.attempts[0].checks[0].status, "rejected");
  strictEqual(bad.attempts[0].checks[0].triedKeys.length, 1);
});

test("signature evidence preserves multiple valid proofs despite uncovered attribution", async () => {
  const activity = new Create({ actor: new URL("https://example.com/person") });
  const first = await signObject(
    activity,
    ed25519PrivateKey,
    ed25519Multikey.id!,
    loaders,
  );
  const second = await signObject(
    first,
    ed25519PrivateKey,
    ed25519Multikey.id!,
    loaders,
  );
  const evidence = observation();
  strictEqual(
    await verifyObject(Activity, await second.toJsonLd(loaders), {
      ...loaders,
      [verificationObservation]: evidence,
    }),
    null,
  );
  const attempt = evidence.attempts[0];
  ok(attempt.status === "rejected");
  strictEqual(attempt.reason.type, "uncoveredAttribution");
  strictEqual(attempt.checks.length, 2);
  ok(attempt.checks.every((check) => check.status === "verified"));
});

test("signature evidence preserves OIP stale keys when fresh verification fails", async () => {
  const signed = await signObject(
    new Create({ actor: ed25519Multikey.controllerId }),
    ed25519PrivateKey,
    ed25519Multikey.id!,
    loaders,
  );
  const pair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const stale = new Multikey({
    id: ed25519Multikey.id,
    controller: null,
    publicKey: pair.publicKey,
  });
  const evidence = observation();
  strictEqual(
    await verifyObject(Activity, await signed.toJsonLd(loaders), {
      ...loaders,
      [verificationObservation]: evidence,
      keyCache: {
        get: () => Promise.resolve(stale),
        set: () => Promise.resolve(),
      },
      documentLoader: async () => ({
        contextUrl: null,
        documentUrl: ed25519Multikey.id!.href,
        document: await stale.toJsonLd(loaders),
      }),
    }),
    null,
  );
  const check = evidence.attempts[0].checks[0];
  strictEqual(check.status, "rejected");
  strictEqual(check.triedKeys.length, 2);
  strictEqual(check.triedKeys[0].publicKey, pair.publicKey);
});

test("OIP check preserves the literal declared key ID", async () => {
  const signed = await signObject(
    new Create({ actor: ed25519Multikey.controllerId }),
    ed25519PrivateKey,
    ed25519Multikey.id!,
    loaders,
  );
  const json = await signed.toJsonLd(loaders) as Record<string, unknown>;
  const proof = json.proof as Record<string, unknown>;
  const declaredKeyId = "https://EXAMPLE.com/person2#key4";
  proof.verificationMethod = declaredKeyId;
  const evidence = observation();
  await verifyObject(Activity, json, {
    ...loaders,
    [verificationObservation]: evidence,
  });
  strictEqual(evidence.attempts[0].checks[0].declaredKeyId, declaredKeyId);
});

test("signature observation cannot turn a cached miss into a metadata exception", async () => {
  const json = await signJsonLd(
    await new Create({ actor: new URL("https://example.com/person") }).toJsonLd(
      loaders,
    ),
    rsaPrivateKey2,
    rsaPublicKey2.id!,
    loaders,
  );
  const evidence = observation();
  const cache = {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    getFetchError: () => Promise.reject(new Error("diagnostic unavailable")),
  };
  strictEqual(
    await verifyJsonLd(json, {
      ...loaders,
      keyCache: cache,
      [verificationObservation]: evidence,
    }),
    false,
  );
  strictEqual(evidence.attempts[0].checks[0].status, "rejected");
});

test("signature observation preserves rejection for consumed fetch-error responses", async () => {
  const json = await signJsonLd(
    await new Create({ actor: new URL("https://example.com/person") }).toJsonLd(
      loaders,
    ),
    rsaPrivateKey2,
    rsaPublicKey2.id!,
    loaders,
  );
  const response = new Response("gone", { status: 410 });
  await response.text();
  const error = new FetchError(rsaPublicKey2.id!, "gone", response);
  const options = {
    ...loaders,
    documentLoader: () => Promise.reject(error),
  };
  strictEqual(await verifyJsonLd(json, options), false);
  const evidence = observation();
  strictEqual(
    await verifyJsonLd(json, {
      ...options,
      [verificationObservation]: evidence,
    }),
    false,
  );
  const check = evidence.attempts[0].checks[0];
  ok(check.status === "rejected" && check.reason.type === "keyFetchError");
  let cloneThrows = false;
  try {
    response.clone();
  } catch {
    cloneThrows = true;
  }
  if (cloneThrows) {
    ok("error" in check.reason.result);
    strictEqual(check.reason.result.error, error);
  } else {
    ok("status" in check.reason.result);
    strictEqual(check.reason.result.status, 410);
  }
});

test("OIP check retains aliased declarations without extra context fetches", async () => {
  const signed = await signObject(
    new Create({ actor: ed25519Multikey.controllerId }),
    ed25519PrivateKey,
    ed25519Multikey.id!,
    loaders,
  );
  const json = await signed.toJsonLd(loaders) as Record<string, unknown>;
  const proof = json.proof as Record<string, unknown>;
  const context = {
    vm: {
      "@id": "https://w3id.org/security#verificationMethod",
      "@type": "@id",
    },
  };
  const contextUrl = "https://example.com/custom-proof-context";
  json["@context"] = [...json["@context"] as unknown[], contextUrl];
  proof["@context"] = [...proof["@context"] as unknown[], contextUrl];
  const declaredKeyId = "https://EXAMPLE.com/person2#key4";
  proof.vm = declaredKeyId;
  delete proof.verificationMethod;
  const run = async (evidence?: VerificationObservation) => {
    let fetches = 0;
    await verifyObject(Activity, structuredClone(json), {
      ...loaders,
      contextLoader: async (url, options) => {
        fetches++;
        if (url === contextUrl) {
          return {
            contextUrl: null,
            documentUrl: url,
            document: { "@context": context },
          };
        }
        return await mockDocumentLoader(url, options);
      },
      ...(evidence == null ? {} : { [verificationObservation]: evidence }),
    });
    return fetches;
  };
  const baselineFetches = await run();
  const evidence = observation();
  strictEqual(await run(evidence), baselineFetches);
  strictEqual(evidence.attempts[0].checks[0].declaredKeyId, declaredKeyId);
});

test("OIP check preserves compact node identifiers and their aliases", async () => {
  for (const idProperty of ["id", "rawId", "scopedId"]) {
    const signed = await signObject(
      new Create({ actor: ed25519Multikey.controllerId }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
      loaders,
    );
    const json = await signed.toJsonLd(loaders) as Record<string, unknown>;
    const proof = json.proof as Record<string, unknown>;
    const context = {
      rawId: "@id",
      vm: {
        "@id": "https://w3id.org/security#verificationMethod",
        "@type": "@id",
        "@context": { scopedId: "@id" },
      },
    };
    json["@context"] = [...json["@context"] as unknown[], context];
    proof["@context"] = [...proof["@context"] as unknown[], context];
    const declaredKeyId = "https://EXAMPLE.com/person2#key4";
    if (idProperty === "scopedId") {
      proof.vm = { [idProperty]: declaredKeyId };
      delete proof.verificationMethod;
    } else {
      proof.verificationMethod = { [idProperty]: declaredKeyId };
    }
    const evidence = observation();
    await verifyObject(Activity, json, {
      ...loaders,
      [verificationObservation]: evidence,
    });
    strictEqual(evidence.attempts[0].checks[0].declaredKeyId, declaredKeyId);
  }
});

test("signature evidence excludes keys loaded before canonicalization errors", async () => {
  const signed = await signObject(
    new Create({ actor: ed25519Multikey.controllerId }),
    ed25519PrivateKey,
    ed25519Multikey.id!,
    loaders,
  );
  const json = await signed.toJsonLd(loaders) as Record<string, unknown>;
  json.extra = JSON.parse("1e400");
  const evidence = observation();
  let thrown = false;
  try {
    await verifyObject(Activity, json, {
      ...loaders,
      [verificationObservation]: evidence,
    });
  } catch {
    thrown = true;
  }
  strictEqual(thrown, true);
  const check = evidence.attempts[0].checks[0];
  strictEqual(check.status, "error");
  deepStrictEqual(check.triedKeys, []);
});
