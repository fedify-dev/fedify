URI Template specification
==========================

*This specification describes the `@fedify/uri-template` package implementation
as of version 0.1.0.*


Introduction
------------

This document explains how the `@fedify/uri-template` package implements
[RFC 6570] URI Templates and extends them with symmetric pattern matching.

The package is built on three foundations.  First, it parses a template string
into a small abstract syntax tree (AST) that represents RFC 6570 constructs.
Second, it *expands* variables into a URL using a single, deterministic encoder
that follows operator-specific rules.  Third, it *matches* existing URLs back
to variables using the same AST and rule table, adding explicit encoding modes
so callers can choose byte-preserving or human-readable behavior.  This
unification is what makes round-trips predictable with no ad-hoc heuristics.

[RFC 6570]: https://datatracker.ietf.org/doc/html/rfc6570


RFC 6570 elements in practice
------------------------------

> RFC 6570 divides a template into **literals** and **expressions**.

A **literal** is any substring outside curly braces.  Literals are copied
directly during expansion and must match exactly during pattern matching.
If a literal contains `%` sequences, those sequences are not decoded—literals
are treated as already-encoded text.

For example, in the template `/users/{id}/profile`, the strings `/users/`, `/`,
and `/profile` are literals.  During expansion, these parts remain unchanged,
so if `id` expands to `123`, the result would be `/users/123/profile`.  If the
literal contained encoded characters like `/users%2F{id}`, the `%2F` sequence
would remain as-is rather than being decoded to `/`.

An *expression* is enclosed in `{...}` and contains an optional *operator*
followed by a comma-separated list of variable specifications (varspecs)[^1]:

~~~~
{ operator? var1, var2, var3 }
~~~~

Each varspec may include two modifiers:

 -  `:n` (prefix): Only the first `n` characters of the variable are used, and
    the truncation happens before any percent-encoding.
 -  `*` (explode): Lists and maps expand into multiple items rather than
    a single comma-joined value.

RFC 6570 defines eight operators, each with distinct behavior:

 -  *Simple* (`{var}`): Outputs values comma-separated.  Reserved characters
    are encoded.
 -  *Reserved* (`{+var}`): Like simple, but reserved characters are allowed to
    pass through unencoded.
 -  *Fragment* (`{#var}`): Like reserved, but the full expression is prefixed
    with `#`.  The operator allows many reserved characters to pass, but never
    a literal `#`, which would start a new fragment.
 -  *Label* (`{.var}`): Each value is prefixed with a dot.  Even an *empty*
    value still emits the dot (e.g., `"X{.y}"` with `y=""` yields `"X."`)[^2].
 -  *Path segments* (`{/var}`): Each value is prefixed with `/`.
 -  *Matrix parameters* (`{;x,y}`): Each variable is prefixed with `;` and is
    *named*.
     -  Empty becomes `;x`
     -  Undefined is omitted entirely
 -  *Query* (`{?x,y}`): First character `?`, then name/value pairs joined with
    `&`.
     -  An empty value becomes `x=`
     -  Undefined is omitted
 -  *Query continuation* (`{&x,y}`): Like query but begins with `&`, intended
    to append to existing query strings.

> [!NOTE]
> The distinction between "undefined" and "empty" is critical and depends on
> the specific operator being used.  "Undefined" means the variable should be
> *omitted entirely* from the output.  In contrast, "empty" means the operator
> should *emit something* according to its rules: `nameOnly` format for matrix
> parameters (`;x`), `empty` format for queries (`x=`), or omission for most
> other operators—except for labels, which still print the dot separator.


Parsing strategy
-----------------

Parsing is a single forward scan that alternates between collecting literals and
parsing expressions.  We avoid broad regex for resilient parsing and, more
importantly, it is less error-prone when you need exact source positions and
behavior around edge cases.

 1. *Scan for `{`*: Everything preceding it forms a Literal node.

 2. *Read an expression*: The next character may be one of `+#./;?&`.
    If present, this character serves as the operator; otherwise, default to the
    "simple" operator.

 3. *Parse a varspec list*: For each variable specification, read the
    following components:

     -  The variable name (must be non-empty)
     -  An optional `:n` prefix modifier, where `n` is a non-negative integer
     -  An optional `*` explode flag
     -  Either a comma (indicating additional varspecs follow) or a closing
        brace

 4. *Require `}`*: If the input terminates before encountering the closing
    brace, this constitutes a parse error—templates must be properly balanced.

The result is a small AST: a sequence of `Literal` and `Expression` nodes.
Every later phase—expansion and matching—walks this same AST and consults
a single "operator spec" table.  This is the design fulcrum for symmetry: both
directions share exactly the same structure and tables.


Expansion—from variables to URL
--------------------------------

Expansion takes the AST and a dictionary of variables.  For literals, it copies
text unchanged.  For expressions, it computes a sequence of *pieces* and then
emits them with the operator's rules:

*Encoding is idempotent*
:   Existing `%XX` sequences remain intact, while characters requiring encoding
    are converted to UTF-8 bytes (`%HH`).

*Truncation (prefix `:n`) occurs before encoding*
:   Truncating after encoding risks splitting a `%HH` triplet; RFC 6570 requires
    truncation on the pre-encoded string.

*Explode*
:   Transforms lists or maps into multiple items instead of a single joined
    value.

*Join*
:   Pieces using the operator's separator and prepend the operator's *first
    character* (such as `#`, `.`, `/`, `;`, `?`, `&`) once, if defined.

*Empty/undefined handling*: The RFC specifies precise rules for these edge
cases:

 -  *Matrix* (`;`): Empty values yield `;x`, undefined values are omitted
 -  *Query* (`?`/`&`): Empty values yield `x=`, undefined values are omitted
 -  *Label* (`.`): Empty values still emit the dot separator (a commonly
    overlooked edge case)

These rules ensure that expansion from structured data produces deterministic
and stable results, eliminating ambiguity about when to include separators or
variable names.


Pattern matching
-----------------

Matching reads a URL string and attempts to recover the variables that would
produce that URL when expanded with the same template.

*Core Approach*: The fundamental concept is to reverse the expansion process
systematically rather than rely on heuristics.  We traverse the same AST used
for expansion.  For each literal node, we require it to appear exactly at the
current position.  For expressions, we:

 -  *Consume operator prefix*: If the operator defines a first character
    (`?`, `;`, `#`, `/`, `.`), we require its presence and consume it.

 -  *Greedy capture*: Until reaching the next concrete boundary:

     1. The subsequent literal in the AST
     2. The operator's item separator when matching multiple variables within
        the same expression

 -  *Preserve encoding integrity*: When splitting captured text by separators,
    we treat percent triplets as indivisible atoms, never splitting within `%HH`
    sequences to avoid corrupting encoded bytes.

 -  *Parse named operators*: For operators like `;`, `?`, and `&`, we parse
    `name=value` pairs but store **only the value** for each variable, mirroring
    how expansion generates names from operators rather than variable content.

 -  *Infer exploded structure*: For exploded named lists (e.g., `;tags*`), we
    determine structure based on patterns:

     -  If every segment follows `tags=...` format, we return an array of values
     -  Otherwise, we interpret as a key-value mapping (`?a=1&b=2` →
        `{ a: "1", b: "2" }`)

### Encoding modes

Encoding modes control the form of captured values:

*Opaque*
:   Preserves raw bytes (percent sequences) exactly.  If you match a URL with
    `"a%2Fb"`, you get `"a%2Fb"`.  This enables byte-for-byte round-trips.

*Cooked*
:   Decodes a valid `%HH` sequence exactly once, returning human-readable values
    such as `"a/b"`.  This is convenient for application logic and enables
    semantic round-trips.

*Lossless*
:   Returns both views `{ raw, decoded }`, allowing callers to decide per
    variable whether to preserve original bytes or use decoded text.

These options are explicit rather than implicit, providing flexibility while
maintaining correctness.


Round-trip guarantees
---------------------

While RFC 6570 briefly mentions that "some URI Templates can be used in reverse
for the purpose of variable matching"[^3], it provides no formal specification
or guarantees for this behavior.  Symmetry is often promised by implementations
but rarely defined precisely.

This package provides explicit round-trip guarantees as a core feature:

### Matching then expanding (byte symmetry)

Under `opaque` mode, for any URL that matches the template, re-expanding the
matched variables produces *the exact same bytes*.  Formally:

~~~~ typescript
expand(match(url, { encoding: "opaque" }).vars) === url
~~~~

This is essential for reverse routing, ensuring that URL patterns can be
reliably inverted.

### Expanding then matching (semantic symmetry)

Under `cooked` mode, for any valid variable dictionary, expanding and then
matching recovers semantically equivalent values:

~~~~ typescript
const matched = match(expand(vars), { encoding: "cooked" });
// matched.vars is semantically equivalent to vars
~~~~

This guarantees that the meaning of variables is preserved through the
round-trip, even if the exact byte representation differs due to normalization.

[^1]: <https://www.rfc-editor.org/rfc/rfc6570.html#section-2.3>
[^2]: <https://www.rfc-editor.org/rfc/rfc6570.html#section-3.2.5>
[^3]: <https://www.rfc-editor.org/rfc/rfc6570.html#section-1.4> (page 10)
