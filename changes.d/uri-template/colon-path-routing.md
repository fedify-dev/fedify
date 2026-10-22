---
links:
  '#1325': https://github.com/fedify-dev/fedify/pull/1325
---
 -  Added the `allowUnencodedColon` option to `Router.route()` for matching
    HTTP request paths containing decoded colons in variable values.  Exact
    matches take precedence, and matching remains strict by default.  [[#1325]]
