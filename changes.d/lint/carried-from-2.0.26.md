---
links:
  '#974': https://github.com/fedify-dev/fedify/issues/974
---
 -  Fixed `@fedify/lint` actor property requirement rules reporting false
    positives when an actor dispatcher returns `null` for an actor that was not
    found.  Non-null actor returns are still checked for the configured
    properties.  [[#974]]
