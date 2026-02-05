Custom collections example
==========================

This example demonstrates how to implement custom collections in Fedify.
Custom collections allow you to define your own ActivityPub collections with
custom logic for dispatching items and counting collection sizes.

~~~~ sh
mise run codegen  # At very first time only (run from repository root)
deno run -A ./main.ts
~~~~
