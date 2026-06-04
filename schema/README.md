<!-- deno-fmt-ignore-file -->

Fedify JSON Schemas
===================

This directory holds the published JSON Schemas (draft 2020-12) for Fedify file
formats.  It is deployed to <https://json-schema.fedify.dev/> by Netlify on every
push to the *main* branch; the directory layout maps onto the URL, so
*schema/bench/scenario-v1.json* is served at
<https://json-schema.fedify.dev/bench/scenario-v1.json>.

Current schemas:

 -  *bench/scenario-v1.json* — the `fedify bench` scenario suite format (input).
 -  *bench/report-v1.json* — the `fedify bench` report format (output).


Versioning: append-only and immutable
--------------------------------------

A published version file is **never edited**.  Each schema's `$id` equals its
hosted URL, and external consumers pin that URL, so editing a published file
would silently change their validation.  A change therefore ships as a **new
version file** (for example *scenario-v2.json*), never an edit to an existing
one.  The immutability guard below enforces this where *main* history is
available, and review enforces it otherwise.


Source of truth and regeneration
---------------------------------

The schemas are authored as embedded objects in the CLI so the validator can
use them without reading files at runtime (which keeps the `deno compile`
binary self-contained):

 -  *packages/cli/src/bench/scenario/schema.ts*
 -  *packages/cli/src/bench/result/schema.ts*

The *.json* files here are generated from those objects.  After editing an
embedded schema, regenerate the published copies:

~~~~ sh
deno task -f @fedify/cli generate-bench-schema
~~~~

The matching TypeScript types live next to each schema
(*packages/cli/src/bench/scenario/types.ts* and
*packages/cli/src/bench/result/model.ts*); keep them in sync with the schema.


Guards
------

The benchmark schema tests (*packages/cli/src/bench/schema.test.ts*) enforce:

 -  **Meta/structural validation** — each schema is well-formed draft 2020-12
    with a hosted `$id` and no dangling `$ref`s.
 -  **Fixture validation** — example scenario and report fixtures validate, and
    deliberately invalid fixtures are rejected.
 -  **Drift** — the embedded schema object equals the published *.json* file
    byte-for-byte (run the regeneration task if this fails).
 -  **Immutability** — a published version file does not differ from its
    content at the merge-base with *main*, so a committed edit on a branch is
    caught.  This runs wherever *main* history is available (local development,
    and CI checked out with full history); it is skipped in a shallow checkout,
    where immutability is enforced by review instead.  Either way, ship a new
    version file rather than editing a published one.


Hosting
-------

*_headers* and *netlify.toml* configure Netlify to serve the schemas
cross-origin (editors and online validators fetch them), with the
`application/schema+json` media type and a long immutable cache.  Point the
Netlify site's base directory at this *schema/* folder.


Editor support
--------------

Add a schema reference to a scenario file for autocomplete and validation:

~~~~ yaml
# yaml-language-server: $schema=https://json-schema.fedify.dev/bench/scenario-v1.json
version: 1
target: http://localhost:3000
~~~~
