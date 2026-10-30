---
links:
  '#1238': https://github.com/fedify-dev/fedify/issues/1238
---
 -  Added SVG favicon support to `fedify nodeinfo`.  SVG icons are now
    rasterized and shown as terminal art instead of being skipped, so servers
    that only declare an SVG favicon get an icon too.  Bitmap icons are still
    preferred when a page declares both.  [[#1238] by Lee Jeongmin]
