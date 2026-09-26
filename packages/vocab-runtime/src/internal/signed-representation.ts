import preloadedContexts from "../contexts.ts";

/**
 * A JSON map.  Retained signed representations are always plain JSON maps.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export type SignedRepresentationJsonMap = Record<string, unknown>;

const RETAINED_SIGNED_REPRESENTATION = Symbol.for(
  "@fedify/vocab-runtime.signedRepresentation.v1",
);

const SIGNED_VALUE_SCOPE = Symbol.for(
  "@fedify/vocab-runtime.signedValueScope.v1",
);

/**
 * The IRI namespace of the placeholder node references that stand in for a
 * retained signed representation until the owning `toJsonLd()` frame puts the
 * representation back.
 */
const MARKER_NAMESPACE = "urn:x-fedify-signed-value:";

/** Bounds applied when validating a retained signed representation. */
const MAX_VALIDATION_DEPTH = 64;
const MAX_VALIDATION_NODES = 100_000;

/**
 * The depth to which placeholders are put back.  It has to exceed
 * {@link MAX_VALIDATION_DEPTH}, because a restored document is itself nested
 * inside the document that embeds it.  Running out of depth is an error
 * rather than a stopping point: a placeholder left in an unvisited subtree
 * would reach the wire in place of the secured child.
 */
const MAX_RESTORATION_DEPTH = 256;

/**
 * JSON-LD keywords that may appear at the top level of a context definition
 * without endangering placeholder recovery.  `@vocab` and `@base` are checked
 * separately because they can rewrite the placeholder IRI.
 */
const HARMLESS_CONTEXT_KEYWORDS: ReadonlySet<string> = new Set([
  "@protected",
  "@version",
  "@propagate",
]);

/**
 * Keyword aliases that are safe to leave in place because the placeholder
 * recovery walker understands them.
 */
const ALLOWED_KEYWORD_ALIASES: ReadonlyMap<string, string> = new Map([
  ["id", "@id"],
  ["type", "@type"],
]);

function isJsonMap(value: unknown): value is SignedRepresentationJsonMap {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Checks that a value is a plain JSON tree that is safe to embed verbatim in
 * a serialized document: plain object and array prototypes only, string keys
 * only, own enumerable data properties only, finite numbers, and no
 * `undefined`.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function isPlainJsonTree(value: unknown): boolean {
  let nodes = 0;
  return check(value, 0);

  function check(current: unknown, depth: number): boolean {
    if (depth > MAX_VALIDATION_DEPTH) return false;
    if (++nodes > MAX_VALIDATION_NODES) return false;
    if (current === null) return true;
    switch (typeof current) {
      case "string":
      case "boolean":
        return true;
      case "number":
        return Number.isFinite(current);
      case "object":
        break;
      default:
        return false;
    }
    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) return false;
      if (Object.getOwnPropertySymbols(current).length > 0) return false;
      for (let i = 0; i < current.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(current, i);
        if (descriptor == null || !("value" in descriptor)) return false;
        if (!check(descriptor.value, depth + 1)) return false;
      }
      return true;
    }
    if (!isJsonMap(current)) return false;
    if (Object.getOwnPropertySymbols(current).length > 0) return false;
    for (const key of Object.getOwnPropertyNames(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor == null || !("value" in descriptor)) return false;
      if (!descriptor.enumerable) return false;
      if (!check(descriptor.value, depth + 1)) return false;
    }
    return true;
  }
}

function deepFreeze<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

/**
 * Attaches the secured JSON document that a signer captured for `target`.
 *
 * The document is the exact JSON value that the object's own Object Integrity
 * Proof covers.  Nested serialization embeds it verbatim instead of
 * reconstructing the object under the parent's JSON-LD context.  The value is
 * deep-frozen, so it is independent of anything done to `target` afterwards.
 *
 * `clone()` never carries the attachment, because a clone is a fresh instance.
 *
 * @internal Technically exported for `@fedify/fedify` and generated
 * vocabulary classes, but not part of the public API contract.  This is not
 * considered public API for Semantic Versioning decisions.
 */
export function retainSignedRepresentation(
  target: object,
  securedDocument: SignedRepresentationJsonMap,
): void {
  if (!isJsonMap(securedDocument) || !isPlainJsonTree(securedDocument)) {
    throw new TypeError(
      "The secured document must be a plain JSON map within the validation " +
        `bounds (at most ${MAX_VALIDATION_DEPTH} levels deep and ` +
        `${MAX_VALIDATION_NODES} nodes).`,
    );
  }
  Object.defineProperty(target, RETAINED_SIGNED_REPRESENTATION, {
    value: deepFreeze(securedDocument),
    enumerable: false,
    writable: false,
    configurable: true,
  });
}

/**
 * Returns the secured JSON document retained for `target`, if any.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function getRetainedSignedRepresentation(
  target: unknown,
): SignedRepresentationJsonMap | undefined {
  if (target == null || typeof target !== "object") return undefined;
  const retained = (target as Record<symbol, unknown>)[
    RETAINED_SIGNED_REPRESENTATION
  ];
  return isJsonMap(retained) ? retained : undefined;
}

function resolveContextEntry(entry: unknown): unknown {
  if (typeof entry !== "string") return entry;
  if (!Object.hasOwn(preloadedContexts, entry)) return undefined;
  const document = preloadedContexts[entry];
  if (!isJsonMap(document)) return undefined;
  return document["@context"];
}

/**
 * Checks whether a JSON-LD context leaves placeholder node references
 * recoverable after compaction.
 *
 * Placeholder recovery replaces a bare IRI string, `{"@id": …}`, or
 * `{"id": …}`.  A context that aliases `@id` under a different term, declares
 * `@nest`, uses an `@id` or `@type` container, rebases or re-vocabularies the
 * placeholder namespace, or defines a prefix that shortens the placeholder
 * IRI could hide the placeholder from that walker or make the walker rewrite
 * the wrong node.  A context that cannot be resolved offline cannot be vetted
 * at all.  Any of those makes the context unsafe, and retention is then not
 * used.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function isMarkerSafeContext(context: unknown): boolean {
  return check(context, 0);

  function check(current: unknown, depth: number): boolean {
    if (depth > 8) return false;
    if (Array.isArray(current)) {
      return current.every((entry) => check(entry, depth + 1));
    }
    if (typeof current === "string") {
      const resolved = resolveContextEntry(current);
      if (resolved === undefined) return false;
      return check(resolved, depth + 1);
    }
    if (current == null) return true;
    if (!isJsonMap(current)) return false;
    for (const [term, definition] of Object.entries(current)) {
      if (term === "@vocab" || term === "@base") {
        // A `@vocab` or `@base` that covers the placeholder namespace lets
        // compaction emit a shortened or relative form of the marker.
        if (typeof definition !== "string") return false;
        if (sharesMarkerNamespace(definition)) return false;
        continue;
      }
      if (term.startsWith("@")) {
        if (!HARMLESS_CONTEXT_KEYWORDS.has(term)) return false;
        continue;
      }
      // A term named `urn` turns `urn:x-fedify-signed-value:…` into
      // something a JSON-LD processor reads as a compact IRI, which it
      // rejects outright in safe mode.
      if (MARKER_NAMESPACE.startsWith(`${term}:`)) return false;
      if (!checkTerm(term, definition, depth)) return false;
    }
    return true;
  }

  function checkTerm(
    term: string,
    definition: unknown,
    depth: number,
  ): boolean {
    if (definition == null) return true;
    if (typeof definition === "string") {
      return checkTermTarget(term, definition);
    }
    if (!isJsonMap(definition)) return false;
    const target = definition["@id"];
    if (target != null) {
      if (typeof target !== "string") return false;
      if (!checkTermTarget(term, target)) return false;
    }
    if ("@nest" in definition) return false;
    if ("@reverse" in definition) return false;
    const container = definition["@container"];
    const containers = Array.isArray(container)
      ? container
      : container == null
      ? []
      : [container];
    for (const entry of containers) {
      if (entry === "@id" || entry === "@type") return false;
    }
    if ("@context" in definition) {
      if (!check(definition["@context"], depth + 1)) return false;
    }
    return true;
  }

  function checkTermTarget(term: string, target: string): boolean {
    if (target.startsWith("@")) {
      return ALLOWED_KEYWORD_ALIASES.get(term) === target;
    }
    // A target with no scheme separator is not an IRI: it resolves through
    // another term or through `@vocab`, so it can alias `@id` indirectly
    // (`{ i: "id" }` where `id` is ActivityStreams' own `@id` alias).
    // Resolving those chains is not worth it here; reject them and let the
    // document take the ordinary-serialization fallback.
    if (!target.includes(":")) return false;
    // A prefix definition that covers the placeholder namespace lets
    // compaction emit the marker as a compact IRI.
    return !sharesMarkerNamespace(target);
  }
}

/**
 * Reports whether an IRI prefix could shorten, relativize or otherwise hide a
 * placeholder IRI.  Both directions matter: a prefix shorter than the
 * namespace covers every marker, and a longer one covers the markers whose
 * random suffix happens to start with it.
 */
function sharesMarkerNamespace(prefix: string): boolean {
  return MARKER_NAMESPACE.startsWith(prefix) ||
    prefix.startsWith(MARKER_NAMESPACE);
}

/**
 * The per-`toJsonLd()`-call state that tracks retained children.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export interface SignedValueScope {
  /** Whether retained representations may be embedded at all. */
  readonly enabled: boolean;
  /** Marker IRI for each retained instance seen in this call. */
  readonly markers: Map<object, string>;
  /** Retained document for each marker IRI. */
  readonly documents: Map<string, SignedRepresentationJsonMap>;
}

/**
 * The result of entering a signed-value scope.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export interface SignedValueScopeEntry {
  readonly scope: SignedValueScope;
  /**
   * Whether this frame created the scope, and therefore has to put the
   * retained documents back before returning.
   */
  readonly owner: boolean;
}

/**
 * Joins the signed-value scope of the enclosing `toJsonLd()` frame, or starts
 * one when this frame is the outermost.
 *
 * `options` must already be the internal copy that the generated encoder
 * makes, never the object a caller passed in: the scope is attached to it as
 * an enumerable symbol-keyed property so that every `{...options}` spread in
 * the generated code propagates it to nested and inherited frames.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function enterSignedValueScope(
  options: {
    format?: "compact" | "expand";
    context?:
      | string
      | Record<string, string>
      | (string | Record<string, string>)[];
  },
): SignedValueScopeEntry {
  const existing = (options as Record<symbol, unknown>)[SIGNED_VALUE_SCOPE];
  if (existing != null) {
    return { scope: existing as SignedValueScope, owner: false };
  }
  const scope: SignedValueScope = {
    // A document that the caller asked to have expanded has no compact
    // representation to preserve, so retention does not apply to it.
    enabled: options.format !== "expand" &&
      (options.context == null || isMarkerSafeContext(options.context)),
    markers: new Map(),
    documents: new Map(),
  };
  Object.defineProperty(options, SIGNED_VALUE_SCOPE, {
    value: scope,
    enumerable: true,
    writable: false,
    configurable: true,
  });
  return { scope, owner: true };
}

/**
 * Emits a placeholder node reference for a value that carries a retained
 * signed representation, or `undefined` when it does not carry one.
 *
 * Both encoder paths use placeholders, never the retained document itself:
 * an ancestor frame may still expand or compact the value, which would
 * destroy an embedded document but leaves a node reference recoverable.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function retainedSignedValueRef(
  value: unknown,
  scope: SignedValueScope,
): { "@id": string } | undefined {
  if (!scope.enabled) return undefined;
  if (value == null || typeof value !== "object") return undefined;
  const retained = getRetainedSignedRepresentation(value);
  if (retained == null) return undefined;
  let marker = scope.markers.get(value);
  if (marker == null) {
    // Validated once per instance per call; `retainSignedRepresentation()`
    // already enforces this, so a failure here means the carrier was written
    // by something other than a signer.
    if (!isPlainJsonTree(retained)) return undefined;
    marker = `${MARKER_NAMESPACE}${crypto.randomUUID()}`;
    scope.markers.set(value, marker);
    scope.documents.set(marker, retained);
  }
  return { "@id": marker };
}

function markerOf(
  value: unknown,
  scope: SignedValueScope,
): string | undefined {
  return typeof value === "string" && scope.documents.has(value)
    ? value
    : undefined;
}

/**
 * Puts every retained signed representation back in place of its placeholder
 * node reference.
 *
 * Only the frame that owns the scope calls this, and only after compaction
 * and context embedding are complete.
 *
 * @throws {TypeError} If a retained document was not put back anywhere, or if
 *         any trace of a placeholder survives.  Both mean the serialized
 *         document does not contain the secured child it was told to embed,
 *         and emitting it would produce a signed child that silently fails
 *         verification.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function resolveSignedValues(
  document: unknown,
  scope: SignedValueScope,
): unknown {
  if (scope.documents.size < 1) return document;
  const restored = new Set<string>();
  const resolved = restore(document, 0);
  // Emitted references are not counted, because the generated encoders can
  // legitimately emit one more or one fewer than the output holds: a subtype
  // that redefines an inherited property re-encodes it after deleting the
  // inherited key, and a functional property with redundant properties writes
  // one encoded value under several keys.  What must hold is that every
  // retained document reached the output somewhere, and that no trace of a
  // placeholder is left behind.
  for (const marker of scope.documents.keys()) {
    if (restored.has(marker)) continue;
    throw new TypeError(
      `Failed to preserve a signed child representation: the placeholder ` +
        `${marker} is not in the serialized document.`,
    );
  }
  // A shortened or relativized marker no longer matches the walker's
  // reference shapes, so look for the random suffix anywhere in the output,
  // including in map keys.
  const trace = findMarkerTrace(resolved, scope);
  if (trace != null) {
    throw new TypeError(
      `Failed to preserve a signed child representation: a trace of the ` +
        `placeholder ${trace} survived serialization.`,
    );
  }
  return resolved;

  function restore(value: unknown, depth: number): unknown {
    if (depth > MAX_RESTORATION_DEPTH) {
      throw new TypeError(
        "Failed to preserve a signed child representation: the serialized " +
          `document is nested deeper than ${MAX_RESTORATION_DEPTH} levels, ` +
          "so a placeholder could be left unresolved.",
      );
    }
    const direct = markerOf(value, scope);
    if (direct != null) return take(direct);
    if (Array.isArray(value)) {
      let changed = false;
      const mapped = value.map((item) => {
        const next = restore(item, depth + 1);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? mapped : value;
    }
    if (!isJsonMap(value)) return value;
    const keys = Object.keys(value);
    if (keys.length === 1 && (keys[0] === "@id" || keys[0] === "id")) {
      const marker = markerOf(value[keys[0]], scope);
      if (marker != null) return take(marker);
    }
    let changed = false;
    // Write into a null-prototype object so that a key called `__proto__`
    // becomes a regular own property instead of poisoning the chain.
    const mapped: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      // `@context` holds term definitions, never a node reference.
      const next = key === "@context"
        ? value[key]
        : restore(value[key], depth + 1);
      if (next !== value[key]) changed = true;
      mapped[key] = next;
    }
    if (!changed) return value;
    // Restore the ordinary prototype once every key is an own property, so
    // that the result compares equal to a plain object literal.
    return Object.setPrototypeOf(mapped, Object.prototype);
  }

  function take(marker: string): SignedRepresentationJsonMap {
    restored.add(marker);
    // A fresh copy per insertion site, so that two sites never alias one
    // object and a caller mutating the returned document cannot reach the
    // frozen snapshot.  The restored document is not traversed again.
    return structuredClone(
      scope.documents.get(marker),
    ) as SignedRepresentationJsonMap;
  }
}

/**
 * Finds any surviving trace of a placeholder IRI in a resolved document,
 * matching the random suffix rather than the whole IRI so that a shortened,
 * relativized or otherwise rewritten marker is caught too.
 */
function findMarkerTrace(
  document: unknown,
  scope: SignedValueScope,
): string | undefined {
  const suffixes = new Map<string, string>();
  for (const marker of scope.documents.keys()) {
    suffixes.set(marker.slice(MARKER_NAMESPACE.length), marker);
  }
  return search(document, 0);

  function matched(value: string): string | undefined {
    for (const [suffix, marker] of suffixes) {
      if (value.includes(suffix)) return marker;
    }
    return undefined;
  }

  function search(value: unknown, depth: number): string | undefined {
    if (depth > MAX_RESTORATION_DEPTH) {
      throw new TypeError(
        "Failed to preserve a signed child representation: the serialized " +
          `document is nested deeper than ${MAX_RESTORATION_DEPTH} levels, ` +
          "so a surviving placeholder could go unnoticed.",
      );
    }
    if (typeof value === "string") return matched(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = search(item, depth + 1);
        if (found != null) return found;
      }
      return undefined;
    }
    if (value == null || typeof value !== "object") return undefined;
    for (const [key, child] of Object.entries(value)) {
      const found = matched(key) ?? search(child, depth + 1);
      if (found != null) return found;
    }
    return undefined;
  }
}
