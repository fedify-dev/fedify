import { getLogger } from "@logtape/logtape";
import type { DocumentLoader } from "../docloader.ts";
import jsonld from "../jsonld.ts";
import type { RawPropertyValue } from "../vocabulary-object.ts";

/**
 * The key of the method through which the raw property functions reach the
 * per-class logic of generated vocabulary classes.  It is registered with
 * `Symbol.for()`, so that the functions generated into one module can read
 * objects generated into another, even when the modules depend on different
 * copies of this package.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export const RAW_PROPERTY_PROTOCOL: unique symbol = Symbol.for(
  "@fedify/vocab-runtime.rawPropertyProtocol.v1",
) as never;

const RAW_PROPERTY_ENCODING_STACK = Symbol.for(
  "@fedify/vocab-runtime.rawPropertyEncodingStack.v1",
);

/**
 * A request passed to the {@link RAW_PROPERTY_PROTOCOL} method.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export interface RawPropertyRequest {
  /**
   * The property IRIs to look up, in order of preference.  The first one
   * that is either a known property of the object or a retained unknown
   * property is used.
   */
  readonly candidates: readonly string[];

  /**
   * The objects that are being encoded, used to detect cycles.
   */
  readonly stack: Set<object>;
}

/**
 * The signature of the {@link RAW_PROPERTY_PROTOCOL} method.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export type RawPropertyProtocolMethod = (
  this: object,
  request: RawPropertyRequest,
) => Promise<readonly unknown[]>;

/**
 * Unknown properties retained while decoding an object, keyed by their full
 * property IRIs.  The record and its values are deeply frozen.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export type RetainedRawProperties = Readonly<
  Record<string, readonly unknown[]>
>;

/**
 * Copies a JSON value without recursion, so that values nested more deeply
 * than the call stack allows, such as `@json` literals, can be copied too.
 * Unlike `structuredClone()`, it also copies frozen values without slowing
 * down or overflowing. Shared acyclic subtrees remain shared within each
 * detached copy by default, and cycles are rejected.
 *
 * @param value The JSON value to copy.
 * @param freeze Whether to deeply freeze the copy.
 * @param preserveSharing Whether repeated references reuse a completed copy.
 *                        Disable this when each path must become an independently
 *                        mutable received-document cache.
 * @returns The copy.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function copyJsonValue<T>(
  value: T,
  freeze = false,
  preserveSharing = true,
): T {
  let result: unknown;
  const active = new WeakSet<object>();
  const completed = preserveSharing ? new WeakMap<object, object>() : undefined;
  const pending: {
    value: unknown;
    assign: (value: unknown) => void;
    exit?: object;
  }[] = [
    {
      value,
      assign: (copy) => {
        result = copy;
      },
    },
  ];
  while (pending.length > 0) {
    const task = pending.pop()!;
    if (task.exit != null) {
      active.delete(task.exit);
      task.assign(undefined);
      continue;
    }
    const source = task.value;
    if (source == null || typeof source !== "object") {
      task.assign(source);
      continue;
    }
    if (active.has(source))
      throw new TypeError("Cannot copy cyclic JSON values.");
    const existing = completed?.get(source);
    if (existing != null) {
      task.assign(existing);
      continue;
    }
    active.add(source);
    const copy: Record<string, unknown> | unknown[] = Array.isArray(source)
      ? []
      : {};
    task.assign(copy);
    pending.push({
      value: undefined,
      exit: source,
      assign: () => {
        if (freeze) Object.freeze(copy);
        completed?.set(source, copy);
      },
    });
    const entries = Object.entries(source);
    // Reverse the work stack to retain the source's enumeration order.
    for (let index = entries.length - 1; index >= 0; index--) {
      const [key, child] = entries[index];
      pending.push({
        value: child,
        assign: (value) => {
          if (Array.isArray(copy)) copy.push(value);
          // Own __proto__ members must remain data properties.
          else
            Object.defineProperty(copy, key, {
              value,
              writable: true,
              enumerable: true,
              configurable: true,
            });
        },
      });
    }
  }
  return result as T;
}

/**
 * Collects the properties of an expanded JSON-LD node that are not known to
 * the class decoding it.  JSON-LD keywords and blank node identifiers used as
 * keys are not properties, so they are never retained.
 *
 * @param node The expanded JSON-LD node.
 * @param knownIris The full IRIs of the properties the class decodes,
 *                  including inherited properties and redundant aliases.
 * @returns The deeply frozen unknown properties, or `undefined` if there are
 *          none.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function retainRawProperties(
  node: Record<string, unknown>,
  knownIris: ReadonlySet<string>,
): RetainedRawProperties | undefined {
  let retained: Record<string, readonly unknown[]> | undefined;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@") || key.startsWith("_:") || knownIris.has(key)) {
      continue;
    }
    if (!Array.isArray(value)) continue;
    retained ??= {};
    retained[key] = value;
  }
  return retained == null ? undefined : copyJsonValue(retained, true);
}

/**
 * Normalizes the values of a known property, which a generated encoder
 * produced in the same shape as `toJsonLd({ format: "expand" })` does, into
 * expanded JSON-LD.
 *
 * @param iri The full IRI of the property.
 * @param value The encoded property value: an array of values, or a list
 *              object.
 * @param contextLoader The loader for remote JSON-LD contexts.  The encoded
 *                      value has no context, so it is not expected to be
 *                      used.
 * @returns The expanded values of the property.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export async function expandRawPropertyValue(
  iri: string,
  value: unknown,
  contextLoader?: DocumentLoader,
): Promise<unknown[]> {
  const expanded = await jsonld.expand(
    { [iri]: value } as Parameters<typeof jsonld.expand>[0],
    { documentLoader: contextLoader, keepFreeFloatingNodes: true },
  );
  const node = expanded[0] as Record<string, unknown> | undefined;
  const values = node?.[iri];
  return Array.isArray(values) ? values : [];
}

/**
 * Creates the options that a generated per-property encoder passes to the
 * `toJsonLd()` method of nested vocabulary objects.
 *
 * @param stack The objects that are being encoded.
 * @param contextLoader The loader for remote JSON-LD contexts.
 * @returns The options for `toJsonLd()`.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function createRawPropertyEncodingOptions(
  stack: Set<object>,
  contextLoader?: DocumentLoader,
): { format: "expand"; contextLoader?: DocumentLoader } {
  return {
    format: "expand",
    contextLoader,
    [RAW_PROPERTY_ENCODING_STACK]: stack,
  } as { format: "expand"; contextLoader?: DocumentLoader };
}

/**
 * Encodes a nested vocabulary object.  When the encoding was started by a raw
 * property function, it tracks the objects being encoded and throws on a
 * cycle.  Otherwise, it just calls `encode()`.
 *
 * @param options The options of the enclosing `toJsonLd()` call.
 * @param value The nested object to encode.
 * @param encode The function that encodes `value`.
 * @returns The result of `encode()`.
 * @throws {TypeError} If `value` is already being encoded, i.e., the object
 *                     graph has a cycle.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export async function encodeNestedVocabularyValue<T>(
  options: object,
  value: object,
  encode: () => Promise<T>,
): Promise<T> {
  const stack = (options as Record<symbol, unknown>)[
    RAW_PROPERTY_ENCODING_STACK
  ] as Set<object> | undefined;
  if (stack == null) return await encode();
  if (stack.has(value)) {
    throw new TypeError(
      "Cannot encode the raw property values of a cyclic object graph.",
    );
  }
  stack.add(value);
  try {
    return await encode();
  } finally {
    stack.delete(value);
  }
}

const SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):/;

// Characters that RFC 3987 does not allow anywhere in an IRI: controls,
// space, and the excluded ASCII characters.
// oxlint-disable-next-line no-control-regex -- controls are what it rejects
const INVALID_CHAR_PATTERN = /[\u0000- "<>\\^`{|}\u007f-\u009f]/;

const INVALID_PERCENT_PATTERN = /%(?![0-9A-Fa-f]{2})/;

const LONE_SURROGATE_PATTERN =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Prefixes that well-known JSON-LD contexts in the fediverse define, used to
 * hint at the intended full IRI when a compact IRI is passed by mistake.
 */
const WELL_KNOWN_PREFIXES: Readonly<Record<string, string>> = {
  as: "https://www.w3.org/ns/activitystreams#",
  dcterms: "http://purl.org/dc/terms/",
  fedibird: "http://fedibird.com/ns#",
  ldp: "http://www.w3.org/ns/ldp#",
  litepub: "http://litepub.social/ns#",
  misskey: "https://misskey-hub.net/ns#",
  schema: "http://schema.org#",
  sec: "https://w3id.org/security#",
  toot: "http://joinmastodon.org/ns#",
  vcard: "http://www.w3.org/2006/vcard/ns#",
};

const MAX_WARNED_IRIS = 1024;
const warnedIris = new Set<string>();

function warnUnusualScheme(
  iri: string,
  scheme: string,
  functionName: string,
): void {
  if (warnedIris.has(iri)) return;
  warnedIris.add(iri);
  if (warnedIris.size > MAX_WARNED_IRIS) {
    warnedIris.delete(warnedIris.values().next().value!);
  }
  const logger = getLogger(["fedify", "vocab"]);
  const namespace = Object.hasOwn(WELL_KNOWN_PREFIXES, scheme)
    ? WELL_KNOWN_PREFIXES[scheme]
    : undefined;
  if (namespace == null) {
    logger.warn(
      "The property IRI {iri} passed to {function}() uses the {scheme}: " +
        "scheme rather than http: or https:.  Note that compact IRIs are " +
        "not expanded; pass the full property IRI.",
      { iri, scheme, function: functionName },
    );
  } else {
    const suggestion = namespace + iri.substring(scheme.length + 1);
    logger.warn(
      "The property IRI {iri} passed to {function}() looks like a compact " +
        "IRI, which is not expanded.  Did you mean {suggestion}?",
      { iri, scheme, function: functionName, suggestion },
    );
  }
}

/**
 * Validates a property IRI passed to a raw property function and returns the
 * keys to look it up by.
 *
 * @param iri The property IRI.
 * @param functionName The name of the public function, used in messages.
 * @returns The lookup keys, in order of preference: the IRI as given, then
 *          its WHATWG URL serialization if that differs.
 * @throws {TypeError} If `iri` is not a string or a `URL`, or is not an
 *                     absolute IRI.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function parseRawPropertyIri(
  iri: unknown,
  functionName: string,
): string[] {
  let exact: string;
  if (typeof iri === "string") exact = iri;
  else if (iri instanceof URL) exact = iri.href;
  else {
    throw new TypeError(
      `The property IRI passed to ${functionName}() must be a string or a ` +
        "URL.",
    );
  }
  if (exact === "") {
    throw new TypeError(
      `The property IRI passed to ${functionName}() must not be empty.`,
    );
  }
  if (exact.startsWith("@")) {
    throw new TypeError(
      `${functionName}() does not accept JSON-LD keywords such as ` +
        `${JSON.stringify(exact)}; pass a full property IRI.`,
    );
  }
  if (exact.startsWith("_:")) {
    throw new TypeError(
      `${functionName}() does not accept blank node identifiers such as ` +
        `${JSON.stringify(exact)}; pass a full property IRI.`,
    );
  }
  const match = SCHEME_PATTERN.exec(exact);
  if (match == null) {
    throw new TypeError(
      `The property IRI passed to ${functionName}() must be an absolute ` +
        `IRI, but got ${JSON.stringify(exact)}.  Terms and relative ` +
        "references are not expanded.",
    );
  }
  if (!isIriSyntax(exact.substring(match[0].length))) {
    throw new TypeError(
      `The property IRI passed to ${functionName}() is not a valid IRI: ` +
        `${JSON.stringify(exact)}.`,
    );
  }
  const scheme = match[1].toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    warnUnusualScheme(exact, match[1], functionName);
  }
  const keys = [exact];
  if (typeof iri === "string" && URL.canParse(exact)) {
    const normalized = new URL(exact).href;
    if (normalized !== exact) keys.push(normalized);
  }
  return keys;
}

function isIriSyntax(rest: string): boolean {
  if (rest === "") return false;
  if (
    INVALID_CHAR_PATTERN.test(rest) ||
    INVALID_PERCENT_PATTERN.test(rest) ||
    LONE_SURROGATE_PATTERN.test(rest)
  ) {
    return false;
  }
  const fragmentIndex = rest.indexOf("#");
  if (fragmentIndex >= 0 && rest.includes("#", fragmentIndex + 1)) {
    return false;
  }
  // Square brackets may only delimit an IP literal in the authority:
  let path = rest;
  if (rest.startsWith("//")) {
    const end = rest.slice(2).search(/[/?#]/);
    const authority = end < 0 ? rest.slice(2) : rest.slice(2, 2 + end);
    if (!isAuthoritySyntax(authority)) return false;
    path = end < 0 ? "" : rest.slice(2 + end);
  }
  return !path.includes("[") && !path.includes("]");
}

const IP_LITERAL_PATTERN = /^\[([^[\]]*)\](?::[0-9]*)?$/;
const IP_FUTURE_PATTERN = /^v[0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+$/i;

/**
 * Checks that an authority has a numeric port, if any, and that square
 * brackets delimit an IPv6 address or an IPvFuture literal as the whole host,
 * as RFC 3986 requires.
 */
function isAuthoritySyntax(authority: string): boolean {
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  const userinfo = authority.slice(0, authority.length - hostPort.length);
  // The userinfo ends with the only unescaped @ an authority can have:
  if (/[[\]]/.test(userinfo) || userinfo.slice(0, -1).includes("@")) {
    return false;
  }
  if (!/[[\]]/.test(hostPort)) return /^[^:]*(?::[0-9]*)?$/.test(hostPort);
  const match = IP_LITERAL_PATTERN.exec(hostPort);
  if (match == null) return false;
  const literal = match[1];
  return (
    IP_FUTURE_PATTERN.test(literal) ||
    // The WHATWG URL parser accepts IPv6 addresses, but not IPvFuture:
    URL.canParse(`http://[${literal}]/`)
  );
}

/**
 * Implements the `getRawPropertyValues()` function generated into every
 * vocabulary module.
 *
 * @param object The vocabulary object to read.
 * @param propertyIri The full IRI of the property.
 * @param functionName The name of the public function, used in messages.
 * @returns Deep copies of the property's values in expanded JSON-LD.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export async function readRawPropertyValues(
  object: unknown,
  propertyIri: unknown,
  functionName: string,
): Promise<RawPropertyValue[]> {
  const candidates = parseRawPropertyIri(propertyIri, functionName);
  const method =
    object == null || typeof object !== "object"
      ? undefined
      : (object as Record<symbol, unknown>)[RAW_PROPERTY_PROTOCOL];
  if (typeof method !== "function") {
    throw new TypeError(
      `${functionName}() expects a vocabulary object generated by ` +
        "@fedify/vocab-tools.",
    );
  }
  const values = await (method as RawPropertyProtocolMethod).call(
    object as object,
    { candidates, stack: new Set([object as object]) },
  );
  return copyJsonValue(values) as RawPropertyValue[];
}

/** The independent, cross-module raw write protocol. @internal */
export const RAW_PROPERTY_WRITE_PROTOCOL: unique symbol = Symbol.for(
  "@fedify/vocab-runtime.rawPropertyWriteProtocol.v1",
) as never;

/** A synchronously captured raw write. @internal */
export interface RawPropertyWriteEntry {
  readonly candidates: readonly string[];
  readonly values: readonly unknown[];
}

/** Validates and snapshots plain JSON without recursion or depth limits. */
function snapshotJson(value: unknown): unknown {
  let result: unknown;
  const active = new WeakSet<object>();
  const completed = new WeakMap<object, object>();
  const pending: {
    value: unknown;
    assign: (value: unknown) => void;
    exit?: object;
  }[] = [
    {
      value,
      assign: (copy) => {
        result = copy;
      },
    },
  ];
  while (pending.length > 0) {
    const task = pending.pop()!;
    if (task.exit != null) {
      active.delete(task.exit);
      task.assign(undefined);
      continue;
    }
    const input = task.value;
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean" ||
      (typeof input === "number" && Number.isFinite(input))
    ) {
      task.assign(input);
      continue;
    }
    if (typeof input !== "object" || input == null) {
      throw new TypeError("Raw property values must contain only plain JSON.");
    }
    const array = Array.isArray(input);
    if (array && Object.getPrototypeOf(input) !== Array.prototype) {
      throw new TypeError(
        "Raw property values must contain only plain JSON arrays.",
      );
    }
    if (
      !array &&
      Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null
    ) {
      throw new TypeError(
        "Raw property values must contain only plain JSON objects.",
      );
    }
    if (active.has(input))
      throw new TypeError("Raw property values must not contain cycles.");
    const existing = completed.get(input);
    if (existing != null) {
      task.assign(existing);
      continue;
    }
    active.add(input);
    const copy: Record<string, unknown> | unknown[] = array ? [] : {};
    task.assign(copy);
    pending.push({
      value: undefined,
      exit: input,
      assign: () => {
        Object.freeze(copy);
        completed.set(input, copy);
      },
    });
    const keys = Reflect.ownKeys(input);
    if (array && keys.length !== (input as unknown[]).length + 1) {
      throw new TypeError("Raw property arrays must be dense JSON arrays.");
    }
    // Stack tasks run last-in first-out; reverse pushes preserve JSON key order.
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
      if (
        typeof key !== "string" ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        (array &&
          (!/^(0|[1-9][0-9]*)$/.test(key) ||
            Number(key) >= (input as unknown[]).length))
      ) {
        throw new TypeError(
          "Raw property values must not contain accessors or non-JSON members.",
        );
      }
      pending.push({
        value: descriptor.value,
        assign: (child) => {
          Object.defineProperty(copy, key, {
            value: child,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        },
      });
    }
  }
  return result;
}

/** Checks expanded value/list/node shapes, treating JSON literals as opaque. */
function validateExpandedValues(values: readonly unknown[]): void {
  // Node-only positions (graph, included, reverse) impose stricter rules
  // than property/list values, so sharing must be memoized separately.
  const visitedValues = new WeakSet<object>();
  const visitedNodes = new WeakSet<object>();
  const visitedIncludedArrays = new WeakSet<object>();
  const pending = [...values].map((value) => ({
    value,
    nodeOnly: false,
  }));
  const fail = (): never => {
    throw new TypeError("Expected expanded JSON-LD raw property values.");
  };
  const pushNodes = (
    value: unknown,
    nodeOnly = false,
    included = false,
  ): void => {
    if (!Array.isArray(value)) fail();
    // @included requires subjects, unlike graph/reverse positions which also
    // accept references. Check before either array or node memoization can
    // reuse validation performed in one of those less restrictive positions.
    if (included && !visitedIncludedArrays.has(value as object)) {
      for (const subject of value as unknown[]) {
        if (
          subject != null &&
          typeof subject === "object" &&
          Object.hasOwn(subject, "@id") &&
          Object.keys(subject).length === 1
        )
          fail();
      }
      visitedIncludedArrays.add(value as object);
    }
    const visited = nodeOnly ? visitedNodes : visitedValues;
    if (visited.has(value as object)) return;
    visited.add(value as object);
    for (const child of value as unknown[])
      pending.push({ value: child, nodeOnly });
  };
  const expandedKey = (key: string): boolean =>
    key.startsWith("_:") ||
    (SCHEME_PATTERN.test(key) &&
      isIriSyntax(key.substring(key.indexOf(":") + 1)));
  while (pending.length > 0) {
    const { value, nodeOnly } = pending.pop()!;
    if (value == null || typeof value !== "object" || Array.isArray(value))
      fail();
    const visited = nodeOnly ? visitedNodes : visitedValues;
    if (visited.has(value as object)) continue;
    visited.add(value as object);
    const node = value as Record<string, unknown>;
    const valueObject = Object.hasOwn(node, "@value");
    const listObject = Object.hasOwn(node, "@list");
    if (
      (valueObject && listObject) ||
      (nodeOnly && (valueObject || listObject))
    )
      fail();
    if (valueObject) {
      const allowed = new Set([
        "@value",
        "@type",
        "@language",
        "@direction",
        "@index",
      ]);
      if (Object.keys(node).some((key) => !allowed.has(key))) fail();
      if (node["@type"] === "@json") {
        if ("@language" in node || "@direction" in node) fail();
      } else {
        const scalar = node["@value"];
        if (scalar === null || typeof scalar === "object") fail();
        if (
          "@type" in node &&
          (typeof node["@type"] !== "string" ||
            !expandedKey(node["@type"] as string) ||
            (node["@type"] as string).startsWith("_:") ||
            "@language" in node ||
            "@direction" in node)
        )
          fail();
        if (
          ("@language" in node || "@direction" in node) &&
          typeof scalar !== "string"
        )
          fail();
        if ("@language" in node && typeof node["@language"] !== "string")
          fail();
        if (
          "@direction" in node &&
          node["@direction"] !== "ltr" &&
          node["@direction"] !== "rtl"
        )
          fail();
      }
      if ("@index" in node && typeof node["@index"] !== "string") fail();
      continue;
    }
    if (listObject) {
      if (Object.keys(node).some((key) => key !== "@list" && key !== "@index"))
        fail();
      if ("@index" in node && typeof node["@index"] !== "string") fail();
      pushNodes(node["@list"]);
      continue;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "@id" || key === "@index") {
        if (typeof child !== "string") fail();
      } else if (key === "@type") {
        if (
          !Array.isArray(child) ||
          child.some((type) => typeof type !== "string" || !expandedKey(type))
        )
          fail();
      } else if (key === "@graph" || key === "@included") {
        pushNodes(child, true, key === "@included");
      } else if (key === "@reverse") {
        if (child == null || typeof child !== "object" || Array.isArray(child))
          fail();
        for (const [reverseKey, reverseValues] of Object.entries(
          child as object,
        )) {
          if (!expandedKey(reverseKey)) fail();
          pushNodes(reverseValues, true);
        }
      } else {
        if (!expandedKey(key)) fail();
        pushNodes(child);
      }
    }
  }
}

/** Snapshots entries before dispatching into the object's owning module. @internal */
export async function writeRawPropertyValues<T extends object>(
  object: T,
  entries: unknown,
  functionName: string,
): Promise<T> {
  if (entries == null || typeof entries !== "object") {
    throw new TypeError(
      "Raw property entries must be a record or an iterable of pairs.",
    );
  }
  const captured: RawPropertyWriteEntry[] = [];
  const capture = (iri: unknown, value: unknown): void => {
    const candidates = parseRawPropertyIri(iri, functionName);
    if (value != null && !Array.isArray(value)) {
      throw new TypeError(
        "Raw property values must be an array, null, or undefined.",
      );
    }
    const values =
      value == null ? [] : (snapshotJson(value) as readonly unknown[]);
    validateExpandedValues(values);
    captured.push({ candidates, values });
  };
  if (Symbol.iterator in entries) {
    if (typeof (entries as Iterable<unknown>)[Symbol.iterator] !== "function") {
      throw new TypeError(
        "Raw property entries must have a callable iterator.",
      );
    }
    for (const pair of entries as Iterable<unknown>) {
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new TypeError("Raw property entries must be pairs.");
      }
      const descriptors = Object.getOwnPropertyDescriptors(pair);
      if (
        !("value" in (descriptors["0"] ?? {})) ||
        !("value" in (descriptors["1"] ?? {}))
      ) {
        throw new TypeError("Raw property pairs must have data members.");
      }
      capture(descriptors["0"].value, descriptors["1"].value);
    }
  } else {
    if (
      Object.getPrototypeOf(entries) !== Object.prototype &&
      Object.getPrototypeOf(entries) !== null
    ) {
      throw new TypeError("Raw property entries must be a plain record.");
    }
    for (const key of Object.keys(entries)) {
      const descriptor = Object.getOwnPropertyDescriptor(entries, key)!;
      if (!("value" in descriptor))
        throw new TypeError("Raw property entries must not be accessors.");
      capture(key, descriptor.value);
    }
  }
  const method =
    object != null && typeof object === "object"
      ? (object as Record<symbol, unknown>)[RAW_PROPERTY_WRITE_PROTOCOL]
      : undefined;
  if (typeof method !== "function") {
    throw new TypeError(
      `${functionName}() requires a vocabulary object generated with raw property write support.`,
    );
  }
  return (await method.call(object, captured)) as T;
}
