---
links:
  '#1029': https://github.com/fedify-dev/fedify/pull/1029
---
 -  Added `NetlifyBlobsKvStore`, a Netlify Blobs-backed key–value store with
    expiration, prefix listing, and atomic compare-and-set operations.  Netlify
    deployments can now persist Fedify state and preserve ordered queue
    delivery without a separate database.  [[#1010], [#1029] by Jiwon Kwon]
