---
links:
  '#1062': https://github.com/fedify-dev/fedify/issues/1062
---
 -  Fixed `lookupWebFinger()` logging hostnames that fail to resolve as
    “Invalid URL for WebFinger resource descriptor” errors.  These failures
    are now logged as “DNS lookup failed for {url}” at the debug level.
    `lookupWebFinger()` still returns `null` in this case.  [[#1062]]
