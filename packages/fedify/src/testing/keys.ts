import { CryptographicKey, Multikey } from "@fedify/vocab";
import { importSpki } from "@fedify/vocab-runtime";

export const rsaPublicKey1 = new CryptographicKey({
  id: new URL("https://example.com/key"),
  owner: new URL("https://example.com/person"),
  publicKey: await crypto.subtle.importKey(
    "jwk",
    {
      kty: "RSA",
      alg: "RS256",
      // cSpell: disable
      n: "yIB9rotX8G6r6_6toT-x24BUiQ_HaPH1Em9dOt4c94s-OPFoEdH7DY7Iym9A8Ll" +
        "H4JaGF8KD38bLHWe1S4x0jV3gHJKhK7veJfGZCKUENcQecBZ-YWUs5HWvUIX1vVB" +
        "__0luHrg6BQKGOrSOE-WIAxyr0qsWCFfZzQrvSnUD2yvg1arJX2xhms14uxoRd5K" +
        "g9efKSCmmQaNEapicARUmFWrIEpGFa_nUUnqimssAGw1eZFqf3wA4TjhsuARBhGa" +
        "Jtv_3KEa016eMZxy3kDlOjZnXZTaTgWkXdodwUvy8563fes3Al6BlcS2iJ9qbtha" +
        "8rSm0FHqoUKH73JsLPKQIwQ",
      e: "AQAB",
      // cSpell: enable
      key_ops: ["verify"],
      ext: true,
    },
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    true,
    ["verify"],
  ),
}) as CryptographicKey & { publicKey: CryptoKey };

export const rsaPrivateKey2: CryptoKey = await crypto.subtle.importKey(
  "jwk",
  {
    kty: "RSA",
    alg: "RS256",
    // cSpell: disable
    n: "oRmBtnxbdFutoRd1GLGwwGTrsqlRRWUe11hHQaoRLGf5LwQ0tIc6I9q-dynliw-2kxY" +
      "sLn9SH2je6HcTYOolgW7F_cOWXZQN04b-OiYcU1ConAhLjmn4k1uKawJ614y0ScPNd8P" +
      "Q-CljsnlPxbq9ofaCMe2BV3B6y09aCuGFJ0nxn1_ubjmIBIWWFTAznoz1J9BhJDGyt3I" +
      "O3ABy3f9zDVlR32L_n5VIkXnxkjUKdzMAOzYb62kuKOp1iznRTPrV71SNtivJMwSh_LV" +
      "gBrmZjtIn_oim-KyX_fdLU3tQ7VClyqmJzyAjccOH6Qj6nFTPh-vX07gqN8IlLT2uye4" +
      "waw",
    e: "AQAB",
    d: "f-Pa2L7Sb4YUSa1wlSEC-0li35uQ3DFRkY0QTG2xYnpMFGoXWTV9D1epGrqU8pePzia" +
      "s_mCvFiZPx2Y4aRiYm68P2Mu7hCBz9XfWPN1iYTXIFM51BOLVpk3mjdsTICkgOusJI0m" +
      "9jDR3ZAjwLj14K6qhYvd0VbECmoItLjQoW64Sc9iDgD3CvGoTqv71oTfW70cy-Ve1xQ9" +
      "CThAmMOTKe6rYCUTA8tMZcPszifZ4iOasOjgvRxyel86LqGNtyslY8k86gQlMtFpR3Ve" +
      "ZV_8otAWZn0mDc4vVU8HUO-DzYiIFdAcVxfPJh6tx7snCTsdzze_98OEAK4EWYBn7vsG" +
      "FeQ",
    p: "xuDd7tE_47NWwvDTpB403X13EPA3768MlNpl_v_BGiuP-1uvWUnsOVZB0F3HXSVg1sB" +
      "VNtec46v7OU0P693gvYUhouTmSQpayY_VFqMklprWgs7cfneqbeDzv3C4Fw5waY-vjoI" +
      "NDsE1jYELUnl5cVjXXyxuGFG-IaLJKmHmHX0",
    q: "z17X2t9zO6WcMp6W04gXdKmniJlxekOrOmWnrX9AwaM8NYCLN3y23r59nqNP9aUAWG1" +
      "eoGFmav2rYQitWhz_VsEu2pQUsfsYKZYHchu5p_jCYwuM3rIg7aCbhtGv_tBoWAf1NvK" +
      "Mhtp2es0ZaHZCzKDGSOkIYDOB-ZDmNigWigc",
    dp: "lrXReSkZQXSmSxQ1TimV5kMt96gSu4_r-OGIabVmoG5irhjMyN08Jjc3qK9oZS3uNM-L" +
      "xAOg4OdzefjsF9IMfZJl6wuLd85g_l4BHSaEk5zC8l3QugX1IU9XZ7wDxXUrutMoNtZX" +
      "DtdbveAMtHNZlIu-qmEBDWzkqJiz2WpW-AE",
    dq: "TCLoYcX0ywuNA9DSU6v94KmBh1e_IELEFVbJb5vvLKlAK-ycMK0rfzC1co9Hhkski1Ls" +
      "kTnxnoqwZ5oF-7X10eZvy3Te_FHSl0IsTar8ST2-MRtGh2UjTdvP_nnygj4GcXvKfngj" +
      "PEfthDzVfVMeR38oDhDxMFD5AaY_v9aMH_U",
    qi: "KC6gWhVM_x7iQgl-gEoSh_iM1Jf314ZLJKAAz1DsTHMi5yuCkCMmmY7h6jlkAJVngK3K" +
      "If5LPoAeUoGJ26E1kocbRU_nZBftMDVXHCYICz8qMQXR5euN_5SeJnu_VWXH-CY83MKh" +
      "PYAorWSZ1-G9gh-C16LlRMzJwoE6h5QNeNo",
    // cSpell: enable
    "key_ops": ["sign"],
    "ext": true,
  },
  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  true,
  ["sign"],
);

export const rsaPublicKey2 = new CryptographicKey({
  id: new URL("https://example.com/key2"),
  publicKey: await crypto.subtle.importKey(
    "jwk",
    {
      kty: "RSA",
      alg: "RS256",
      // cSpell: disable
      n: "oRmBtnxbdFutoRd1GLGwwGTrsqlRRWUe11hHQaoRLGf5LwQ0tIc6I9q-dynliw-" +
        "2kxYsLn9SH2je6HcTYOolgW7F_cOWXZQN04b-OiYcU1ConAhLjmn4k1uKawJ614y" +
        "0ScPNd8PQ-CljsnlPxbq9ofaCMe2BV3B6y09aCuGFJ0nxn1_ubjmIBIWWFTAznoz" +
        "1J9BhJDGyt3IO3ABy3f9zDVlR32L_n5VIkXnxkjUKdzMAOzYb62kuKOp1iznRTPr" +
        "V71SNtivJMwSh_LVgBrmZjtIn_oim-KyX_fdLU3tQ7VClyqmJzyAjccOH6Qj6nFT" +
        "Ph-vX07gqN8IlLT2uye4waw",
      e: "AQAB",
      // cSpell: enable
      key_ops: ["verify"],
      ext: true,
    },
    { "name": "RSASSA-PKCS1-v1_5", "hash": "SHA-256" },
    true,
    ["verify"],
  ),
}) as CryptographicKey & { publicKey: CryptoKey };

export const rsaPrivateKey3: CryptoKey = await crypto.subtle.importKey(
  "jwk",
  {
    kty: "RSA",
    alg: "RS256",
    // cSpell: disable
    n: "4GUqWgdiYlN3Su5Gr4l6i-xRS8gDDVKZ718vpGk6eIpvqs33q430nRbHIzbHRXRaAhc_" +
      "1--rUBcK0V4_kjZlCSzVtRgGU6HMkmjcD-uE56a8XbTczfltbEDj7afoEuB2F3UhQEWrS" +
      "z-QJ29DPXaLMIa1Yv61NR2vxGqNbdtoMjDORMBYtg77CYbcFkiJHw65PDa7-f_yjLxuCR" +
      "Pye5L7hncN0UZuuFoRJmHNRLSg5omBad9WTvQXmSyXEhEdk9fHwlI022AqAzlWbT79hld" +
      "cDSKGGLLbQIs1c3JZIG8G5i6Uh5Vy0Z7tSNBcxbhqoI9i9je4f_x_OPIVc19f04BE1LgW" +
      "uHsftZzRgW9Sdqz53W83XxVdxlyHeywXOnstSWT11f8dkLyQUcHKTH-E6urbH-aiPLiRp" +
      "YK8W7D9KTQA9kZ5JXaEuveBd5vJX7wakhbzAn8pWJU7GYIHNY38YcokmivkU5pY8S2cKF" +
      "MwY0b7ade3MComlir5P3ZYSjF-n6gRVsT96P-9mNfCu9gXt_f8XCyjKlH89kGwuJ7HhR8" +
      "CuVdm0l-jYozVt6GsDy0hHYyn79NCCAEzP7ZbhBMR0T5Vrkl-TIGXoJH9WFiz4VxO-Nng" +
      "lF6dNQjDS5IzYLoFRXIK1f3cmQiEB4FZmL70l9HLrgwR-Xys83xia79OqFDRezM",
    e: "AQAB",
    d: "HJ_LD0Dx4-kRxpUunyXCZCb5F9mjygdHa6mQwkBKHSZLqFYtycyJ76AANxW9xbZZ5Ppi" +
      "QoFoMQc_cgW7xkL6EHmPqVIvPGvfVK3bpIw-n-49CRcRM5UlyDFe4eoRSJcpeUSPwUsh1" +
      "q99DAq9YRHGH6KPcNlc9DGdQkj1UZYzbHOdXFfM-SxgCY8SdCU8mKGgL3Yr9HAZ2KoQv0" +
      "e0Ht9ZBoYZVSDO7uVOWr8PGDySadYQlBjRQbERcZCmlL9qLnnQGZGy_Gj_8vlVdQob_Q8" +
      "XxvUode4a2djoMJndlK2VC7fVapY910-WpTsvGmmz8FdaIF5rQqhK8lCvO9BmwOwT23Ga" +
      "DVs0iMpFrVqQ6c0ZwD5Q-c39U8HE3-mlSyyz5kdsa1OdcJ64JSJH7Xl_vwLRgFgO7pPQh" +
      "Pm1N1XkDUgZOHAE6Hg-PEM3QdXSWnj2_znildsdUagf-1RsWVouVBSDNjUk5MQFPERW4w" +
      "H2ersndnkvYe7FeU_HfkIi2A9xBr7Ti4O-MPU0sl_HdZ9PXGhzSMpMTB9NSeMpi9gd1ZZ" +
      "KmAe_t3mj1x6m2qXBv-Z05Gifae82YcaghuqkZ6QCxlpNxwbeZjb0vmMVqsds_qLQ4eg9" +
      "Ww-R-8AlWm5HGCOrdJk4JnHZ5HzrFtwCj55cuutd6gHAq3Q1cbaKVO8rM_Ve5cE",
    p: "8P4sJeDvEDJFMxARDuzmztlwdPtGfmHBvtzDFCm5UbL1w8Ga3mSv7uQMDMuc9vBqAq2J" +
      "d9d4MDwlXtUrk8Q9weuwgGWKLFrsmdgwH6-shNrHzar1Tojf9Fgi-t-Tr_PQwKnyioaKQ" +
      "htPNCbishGRt0GJuLq5ag0RPPtHXIX8Ch-00ppL1yW3wFpPBBiOV7yPLEhwowa33yPYEl" +
      "TsASNiDKKtS4c_EyzdRWuJjtMZmEPPWfXvrOQSqXR6KY71tOOuo1S7ZkSZibcf88IILSm" +
      "aAdzidgkZWlazjBBmNo54KaT6j6x5EMSr6EyafW8tBU-bCLVs__Hap_kSYsQw95l8Fw",
    q: "7l5l9KqwDE0uBPKlXzpdg6rZ1dDuInnx0QTp_XUj8GRaeVCP1JfLJoa38-lN39AoAGUv" +
      "ndiHpnXkKKbKizcR5WY-6LAUFkAcXit7NP4fHPDLyiOZvTblZEryCbDS6jJrF5ii7rBXc" +
      "C8LziZEBce-I7W9CZHUwOXfDAJNeslqDVZ9tlFXezjXZnqiBo3eq0hWQxO7CweZv0qE4G" +
      "xMjs0E6IndQk8SAXA5RRbyoFzfChOyRtKOf9gxXOhwTKcKqWkjhK3xdpwcmHDpWycRShu" +
      "r-hazt6yBCUbJ402nIxQRfOwdRIgfRO2K5-O54RzF7UkzHX3zeQdZIuzLeXGgu13fRQ",
    dp:
      "qeITTxR0kg9N9sQRslrQDer8OorT082n3ZsULceH6w7j7v4w5StHVnkOAYsbeHxbzs10h" +
      "bWv9RjBI0vUb1M8UdKK1sg9kiz6cy0SJ5QYYoMzrEkiqh0U-tOSvRUUsEmI0_g5kOts1V" +
      "MZD2OGFQ8LkIqzwjRm9lqF114vnQqadKyLNJcudVkSYpeG8hU5aqHyr73VISdgQP2smKe" +
      "iwt6lhNC8puyNS0AqL4CyNKuddFgA-KLFNTSF70y7vUYY8U47UsotXNdpAMrFzHjweJ3G" +
      "AiAqyBh79dH-ufLpivX9wSWat-NWaLqrkJNHqLrRmtfWK1pxny9n-1c6XcN93V0mOw",
    dq:
      "n_-xA_eGT9uGZj_RDQiKOJT3vvOMxIuB60EXJs_4HaXerMuMn7B75hJLa2dQpEh-cTV6L" +
      "sNm2i8LxNWf4q5GTurAk0ONWBoUcIlTHBDvJWfkAny-9yjf9N_xctvD1vucsqv7waeQKX" +
      "cKv4cj5ZVbZXDZwJCodApYGyF4jFCh5O4HV9dllwpiWyE5nJihu-rELCYUSKUDaElGw7U" +
      "t9jRbdRME9ztH5LtFVcC_fzCXbZYm9i7jA6FEEQ7cQjdliq1N8AMprum-r_wqRssEafAF" +
      "EcsnOsSJoIZpgS9gXsVbr7R1OMj95DBmKpzK6fV8TXfy3XrrcHOkOzMiqRPCRcIO2Q",
    qi: "LhkzXD7HOowopZpKmEklXoAZlZV-tPqZm9m_0fkh-dXoFaHfIj-eXUr-7Z8yJWx4-nn" +
      "GITZR28Q10QHvnG5phqhvgUJ2nHixqaphXfYt80nictRfVcRW4bN_oHm-87zK0BS5OjJv" +
      "LoMYKSREvdz1UqVJxA4jKsYURCIj6KSDJyZsd5ENAQWjxs0jEw73sKPT-J-ePCEz05V-e" +
      "uBp6RBSePnu3rphrtZ54MNnShyqhoimnymNqx7iXTFBdIP2OKRmzSyKMpwBLU54tctXIO" +
      "lv_l89gN7V6F8_I0q359M9tdGmmqxjIzAKm9USP7jfcoejXXt3lpSglwKpEfQBfFF9yg",
    // cSpell: enable
    key_ops: ["sign"],
    ext: true,
  },
  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  true,
  ["sign"],
);

export const rsaPublicKey3 = new CryptographicKey({
  id: new URL("https://example.com/person2#key3"),
  owner: new URL("https://example.com/person2"),
  publicKey: await crypto.subtle.importKey(
    "jwk",
    {
      kty: "RSA",
      alg: "RS256",
      // cSpell: disable
      n: "4GUqWgdiYlN3Su5Gr4l6i-xRS8gDDVKZ718vpGk6eIpvqs33q430nRbHIzbHRXRaAh" +
        "c_1--rUBcK0V4_kjZlCSzVtRgGU6HMkmjcD-uE56a8XbTczfltbEDj7afoEuB2F3UhQ" +
        "EWrSz-QJ29DPXaLMIa1Yv61NR2vxGqNbdtoMjDORMBYtg77CYbcFkiJHw65PDa7-f_y" +
        "jLxuCRPye5L7hncN0UZuuFoRJmHNRLSg5omBad9WTvQXmSyXEhEdk9fHwlI022AqAzl" +
        "WbT79hldcDSKGGLLbQIs1c3JZIG8G5i6Uh5Vy0Z7tSNBcxbhqoI9i9je4f_x_OPIVc1" +
        "9f04BE1LgWuHsftZzRgW9Sdqz53W83XxVdxlyHeywXOnstSWT11f8dkLyQUcHKTH-E6" +
        "urbH-aiPLiRpYK8W7D9KTQA9kZ5JXaEuveBd5vJX7wakhbzAn8pWJU7GYIHNY38Ycok" +
        "mivkU5pY8S2cKFMwY0b7ade3MComlir5P3ZYSjF-n6gRVsT96P-9mNfCu9gXt_f8XCy" +
        "jKlH89kGwuJ7HhR8CuVdm0l-jYozVt6GsDy0hHYyn79NCCAEzP7ZbhBMR0T5Vrkl-TI" +
        "GXoJH9WFiz4VxO-NnglF6dNQjDS5IzYLoFRXIK1f3cmQiEB4FZmL70l9HLrgwR-Xys8" +
        "3xia79OqFDRezM",
      e: "AQAB",
      // cSpell: enable
      key_ops: ["verify"],
      ext: true,
    },
    { "name": "RSASSA-PKCS1-v1_5", "hash": "SHA-256" },
    true,
    ["verify"],
  ),
}) as CryptographicKey & { publicKey: CryptoKey };

export const rsaMultikey4 = new Multikey({
  id: new URL("https://example.com/person2#key3"),
  controller: new URL("https://example.com/person2"),
  publicKey: rsaPublicKey3.publicKey,
}) as Multikey & { publicKey: CryptoKey };

export const rsaPublicKey5 = new CryptographicKey({
  id: new URL("https://remote.domain/users/bob#main-key"),
  owner: new URL("https://remote.domain/users/bob"),
  publicKey: await importSpki(
    // cSpell: disable
    "-----BEGIN PUBLIC KEY-----\n" +
      "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqIAYvNFGbZ5g4iiK6feS\n" +
      "dXD4bDStFM58A7tHycYXaYtzZQpIeHXAmaXuZzXIwtrP4N0gIk8JNwZvXj2UPS+S\n" +
      "07t0V9wNK94he01LV5EMz/GN4eNnFmDL64HIEuKLvV8TvgjbUPRD6Y5X0UpKi2ZI\n" +
      "FLSb96Q5w0Z/k7ntpVKV52y8kz5Fjr/O/0JuHryZe0yItzJh8kzFfeMf0EXzfSna\n" +
      "KvT7P9jhgC6uTre+jXyvVZjiHDrnqvvucdI3I7DRfXo1OqARBrLjy+TdseUAjNYJ\n" +
      "+OuPRI1URIWQI01DCHqcohVu9+Ar+BiCjFp3ua+XMuJvrvbD61d1Fvig/9nbBRR+\n" +
      "8QIDAQAB\n" +
      "-----END PUBLIC KEY-----\n",
    // cSpell: enable
  ),
}) as CryptographicKey & { publicKey: CryptoKey };

export const ed25519PrivateKey: CryptoKey = await crypto.subtle.importKey(
  "jwk",
  {
    crv: "Ed25519",
    ext: true,
    key_ops: ["sign"],
    kty: "OKP",
    // cSpell: disable
    d: "LledL195fP9TQGQrkE2l2Y2k48UvqCzYI9M1zXyh7zQ",
    x: "LR8epAGDe-cVq5p2Tx49CCfphpk1rNhkNoY9i-XEUfg",
    // cSpell: enable
  },
  "Ed25519",
  true,
  ["sign"],
);

export const ed25519PublicKey = new CryptographicKey({
  id: new URL("https://example.com/person2#key4"),
  owner: new URL("https://example.com/person2"),
  publicKey: await crypto.subtle.importKey(
    "jwk",
    {
      crv: "Ed25519",
      ext: true,
      key_ops: ["verify"],
      kty: "OKP",
      // cSpell: disable
      x: "LR8epAGDe-cVq5p2Tx49CCfphpk1rNhkNoY9i-XEUfg",
      // cSpell: enable
    },
    "Ed25519",
    true,
    ["verify"],
  ),
}) as CryptographicKey & { publicKey: CryptoKey };

export const ed25519Multikey = new Multikey({
  id: new URL("https://example.com/person2#key4"),
  controller: new URL("https://example.com/person2"),
  publicKey: ed25519PublicKey.publicKey,
}) as Multikey & { publicKey: CryptoKey };
