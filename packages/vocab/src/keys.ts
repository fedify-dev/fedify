import { CryptographicKey } from "./vocab.ts";

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

export const rsaPublicKey = new CryptographicKey({
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
