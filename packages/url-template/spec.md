# RFC 6570-Compliant URI Template Library for TypeScript

## 1. Introduction

This document proposes the design and implementation of a new **RFC 6570-compliant URI Template library** in TypeScript. The motivation stems from practical issues encountered in Fedify and similar ActivityPub-related systems, where existing libraries (`url-template`, `uri-template-router`) show **asymmetry** between expansion and parsing.

The library aims to provide:

* **Full RFC 6570 compliance** for expansion (Levels 1–4).
* **Symmetric pattern matching**: a custom matcher ensuring `expand(parse(url)) === url` and `parse(expand(values)) === values`.
* **Type-safety** with TypeScript schemas for better developer experience.
* **Fedify-optimized extensions**, including predictable handling of URI-containing identifiers.

---

## 2. Problem Statement

### 2.1 Existing Issues

1. **Library asymmetry**

   * `url-template` handles expansion but not parsing.
   * `uri-template-router` handles parsing but applies decoding inconsistently.
   * RFC 6570 specifies only **expansion**, not parsing, leading to fragmented behavior.

2. **Incorrect identifier expansion**

   * Developers often use `{identifier}` (simple string expansion) even when identifiers contain full URIs such as `https://solid.example/actor`.
   * According to RFC 6570, **reserved expansion** `{+identifier}` must be used so that reserved characters (`:`, `/`, `?`, `#`) are not percent-encoded.
   * Misuse leads to broken URLs or failed matching.

3. **Lack of round-trip guarantees**

   * Current solutions cannot guarantee symmetry: expansion may succeed but parsing fails, or values decode differently than intended.
   * This unpredictability complicates routing, dispatching, and ActivityPub interactions.

### 2.2 Impact on Fedify

* **Dispatcher inconsistency**: routes like `/users/{identifier}/followers` may misinterpret identifiers.
* **Confusing documentation**: users are not guided toward `{+identifier}` for URI identifiers.
* **Fragile integrations**: any mismatch between expansion and parsing breaks interoperability with remote actors.

---

## 3. Goals and Requirements

### 3.1 Functional Requirements

* Implement all RFC 6570 expression types:

  * `{var}` simple string expansion
  * `{+var}` reserved expansion
  * `{/var}` path expansion
  * `{?var}` query expansion
  * `{&var}` query continuation
  * `{#var}` fragment expansion
* Support modifiers: explode `*`, prefix `:n`.
* Provide a symmetric matcher for every template.
* Ensure **round-trip consistency** between expansion and parsing.

### 3.2 Non-Functional Requirements

* **Type Safety**: support for declaring variable schemas (`scalar`, `list`, `assoc`) with TypeScript typing.
* **Performance**: competitive with `url-template` in expansion.
* **Compatibility**: backward compatible with existing Fedify APIs.
* **Documentation**: clear guidance on `{+identifier}` usage.

---

## 4. Design Overview

### 4.1 Template Parsing

* Templates parsed into an AST of `Literal` and `Expression` nodes.
* Expression nodes track operator, variable specs (`name`, `explode`, `prefixLen`).

### 4.2 Operator Configuration

A unified operator table defines:

* `prefix` (e.g., `#`, `/`, `?`)
* `separator` (e.g., `,`, `/`, `&`)
* `named` (whether to include `name=`)
* `ifEmpty` behavior (`skip`, `empty`, `nameOnly`)
* `allowReserved` (reserved char passthrough)

This table drives both expansion and matching, ensuring consistency.

### 4.3 Expansion

* Scalars encoded per operator rules (`pctEncode` vs `pctEncodeAllowReserved`).
* Lists expanded with or without explode (`*`).
* Associative objects expanded into key-value pairs.
* `{+var}` ensures reserved characters like `/`, `:` are not encoded.

### 4.4 Symmetric Pattern Matching

* Templates compiled into matchers.
* Matchers locate each expression slice by anchoring on surrounding literals.
* Decode rules mirror expansion rules:

  * Query operators treat `+` as space.
  * Other operators decode strictly (`+` preserved).
* Greedy literal matching ensures that identifiers containing substrings of the next literal (e.g., `followers`) are still parsed correctly.

### 4.5 Type Safety

* Developers can declare a `TemplateSchema`:

  ```ts
  const schema = { id: "scalar", tags: "list", opts: "assoc" } as const;
  ```
* The compiler enforces that `id` is scalar, `tags` is string\[], and `opts` is Record.

---

## 5. Symmetry Guarantees

* **Expand → Match**: every expansion produced by this library is parsed back into the same values.
* **Match → Expand**: every parsed set of values expands back into the same string, modulo query parameter order (assoc objects).
* **No silent decoding mismatches**: reserved characters survive round-trip when `{+var}` or `{#var}` are used.

---

## 6. Comparison with Existing Libraries

| Feature                 | url-template | uri-template-router   | Proposed Library  |
| ----------------------- | ------------ | --------------------- | ----------------- |
| RFC 6570 Expansion      | Yes          | Partial               | Full              |
| Symmetric Matching      | No           | Partial, inconsistent | Yes               |
| Type Safety (TS)        | No           | No                    | Yes               |
| URI Identifier Handling | Encoded      | Inconsistent          | Correct via `{+}` |
| Round-trip Guarantee    | No           | No                    | Yes               |

---

## 7. Implementation Phases

1. **Expansion**: Implement all operators, modifiers, and encoding rules with unit tests.
2. **Symmetric Matching**: Compile matchers, test round-trip properties with `fast-check` property testing.
3. **Integration**: Replace Fedify’s `url-template` and `uri-template-router`. Run full regression test suite.
4. **Documentation**: Update URI Template guide. Emphasize `{+identifier}` for URIs.

---

## 8. Open Considerations

* **Associative query objects**: whether to allow both `opts=k,v,k,v` and `k=v&...`. Current plan: expand to `k=v&...`, parse both.
* **Greedy vs non-greedy matching**: implement fallback/backtracking to handle identifiers containing next literals.
* **Multi-byte prefixes**: prefix `:n` currently operates on JS string length, not code points. UTF-8 slicing may be considered later.

---

## 9. Conclusion

This library directly addresses the **asymmetry problem** outlined in the analysis: expansion and parsing are now governed by the same operator rules, ensuring **predictable, RFC-6570-compliant, and type-safe behavior**.

For Fedify, it eliminates dispatcher inconsistencies, provides clear guidance for URI identifiers via `{+var}`, and removes dependency on mismatched third-party libraries.
