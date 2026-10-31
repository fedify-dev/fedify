---
links:
  '#1327': https://github.com/fedify-dev/fedify/issues/1327
  '#1341': https://github.com/fedify-dev/fedify/pull/1341
---
 -  Changed the Fresh integration documentation to discourage Fresh for new
    projects and to give advance notice that the integration and its example
    are tentatively planned for removal in Fedify 3.0.0, while remaining
    supported throughout the 2.x series.  The `@fedify/fresh` module and its
    exported functions are marked as deprecated in their JSDoc, and the first
    call to either exported function emits a one-time LogTape warning.  The
    removal plan may be reconsidered if Fresh gains stable support for runtimes
    other than Deno.  [[#1327], [#1341]]
