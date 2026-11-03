---
links:
  '#1316': https://github.com/fedify-dev/fedify/issues/1316
  '#1359': https://github.com/fedify-dev/fedify/pull/1359
---
 -  Added outbound observer registration support to mock federations and
    dispatch IDs to recorded sends. Tests can inspect `dispatchId` through
    `context.getSentActivities()` and `federation.sentActivities` to assert
    application correlation. Mock sends do not invoke outbound observer
    callbacks. [[#1316], [#1359] by Jiwon Kwon]
