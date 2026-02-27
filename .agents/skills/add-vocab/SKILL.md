---
name: add-vocab
description: >-
  This skill should be used when adding new ActivityPub/JSON-LD vocabulary
  types to the @fedify/vocab package, defining new YAML vocabulary schema
  files, or updating existing vocabulary definitions in Fedify. Applies when
  implementing FEPs, extending ActivityStreams vocabulary, or adding third-party
  vocab types such as Mastodon extensions, Litepub types, or other fediverse
  vocabularies.
version: 1.0.0
---

Adding vocabulary to @fedify/vocab
==================================

To add a new vocabulary type to the `@fedify/vocab` package, create a YAML
definition file in `packages/vocab/src/`, then run code generation.


Human review requirement
------------------------

**Vocabulary definitions must always be reviewed carefully by a human before
being merged.** Errors in vocabulary definitions are difficult to fix after
release because they break wire compatibility with existing software in the
fediverse. Specifically, verify:

 -  The type URI and property URIs match the spec exactly (a single character
    difference causes silent interoperability failures)
 -  The `defaultContext` is complete and all terms compact correctly (see
    “Ensuring Complete Compaction Coverage” below)
 -  The `entity` flag is correct — getting this wrong changes the entire
    async/sync interface contract
 -  The `functional` flag is correct — marking a multi-valued property as
    functional silently drops values
 -  Every property `range` entry is accurate — wrong range types produce incorrect
    TypeScript types
 -  The spec document (FEP or W3C spec) has been read in full, not just skimmed

Do not rely solely on automated checks (`mise run check`)—they verify only
TypeScript compilation, not semantic correctness of the vocabulary.


Workflow
--------

1.  Read the spec document (FEP, W3C spec, or informal documentation) carefully
2.  Identify the type's URI, JSON-LD context, and properties
3.  Check whether the JSON-LD context URL is already preloaded in
    `packages/vocab-runtime/src/contexts.ts`
4.  Create the YAML file at `packages/vocab/src/<typename-lowercase>.yaml`
5.  If a new context URL is needed, add it to
    `packages/vocab-runtime/src/contexts.ts`
6.  Run `mise run codegen` to generate TypeScript classes
7.  Run `mise run check` to verify everything compiles
8.  Ask the user to review the YAML definition and generated code carefully
    before committing

The generated TypeScript class is automatically exported from `@fedify/vocab`
via `packages/vocab/src/vocab.ts` (generated) and `packages/vocab/src/mod.ts`.


YAML file format
----------------

Every YAML file must begin with the schema reference:

~~~~ yaml
$schema: ../../vocab-tools/schema.yaml
~~~~

### Top-level fields

| Field            | Required | Description                                                                                                                                    |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | yes      | TypeScript class name (PascalCase, e.g. `Note`)                                                                                                |
| `uri`            | yes      | Fully qualified RDF type URI                                                                                                                   |
| `entity`         | yes      | `true` for entity types (async property accessors); `false` for value types (sync accessors). Must be consistent across the inheritance chain. |
| `description`    | yes      | JSDoc string. May use `{@link ClassName}` for cross-references.                                                                                |
| `properties`     | yes      | Array of property definitions (can be empty `[]`)                                                                                              |
| `compactName`    | no       | Short name in compact JSON-LD (e.g. `"Note"`). Omit if the type has no compact representation.                                                 |
| `extends`        | no       | URI of the parent type. Omit for root types.                                                                                                   |
| `typeless`       | no       | If `true`, `@type` is omitted when serializing to JSON-LD. Used for anonymous structures like `Endpoints` or `Source`.                         |
| `defaultContext` | no       | JSON-LD context used by `toJsonLd()`. See below.                                                                                               |

**Entity vs. value type (`entity` flag):**

 -  `entity: true` — property accessors are `async` and can fetch remote objects
 -  `entity: false` — property accessors are synchronous; used for embedded value
    objects (e.g. `Endpoints`, `Source`, `Hashtag`)

### `defaultContext` format

The `defaultContext` field specifies the JSON-LD `@context` written when
`toJsonLd()` is called. It can be:

**A single context URL:**

~~~~ yaml
defaultContext: "https://www.w3.org/ns/activitystreams"
~~~~

**An array of URLs and/or embedded context objects:**

~~~~ yaml
defaultContext:
  - "https://www.w3.org/ns/activitystreams"
  - "https://w3id.org/security/data-integrity/v1"
  - toot: "http://joinmastodon.org/ns#"
    Emoji: "toot:Emoji"
    sensitive: "as:sensitive"
    featured:
      "@id": "toot:featured"
      "@type": "@id"
~~~~

Embedded context entries are YAML mappings where:

 -  String value `"prefix:term"` or `"https://..."` defines a simple term alias
 -  Object value with `"@id"` and optionally `"@type": "@id"` defines a term that
    should be treated as an IRI (linked resource)

### Ensuring complete compaction coverage

The `defaultContext` must cover **every term that appears in the JSON-LD
document produced by `toJsonLd()`**, including:

1.  **The type's own `compactName`** — if the type has a `compactName`, the
    context must map that name to the type's URI.

2.  **All own property `compactName`s** — every property defined directly on this
    type must have its `compactName` (or full URI fallback) resolvable via the
    context.

3.  **Inherited properties** — properties from parent types are usually covered
    by the parent's context URL (e.g., `https://www.w3.org/ns/activitystreams`
    covers all core ActivityStreams properties). Verify that the parent's
    context URL is included.

4.  **Properties of embedded types** — when a property's value is an object type
    that is **serialized inline** (not just referenced by URL), the context must
    also cover all of that embedded type's properties. This is the most commonly
    missed case.

    Common embedded types and the context URLs that cover them:

    | Embedded type                       | Context URL to include                        |
    | ----------------------------------- | --------------------------------------------- |
    | `DataIntegrityProof` (from `proof`) | `https://w3id.org/security/data-integrity/v1` |
    | `Key` (from `publicKey`)            | `https://w3id.org/security/v1`                |
    | `Multikey` (from `assertionMethod`) | `https://w3id.org/security/multikey/v1`       |
    | `DidService` (from `service`)       | `https://www.w3.org/ns/did/v1`                |
    | `PropertyValue` (from `attachment`) | schema.org terms in embedded context          |


5.  **Redundant property `compactName`s** — if a property has
    `redundantProperties`, all their `compactName`s must also be defined in the
    context.

**Practical rule:** look at an existing type with similar embedded relationships
as a reference. For example, `Note` and `Article` include
`"https://w3id.org/security/data-integrity/v1"` because they embed
`DataIntegrityProof` objects via the `proof` property. `Person` additionally
includes security and DID contexts because it embeds `Key`, `Multikey`, and
`DidService` objects inline.

Omitting a required context causes silent compaction failure: the property
appears in expanded form (`"https://example.com/ns#term": [...]`) rather than
compact form (`"term": ...`) in the output.


Property definitions
--------------------

Each entry in `properties` is one of two kinds:

### Non-functional property (multiple values)

Generates `get<PluralName>()` async iterable and optionally a singular accessor.

~~~~ yaml
- pluralName: attachments # accessor: getAttachments() / attachments
  singularName: attachment # used if singularAccessor: true
  singularAccessor: true # also generate getAttachment() / attachment
  compactName: attachment # JSON-LD compact key
  uri: "https://www.w3.org/ns/activitystreams#attachment"
  description: |
    Identifies a resource attached or related to an object.
  range:
    - "https://www.w3.org/ns/activitystreams#Object"
    - "https://www.w3.org/ns/activitystreams#Link"
~~~~

Required: `pluralName`, `singularName`, `uri`, `description`, `range`

Optional: `singularAccessor` (default `false`), `compactName`, `subpropertyOf`,
`container` (`"graph"` or `"list"`), `embedContext`, `untyped`

### Functional property (exactly one value)

Generates a single `get<SingularName>()` / `<singularName>` accessor.

~~~~ yaml
- singularName: published
  functional: true
  compactName: published
  uri: "https://www.w3.org/ns/activitystreams#published"
  description: The date and time at which the object was published.
  range:
    - "http://www.w3.org/2001/XMLSchema#dateTime"
~~~~

Required: `singularName`, `functional: true`, `uri`, `description`, `range`

Optional: `compactName`, `subpropertyOf`, `redundantProperties`, `untyped`,
`embedContext`

### Redundant properties (functional only)

When a property has equivalent URIs from multiple vocabularies, use
`redundantProperties` to write all aliases on serialization and try them in
order on deserialization:

~~~~ yaml
- singularName: quoteUrl
  functional: true
  compactName: quoteUrl
  uri: "https://www.w3.org/ns/activitystreams#quoteUrl"
  redundantProperties:
    - compactName: _misskey_quote
      uri: "https://misskey-hub.net/ns#_misskey_quote"
    - compactName: quoteUri
      uri: "http://fedibird.com/ns#quoteUri"
  description: The URI of the quoted ActivityStreams object.
  range:
    - "fedify:url"
~~~~

### The `embedContext` field

Use `embedContext` when a nested object should carry its own `@context` (e.g.,
`proof` graphs in Data Integrity):

~~~~ yaml
embedContext:
  compactName: proof # key under which the context is embedded
  inherit: true # use the same context as the enclosing document
~~~~

### The `untyped` field

When `untyped: true`, the serialized value will not have a `@type` field.
Requires exactly one type in `range`. Used for embedded anonymous structures:

~~~~ yaml
- singularName: source
  functional: true
  compactName: source
  uri: "https://www.w3.org/ns/activitystreams#source"
  description: The source from which the content markup was derived.
  untyped: true
  range:
    - "https://www.w3.org/ns/activitystreams#Source"
~~~~


Range type reference
--------------------

### XSD scalar types → TypeScript types

| Range URI                                               | TypeScript type         |
| ------------------------------------------------------- | ----------------------- |
| `http://www.w3.org/2001/XMLSchema#string`               | `string`                |
| `http://www.w3.org/2001/XMLSchema#boolean`              | `boolean`               |
| `http://www.w3.org/2001/XMLSchema#integer`              | `number`                |
| `http://www.w3.org/2001/XMLSchema#nonNegativeInteger`   | `number`                |
| `http://www.w3.org/2001/XMLSchema#float`                | `number`                |
| `http://www.w3.org/2001/XMLSchema#anyURI`               | `URL` (stored as `@id`) |
| `http://www.w3.org/2001/XMLSchema#dateTime`             | `Temporal.Instant`      |
| `http://www.w3.org/2001/XMLSchema#duration`             | `Temporal.Duration`     |
| `http://www.w3.org/1999/02/22-rdf-syntax-ns#langString` | `LanguageString`        |

### Security scalar types

| Range URI                                     | TypeScript type    |
| --------------------------------------------- | ------------------ |
| `https://w3id.org/security#cryptosuiteString` | `"eddsa-jcs-2022"` |
| `https://w3id.org/security#multibase`         | `Uint8Array`       |

### Fedify internal types

| Range URI             | TypeScript type                                        | Notes                               |
| --------------------- | ------------------------------------------------------ | ----------------------------------- |
| `fedify:langTag`      | `Intl.Locale`                                          | BCP 47 language tag as plain string |
| `fedify:url`          | `URL`                                                  | URL stored as `@value` (not `@id`)  |
| `fedify:publicKey`    | `CryptoKey`                                            | PEM SPKI-encoded public key         |
| `fedify:multibaseKey` | `CryptoKey`                                            | Multibase-encoded key (Ed25519)     |
| `fedify:proofPurpose` | `"assertionMethod" \| "authentication" \| ...`         | Proof purpose string                |
| `fedify:units`        | `"cm" \| "feet" \| "inches" \| "km" \| "m" \| "miles"` | Place units                         |

### Vocabulary types

Any `uri` from another YAML vocabulary file can be used as a range. The
TypeScript type will be the corresponding generated class (e.g.,
`"https://www.w3.org/ns/activitystreams#Object"` → `Object`).


Adding preloaded JSON-LD contexts
---------------------------------

When `defaultContext` references a URL not already in
`packages/vocab-runtime/src/contexts.ts`, add it to `preloadedContexts`.

Check existing keys in that file first by searching for the URL. If missing,
fetch the actual context document from its canonical URL and add an entry:

~~~~ typescript
"https://example.com/ns/v1": {
  "@context": {
    // ... paste actual context content here ...
  },
},
~~~~

The keys of `preloadedContexts` must match the URL strings used in YAML
`defaultContext` fields. This enables offline JSON-LD processing.


Complete minimal example
------------------------

~~~~ yaml
$schema: ../../vocab-tools/schema.yaml
name: Move
compactName: Move
uri: "https://www.w3.org/ns/activitystreams#Move"
extends: "https://www.w3.org/ns/activitystreams#Activity"
entity: true
description: |
  Indicates that the actor has moved object from origin to target.
  If the origin or target are not specified, either can be determined by
  context.
defaultContext:
  - "https://www.w3.org/ns/activitystreams"
  - "https://w3id.org/security/data-integrity/v1"
properties: []
~~~~


Complete extended example (new vocabulary type)
-----------------------------------------------

When implementing a new type from a FEP (e.g. a new `Interaction` type with
custom properties from a hypothetical `https://example.com/ns#` namespace):

~~~~ yaml
$schema: ../../vocab-tools/schema.yaml
name: Interaction
compactName: Interaction
uri: "https://example.com/ns#Interaction"
extends: "https://www.w3.org/ns/activitystreams#Activity"
entity: true
description: |
  Represents a generic interaction with an object.
  See [FEP-xxxx](https://w3id.org/fep/xxxx).
defaultContext:
  - "https://www.w3.org/ns/activitystreams"
  - "https://w3id.org/security/data-integrity/v1"
  - example: "https://example.com/ns#"
    Interaction: "example:Interaction"
    interactionCount:
      "@id": "example:interactionCount"
      "@type": "http://www.w3.org/2001/XMLSchema#nonNegativeInteger"

properties:
  - singularName: interactionCount
    functional: true
    compactName: interactionCount
    uri: "https://example.com/ns#interactionCount"
    description: The number of interactions recorded.
    range:
      - "http://www.w3.org/2001/XMLSchema#nonNegativeInteger"

  - pluralName: participants
    singularName: participant
    singularAccessor: true
    compactName: participant
    uri: "https://example.com/ns#participant"
    description: Actors who participated in this interaction.
    range:
      - "https://www.w3.org/ns/activitystreams#Person"
      - "https://www.w3.org/ns/activitystreams#Group"
      - "https://www.w3.org/ns/activitystreams#Organization"
      - "https://www.w3.org/ns/activitystreams#Service"
      - "https://www.w3.org/ns/activitystreams#Application"
~~~~
