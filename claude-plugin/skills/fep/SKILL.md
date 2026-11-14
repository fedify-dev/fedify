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

For draft [FEP-f799], `@fedify/vocab` provides `DeliverySuspension`,
`Collection.deliveryController`, and `controlledOrigins` on all five actor
classes.  `DeliverySuspension.suspensionStatus` uses the wire term `status`
and only the FEP-f799 IRI, independently of unrelated status vocabularies.
The default document loader resolves the FEP context locally.  These are
inert vocabulary tools: constructing or parsing them does not authenticate a
notice, verify controller authority, advertise a capability, or suspend
delivery. Validate the original JSON-LD before applying protocol decisions;
generated accessors can skip malformed values and hide multiplicity.

For raw FEP-f799 documents, use the tools in
`@fedify/fedify/delivery-suspension`:
`parseDeliverySuspensionDocument()`,
`parseDeliverySuspensionActivityDocument()`,
`parseActorControlMetadata()`, and `parseInboxControlMetadata()`.
These asynchronous parsers retain multiplicity and return detached raw and
expanded evidence.  Their default context loader resolves only preloaded
contexts; an explicit `contextLoader` must bound its own I/O.
Before expansion, context preflight applies a conservative work budget and
may reject valid JSON-LD outside the supported profile.
The parsers reject expanded `@included` outside `@value` literals and repeated
descriptions of inspected IDs, including across named graphs. Properties
asserted through `@reverse` for inspected IDs are rejected too. The duplicate
check covers the root node and, depending on the parser, the nodes directly
under an activity's `object` or an actor's `endpoints`. Descriptions of other
IDs, and references with only `@id` and an optional `@index`, may repeat. This
check treats `@value` payloads as opaque; other profile limits still apply.
Reference-only actor `endpoints` values stay unresolved even with an `@index`
annotation, which is retained in the evidence. Use
`parseDeliverySuspensionOrigin()` for root-origin identifiers and
`getDeliverySuspensionUrlOrigin()` for endpoint origins.  The origin helpers
apply IDNA2008 with a pinned Unicode 12.0 repertoire. Successful parsing
establishes shape consistency only.  Authentication, controller authority,
replay checks, and signed-state equality still require separate validation.  An
`Undo` result contains an unverified activity claim.

[FEP-f799]: https://w3id.org/fep/f799
