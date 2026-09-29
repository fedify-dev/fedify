---
links:
  '#1108': https://github.com/fedify-dev/fedify/issues/1108
  '#1128': https://github.com/fedify-dev/fedify/pull/1128
---
 -  Fixed an unhandled error when a POST request has multiple RFC 9421
    signatures covering `Content-Digest` and an earlier signature fails.
    Verification now reads the body once, allowing later valid signatures
    to be accepted and invalid requests to receive `401 Unauthorized`.
    [[#1108], [#1128]]
