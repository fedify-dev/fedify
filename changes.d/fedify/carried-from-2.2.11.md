---
links:
  '#1008': https://github.com/fedify-dev/fedify/pull/1008
  '#998': https://github.com/fedify-dev/fedify/issues/998
---
 -  Fixed some public relay subscription requests being rejected by
    implementations that compare `Follow.object` as a plain URL without JSON-LD
    expansion.  The Public collection in relay `Follow` activities is now
    serialized as its full ActivityStreams URI instead of a compact IRI.
    [[#998], [#1008] by Jiwon Kwon\]
