---
links:
  '#1177': https://github.com/fedify-dev/fedify/issues/1177
  '#1264': https://github.com/fedify-dev/fedify/pull/1264
---
 -  Changed compound portable-object verification to check each map's proof
    policy before resolving its key or verifying its signature, avoiding work
    for maps that will be rejected.  Policy-rejected maps now appear in
    `onRequestFinished` verification reports with their policy failure and no
    signature checks.  [[#1177], [#1264]]
