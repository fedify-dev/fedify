---
links:
  '#906': https://github.com/fedify-dev/fedify/issues/906
---
 -  Added support for Ed25519 keys when signing requests with HTTP Message
    Signatures (RFC 9421).  `signRequest()` now accepts an Ed25519 private
    key with `spec: "rfc9421"` and marks the signature with the `ed25519`
    algorithm, and an `Accept-Signature` challenge that asks for `ed25519` can
    now be fulfilled when the request is signed with an Ed25519 key.
    Previously, Fedify could verify Ed25519 signatures but could produce only
    `rsa-v1_5-sha256` ones.  Outgoing activities are still signed with an
    RSA-PKCS#1-v1.5 key pair, because the draft cavage HTTP Signatures that
    Fedify falls back to support only that key type, and a request signed with
    an Ed25519 key is not retried with them.  [[#906] by Jae-Hyuk-Jang]
