---
links:
  '#1154': https://github.com/fedify-dev/fedify/issues/1154
  '#1186': https://github.com/fedify-dev/fedify/pull/1186
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Fixed portable and gateway-compatible ID strings with `.` or `..` path
    segments being interpreted as different IDs after URL parsing.  Fedify now
    rejects these strings because the segments cannot be preserved by its
    URL-based APIs.  Raw portable ID strings can still be compared without
    losing their paths.  [[#288], [#1154], [#1186]]
