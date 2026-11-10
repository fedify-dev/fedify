---
links:
  '#1382': https://github.com/fedify-dev/fedify/issues/1382
  '#1415': https://github.com/fedify-dev/fedify/pull/1415
---
 -  Fixed `FedifySpanExporter.forceFlush()` and `shutdown()` returning before
    pending trace writes finish.  Added a `waitUntil` exporter option to keep
    serverless invocations alive for each export attempt; use it with
    `SimpleSpanProcessor` on Cloudflare Workers.  [[#1382], [#1415]]
