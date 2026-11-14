---
links:
  '#1424': https://github.com/fedify-dev/fedify/issues/1424
  '#1428': https://github.com/fedify-dev/fedify/pull/1428
---
 -  Fixed `require("@fedify/nestjs")` failing with `MODULE_NOT_FOUND`, which
    broke the integration in NestJS projects compiled to CommonJS, the NestJS
    default.  The package manifest pointed its CommonJS entry point and type
    declarations at files that the build no longer produced; they now point
    to the files that are actually shipped, so the integration loads with
    `require()` again and TypeScript finds its declarations.  ESM imports were
    not affected.  [[#1424], [#1428]]
