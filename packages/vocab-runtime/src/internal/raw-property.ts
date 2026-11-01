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

function deepFreeze<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
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
    retained[key] = structuredClone(value);
  }
  return retained == null ? undefined : deepFreeze(retained);
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
// deno-lint-ignore no-control-regex
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
    INVALID_CHAR_PATTERN.test(rest) || INVALID_PERCENT_PATTERN.test(rest) ||
    LONE_SURROGATE_PATTERN.test(rest)
  ) {
    return false;
  }
  const fragmentIndex = rest.indexOf("#");
  if (fragmentIndex >= 0 && rest.indexOf("#", fragmentIndex + 1) >= 0) {
    return false;
  }
  // Square brackets may only delimit an IP literal in the authority:
  let path = rest;
  if (rest.startsWith("//")) {
    const end = rest.slice(2).search(/[/?#]/);
    path = end < 0 ? "" : rest.slice(2 + end);
  }
  return !path.includes("[") && !path.includes("]");
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
  const method = object == null || typeof object !== "object"
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
  return structuredClone(values) as RawPropertyValue[];
}
