import { CryptographicKey, Multikey } from "@fedify/vocab";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { mockDocumentLoader } from "../testing/docloader.ts";
import {
  ed25519Multikey,
  rsaPrivateKey2,
  rsaPublicKey1,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import { test } from "../testing/mod.ts";
import {
  exportJwk,
  fetchKey,
  type FetchKeyOptions,
  generateCryptoKeyPair,
  importJwk,
  type KeyCache,
  validateCryptoKey,
} from "./key.ts";

test("validateCryptoKey()", async () => {
  const pkcs1v15 = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  validateCryptoKey(pkcs1v15.privateKey, "private");
  validateCryptoKey(pkcs1v15.privateKey);
  validateCryptoKey(pkcs1v15.publicKey, "public");
  validateCryptoKey(pkcs1v15.publicKey);

  const ed25519 = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  validateCryptoKey(ed25519.privateKey, "private");
  validateCryptoKey(ed25519.privateKey);
  validateCryptoKey(ed25519.publicKey, "public");
  validateCryptoKey(ed25519.publicKey);

  assertThrows(
    () => validateCryptoKey(pkcs1v15.privateKey, "public"),
    TypeError,
    "The key is not a public key.",
  );
  assertThrows(
    () => validateCryptoKey(pkcs1v15.publicKey, "private"),
    TypeError,
    "The key is not a private key.",
  );
  assertThrows(
    () => validateCryptoKey(ed25519.privateKey, "public"),
    TypeError,
    "The key is not a public key.",
  );
  assertThrows(
    () => validateCryptoKey(ed25519.publicKey, "private"),
    TypeError,
    "The key is not a private key.",
  );

  const ecdsa = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["sign", "verify"],
  );
  assertThrows(
    () => validateCryptoKey(ecdsa.publicKey),
    TypeError,
    "only RSASSA-PKCS1-v1_5 and Ed25519",
  );

  const pkcs1v15Sha512 = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-512",
    },
    true,
    ["sign", "verify"],
  );
  assertThrows(
    () => validateCryptoKey(pkcs1v15Sha512.privateKey),
    TypeError,
    "hash algorithm for RSASSA-PKCS1-v1_5 keys must be SHA-256",
  );
});

test("generateCryptoKeyPair()", async () => {
  const rsaKeyPair = await generateCryptoKeyPair();
  assertEquals(
    rsaKeyPair.privateKey.algorithm as unknown,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: {
        name: "SHA-256",
      },
      modulusLength: 4096,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    },
  );
  validateCryptoKey(rsaKeyPair.privateKey, "private");
  validateCryptoKey(rsaKeyPair.publicKey, "public");

  const rsaKeyPair2 = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
  assertEquals(
    rsaKeyPair2.privateKey.algorithm as unknown,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: {
        name: "SHA-256",
      },
      modulusLength: 4096,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    },
  );
  validateCryptoKey(rsaKeyPair2.privateKey, "private");
  validateCryptoKey(rsaKeyPair2.publicKey, "public");

  const ed25519KeyPair = await generateCryptoKeyPair("Ed25519");
  assertEquals(ed25519KeyPair.privateKey.algorithm, { name: "Ed25519" });
  validateCryptoKey(ed25519KeyPair.privateKey, "private");
  validateCryptoKey(ed25519KeyPair.publicKey, "public");
});

const rsaPublicJwk: JsonWebKey = {
  alg: "RS256",
  kty: "RSA",
  // cSpell: disable
  e: "AQAB",
  n: "oRmBtnxbdFutoRd1GLGwwGTrsqlRRWUe11hHQaoRLGf5LwQ0tIc6I9q-dynliw-2kxYsL" +
    "n9SH2je6HcTYOolgW7F_cOWXZQN04b-OiYcU1ConAhLjmn4k1uKawJ614y0ScPNd8PQ-Cl" +
    "jsnlPxbq9ofaCMe2BV3B6y09aCuGFJ0nxn1_ubjmIBIWWFTAznoz1J9BhJDGyt3IO3ABy3" +
    "f9zDVlR32L_n5VIkXnxkjUKdzMAOzYb62kuKOp1iznRTPrV71SNtivJMwSh_LVgBrmZjtI" +
    "n_oim-KyX_fdLU3tQ7VClyqmJzyAjccOH6Qj6nFTPh-vX07gqN8IlLT2uye4waw",
  // cSpell: enable
  key_ops: ["verify"],
  ext: true,
};

const rsaPrivateJwk: JsonWebKey = {
  alg: "RS256",
  kty: "RSA",
  // cSpell: disable
  d: "f-Pa2L7Sb4YUSa1wlSEC-0li35uQ3DFRkY0QTG2xYnpMFGoXWTV9D1epGrqU8pePzias" +
    "_mCvFiZPx2Y4aRiYm68P2Mu7hCBz9XfWPN1iYTXIFM51BOLVpk3mjdsTICkgOusJI0m9j" +
    "DR3ZAjwLj14K6qhYvd0VbECmoItLjQoW64Sc9iDgD3CvGoTqv71oTfW70cy-Ve1xQ9CTh" +
    "AmMOTKe6rYCUTA8tMZcPszifZ4iOasOjgvRxyel86LqGNtyslY8k86gQlMtFpR3VeZV_8" +
    "otAWZn0mDc4vVU8HUO-DzYiIFdAcVxfPJh6tx7snCTsdzze_98OEAK4EWYBn7vsGFeQ",
  dp: "lrXReSkZQXSmSxQ1TimV5kMt96gSu4_r-OGIabVmoG5irhjMyN08Jjc3qK9oZS3uNM-Lx" +
    "AOg4OdzefjsF9IMfZJl6wuLd85g_l4BHSaEk5zC8l3QugX1IU9XZ7wDxXUrutMoNtZXDt" +
    "dbveAMtHNZlIu-qmEBDWzkqJiz2WpW-AE",
  dq: "TCLoYcX0ywuNA9DSU6v94KmBh1e_IELEFVbJb5vvLKlAK-ycMK0rfzC1co9Hhkski1Lsk" +
    "TnxnoqwZ5oF-7X10eZvy3Te_FHSl0IsTar8ST2-MRtGh2UjTdvP_nnygj4GcXvKfngjPE" +
    "fthDzVfVMeR38oDhDxMFD5AaY_v9aMH_U",
  e: "AQAB",
  n: "oRmBtnxbdFutoRd1GLGwwGTrsqlRRWUe11hHQaoRLGf5LwQ0tIc6I9q-dynliw-2kxYs" +
    "Ln9SH2je6HcTYOolgW7F_cOWXZQN04b-OiYcU1ConAhLjmn4k1uKawJ614y0ScPNd8PQ-" +
    "CljsnlPxbq9ofaCMe2BV3B6y09aCuGFJ0nxn1_ubjmIBIWWFTAznoz1J9BhJDGyt3IO3A" +
    "By3f9zDVlR32L_n5VIkXnxkjUKdzMAOzYb62kuKOp1iznRTPrV71SNtivJMwSh_LVgBrm" +
    "ZjtIn_oim-KyX_fdLU3tQ7VClyqmJzyAjccOH6Qj6nFTPh-vX07gqN8IlLT2uye4waw",
  p: "xuDd7tE_47NWwvDTpB403X13EPA3768MlNpl_v_BGiuP-1uvWUnsOVZB0F3HXSVg1sBV" +
    "Ntec46v7OU0P693gvYUhouTmSQpayY_VFqMklprWgs7cfneqbeDzv3C4Fw5waY-vjoIND" +
    "sE1jYELUnl5cVjXXyxuGFG-IaLJKmHmHX0",
  q: "z17X2t9zO6WcMp6W04gXdKmniJlxekOrOmWnrX9AwaM8NYCLN3y23r59nqNP9aUAWG1eo" +
    "GFmav2rYQitWhz_VsEu2pQUsfsYKZYHchu5p_jCYwuM3rIg7aCbhtGv_tBoWAf1NvKMhtp" +
    "2es0ZaHZCzKDGSOkIYDOB-ZDmNigWigc",
  qi: "KC6gWhVM_x7iQgl-gEoSh_iM1Jf314ZLJKAAz1DsTHMi5yuCkCMmmY7h6jlkAJVngK3KI" +
    "f5LPoAeUoGJ26E1kocbRU_nZBftMDVXHCYICz8qMQXR5euN_5SeJnu_VWXH-CY83MKhPY" +
    "AorWSZ1-G9gh-C16LlRMzJwoE6h5QNeNo",
  // cSpell: enable
  key_ops: ["sign"],
  ext: true,
};

test("exportJwk()", async () => {
  assertEquals(await exportJwk(rsaPrivateKey2), rsaPrivateJwk);
  assertEquals(await exportJwk(rsaPublicKey2.publicKey!), rsaPublicJwk);
});

test("importJwk()", async () => {
  assertEquals(await importJwk(rsaPrivateJwk, "private"), rsaPrivateKey2);
  assertEquals(
    await importJwk(rsaPublicJwk, "public"),
    rsaPublicKey2.publicKey!,
  );
  assertRejects(() => importJwk(rsaPublicJwk, "private"));
  assertRejects(() => importJwk(rsaPrivateJwk, "public"));
});

test("fetchKey()", async () => {
  const cache: Record<string, CryptographicKey | Multikey | null> = {};
  const options: FetchKeyOptions = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    keyCache: {
      get(keyId) {
        return Promise.resolve(cache[keyId.href]);
      },
      set(keyId, key) {
        cache[keyId.href] = key;
        return Promise.resolve();
      },
    } satisfies KeyCache,
  };
  assertEquals(
    await fetchKey("https://example.com/nothing", CryptographicKey, options),
    { key: null, cached: false },
  );
  assertEquals(cache, { "https://example.com/nothing": null });
  assertEquals(
    await fetchKey("https://example.com/nothing", CryptographicKey, options),
    { key: null, cached: true },
  );
  assertEquals(cache, { "https://example.com/nothing": null });
  assertEquals(
    await fetchKey("https://example.com/object", CryptographicKey, options),
    { key: null, cached: false },
  );
  assertEquals(cache, {
    "https://example.com/nothing": null,
    "https://example.com/object": null,
  });
  assertEquals(
    await fetchKey("https://example.com/key", CryptographicKey, options),
    { key: rsaPublicKey1, cached: false },
  );
  assertEquals(cache, {
    "https://example.com/nothing": null,
    "https://example.com/object": null,
    "https://example.com/key": rsaPublicKey1,
  });
  assertEquals(
    await fetchKey("https://example.com/key", CryptographicKey, options),
    { key: rsaPublicKey1, cached: true },
  );
  assertEquals(cache, {
    "https://example.com/nothing": null,
    "https://example.com/object": null,
    "https://example.com/key": rsaPublicKey1,
  });
  assertEquals(
    await fetchKey(
      "https://example.com/person#no-key",
      CryptographicKey,
      options,
    ),
    { key: null, cached: false },
  );
  assertEquals(cache, {
    "https://example.com/nothing": null,
    "https://example.com/object": null,
    "https://example.com/key": rsaPublicKey1,
    "https://example.com/person#no-key": null,
  });
  assertEquals(
    await fetchKey(
      "https://example.com/person2#key3",
      CryptographicKey,
      options,
    ),
    { key: rsaPublicKey3, cached: false },
  );
  assertEquals(cache, {
    "https://example.com/nothing": null,
    "https://example.com/object": null,
    "https://example.com/key": rsaPublicKey1,
    "https://example.com/person#no-key": null,
    "https://example.com/person2#key3": rsaPublicKey3,
  });
  assertEquals(
    await fetchKey(
      "https://example.com/person2#key3",
      CryptographicKey,
      options,
    ),
    { key: rsaPublicKey3, cached: true },
  );
  assertEquals(cache, {
    "https://example.com/nothing": null,
    "https://example.com/object": null,
    "https://example.com/key": rsaPublicKey1,
    "https://example.com/person#no-key": null,
    "https://example.com/person2#key3": rsaPublicKey3,
  });
  assertEquals(
    await fetchKey(
      "https://example.com/person2#key4",
      Multikey,
      options,
    ),
    { key: ed25519Multikey, cached: false },
  );
  assertEquals(cache, {
    "https://example.com/nothing": null,
    "https://example.com/object": null,
    "https://example.com/key": rsaPublicKey1,
    "https://example.com/person#no-key": null,
    "https://example.com/person2#key3": rsaPublicKey3,
    "https://example.com/person2#key4": ed25519Multikey,
  });
  assertEquals(
    await fetchKey(
      "https://example.com/person2#key4",
      Multikey,
      options,
    ),
    { key: ed25519Multikey, cached: true },
  );
  assertEquals(
    await fetchKey("https://example.com/key", CryptographicKey, {
      ...options,
      keyCache: undefined,
    }),
    { key: rsaPublicKey1, cached: false },
  );
  // Discard a fragment if no key is found
  assertEquals(
    await fetchKey(
      "https://example.com/users/handle",
      CryptographicKey,
      options,
    ),
    {
      key: new CryptographicKey({
        id: new URL("https://example.com/users/handle#main-key"),
        publicKey: await importJwk({
          kty: "RSA",
          alg: "RS256",
          // cSpell: disable
          n: "oRmBtnxbdFutoRd1GLGwwGTrsqlRRWUe11hHQaoRLGf5LwQ0tIc6I9q-dynliw-2kxYsLn9SH2je6HcTYOolgW7F_cOWXZQN04b-OiYcU1ConAhLjmn4k1uKawJ614y0ScPNd8PQ-CljsnlPxbq9ofaCMe2BV3B6y09aCuGFJ0nxn1_ubjmIBIWWFTAznoz1J9BhJDGyt3IO3ABy3f9zDVlR32L_n5VIkXnxkjUKdzMAOzYb62kuKOp1iznRTPrV71SNtivJMwSh_LVgBrmZjtIn_oim-KyX_fdLU3tQ7VClyqmJzyAjccOH6Qj6nFTPh-vX07gqN8IlLT2uye4waw",
          e: "AQAB",
          // cSpell: enable
          key_ops: ["verify"],
          ext: true,
        }, "public"),
      }) as CryptographicKey & {
        publicKey: CryptoKey;
      },
      cached: false,
    },
  );
});
