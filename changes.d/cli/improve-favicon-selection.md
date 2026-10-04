---
links:
  '#1187': https://github.com/fedify-dev/fedify/pull/1187
  '#893': https://github.com/fedify-dev/fedify/issues/893
---
 -  Changed the `fedify nodeinfo` favicon selector to pick a usable bitmap
    icon more often.  It now skips SVG icons declared with
    `type="image/svg+xml"`, not just those with a `.svg` URL, and it considers
    every declared size instead of only the first, so an icon offering a large
    size is no longer discarded because its smallest size is too small.
    [[#893], [#1187] by Lee Jeongmin]
