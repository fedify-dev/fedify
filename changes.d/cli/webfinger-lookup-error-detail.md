---
links:
  '#1296': https://github.com/fedify-dev/fedify/pull/1296
  '#897': https://github.com/fedify-dev/fedify/issues/897
---
 -  Changed the `fedify webfinger` command's error message when a lookup
    fails.  It now explains why—resource not found, a network error, a
    malformed response, or an unexpected server error—instead of always
    reporting the resource as not found.  [[#897], [#1296] by Jae-Hyuk-Jang]
