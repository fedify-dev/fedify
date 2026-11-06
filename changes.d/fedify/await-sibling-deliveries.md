---
links:
  '#1380': https://github.com/fedify-dev/fedify/issues/1380
  '#1388': https://github.com/fedify-dev/fedify/pull/1388
---
 -  Fixed `Context.sendActivity()` and `InboxContext.forwardActivity()` giving
    up on the remaining deliveries when one recipient failed.  The immediate
    delivery paths now wait for every delivery they have already started before
    propagating the error, so the remaining recipients are still reached on
    runtimes such as Cloudflare Workers, which may terminate an isolate once
    the error response is returned.  This applies both to `immediate: true` and
    to federations without an outbox queue.  [[#1380], [#1388]]
