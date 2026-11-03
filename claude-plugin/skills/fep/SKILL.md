---
name: fep
description: >-
  Look up a Fediverse Enhancement Proposal (FEP) and explain how to
  implement it with Fedify. Use when the user asks about a specific FEP
  by ID (e.g., FEP-8fcf, FEP-1b12) or wants to implement a fediverse
  standard in their Fedify application.
argument-hint: <fep-id>
---

Look up the Fediverse Enhancement Proposal identified by “$ARGUMENTS” and
explain how to implement it with Fedify.


Normalization
-------------

Normalize the identifier first: strip any leading `FEP-` or `fep-` prefix
and lowercase the result to get the bare four-character hex id (e.g. `8fcf`).
Call that `$ID` in the steps below.  If the result does not match
`^[0-9a-f]{4}$`, stop and ask the user to provide a valid FEP identifier.


Retrieval
---------

If the `fep` MCP server is available, use `mcp__fep__get_fep` with id `$ID`
to retrieve the proposal.  Otherwise clone the proposals repo and read the
file:

~~~~ bash
FEP_DIR="${TMPDIR:-${TEMP:-/tmp}}/fedify-fep-repo"
git clone https://codeberg.org/fediverse/fep.git "$FEP_DIR" 2>/dev/null \
  || git -C "$FEP_DIR" pull --ff-only
cat "$FEP_DIR/fep/$ID/fep-$ID.md"
~~~~


Summary
-------

Summarize: status, what problem it solves, and what extensions it defines
(new JSON-LD terms, HTTP endpoints, or activity shapes).


Fedify implementation
---------------------

Explain which Fedify APIs are relevant to the implementation: vocabulary
types in `@fedify/vocab`, custom context handling, dispatcher or inbox
listener patterns.
