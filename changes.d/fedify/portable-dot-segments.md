---
links:
  '#1154': https://github.com/fedify-dev/fedify/issues/1154
  '#1186': https://github.com/fedify-dev/fedify/pull/1186
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Fixed portable actor and object URI helpers so a dispatcher identifier
    containing a `.` or `..` path segment raises a `TypeError` instead of
    silently producing another object's ID.  Use identifiers without such
    segments.  [[#288], [#1154], [#1186]]
