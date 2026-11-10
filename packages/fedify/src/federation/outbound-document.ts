import { preloadedContexts } from "@fedify/vocab-runtime";
import type {
  OutboundJsonValue,
  OutboundSenderPayload,
} from "./outbound-report.ts";

const asContext = "https://www.w3.org/ns/activitystreams";
const asNamespace = `${asContext}#`;
const blind = new Set([
  "bto",
  "bcc",
  "as:bto",
  "as:bcc",
  `${asNamespace}bto`,
  `${asNamespace}bcc`,
]);
const contextCandidates = [
  asContext,
  "https://w3id.org/security/v1",
  "https://w3id.org/identity/v1",
  "https://gotosocial.org/ns",
  "https://w3id.org/fep/171b",
  "https://w3id.org/security/data-integrity/v1",
  "https://w3id.org/security/data-integrity/v2",
];

// This audit is specific to blind addressing, unlike the attachment/Public
// normalization predicates. Unknown definitions never trigger context loading.
function safeContext(context: unknown): boolean {
  if (Array.isArray(context)) return context.every(safeContext);
  if (context == null || typeof context !== "object") return false;
  for (const [name, definition] of Object.entries(context)) {
    if (name === "@import") return false;
    const mapping =
      typeof definition === "string"
        ? definition
        : definition != null && typeof definition === "object"
          ? (definition as Record<string, unknown>)["@id"]
          : undefined;
    if (name === "as" && mapping !== asNamespace) return false;
    if (
      name !== "as" &&
      typeof mapping === "string" &&
      mapping.startsWith(asNamespace) &&
      (mapping.endsWith("#") ||
        mapping.endsWith("/") ||
        (typeof definition === "object" &&
          (definition as Record<string, unknown>)["@prefix"] === true))
    )
      return false;
    if (
      typeof mapping === "string" &&
      blind.has(mapping) &&
      name !== "bto" &&
      name !== "bcc"
    )
      return false;
    if (
      (name === "bto" || name === "bcc") &&
      mapping !== `as:${name}` &&
      mapping !== `${asNamespace}${name}`
    )
      return false;
    if (
      name === "@vocab" &&
      typeof mapping === "string" &&
      mapping.startsWith(asNamespace)
    )
      return false;
    if (
      definition != null &&
      typeof definition === "object" &&
      "@context" in definition &&
      !safeContext((definition as Record<string, unknown>)["@context"])
    )
      return false;
  }
  return true;
}
const contexts = new Set(
  contextCandidates.filter((url) => {
    const document = preloadedContexts[url];
    return (
      document != null &&
      typeof document === "object" &&
      safeContext((document as Record<string, unknown>)["@context"])
    );
  }),
);
// Exact generated extension definitions, not an interpreter for arbitrary inline
// contexts. In particular, callers cannot redefine prefixes or add blind aliases.
const generatedTerms: Record<string, unknown> = {
  toot: "http://joinmastodon.org/ns#",
  misskey: "https://misskey-hub.net/ns#",
  fedibird: "http://fedibird.com/ns#",
  sensitive: "as:sensitive",
  votersCount: {
    "@id": "toot:votersCount",
    "@type": "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
  },
  Emoji: "toot:Emoji",
  Hashtag: "as:Hashtag",
  ChatMessage: "http://litepub.social/ns#ChatMessage",
  quote: { "@id": "https://w3id.org/fep/044f#quote", "@type": "@id" },
  quoteUrl: "as:quoteUrl",
  _misskey_quote: "misskey:_misskey_quote",
  quoteUri: "fedibird:quoteUri",
  QuoteAuthorization: "https://w3id.org/fep/044f#QuoteAuthorization",
  QuoteRequest: "https://w3id.org/fep/044f#QuoteRequest",
  quoteAuthorization: {
    "@id": "https://w3id.org/fep/044f#quoteAuthorization",
    "@type": "@id",
  },
  emojiReactions: { "@id": "fedibird:emojiReactions", "@type": "@id" },
  contextHistory: {
    "@id": "https://w3id.org/fep/171b/contextHistory",
    "@type": "@id",
  },
};
function sameDefinition(value: OutboundJsonValue, expected: unknown): boolean {
  if (value === expected) return true;
  if (
    value == null ||
    expected == null ||
    typeof value !== "object" ||
    typeof expected !== "object" ||
    Array.isArray(value)
  )
    return false;
  const actual = value as Record<string, OutboundJsonValue>;
  const reference = expected as Record<string, unknown>;
  return (
    Object.keys(actual).length === Object.keys(reference).length &&
    Object.keys(actual).every(
      (name) =>
        Object.hasOwn(reference, name) &&
        sameDefinition(actual[name], reference[name]),
    )
  );
}
function generatedContext(value: OutboundJsonValue): boolean {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([name, definition]) =>
      Object.hasOwn(generatedTerms, name) &&
      sameDefinition(definition, generatedTerms[name]),
  );
}
const keywords = new Set([
  "@id",
  "@type",
  "@value",
  "@language",
  "@direction",
  "@index",
  "@list",
  "@set",
  "@graph",
  "@reverse",
  "@included",
  "@nest",
]);

/** Validate the explicit opt-in before replacing observer registration. */
export function snapshotSenderPayloadOption(
  value: boolean | undefined,
): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new TypeError("Outbound senderPayload must be a boolean.");
  }
  return value;
}

/** Project existing plain JSON only; no getters, JSON-LD processing or serializers. */
export function projectSenderPayload(input: unknown): OutboundSenderPayload {
  try {
    let compact = false;
    let redacted = false;
    const seen = new WeakSet<object>();
    const copy = (
      value: unknown,
      depth: number,
      contextData = false,
    ): OutboundJsonValue => {
      if (depth >= 64) throw new TypeError("Unsafe document depth.");
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
      )
        return value;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value !== "object" || value == null || seen.has(value)) {
        throw new TypeError("Not independent JSON data.");
      }
      const array = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      if (
        array
          ? prototype !== Array.prototype
          : prototype !== Object.prototype && prototype !== null
      )
        throw new TypeError("Unsupported document object.");
      seen.add(value);
      try {
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.hasOwn(descriptors, "toJSON")) {
          throw new TypeError("Custom JSON conversion is not projected.");
        }
        const names = Reflect.ownKeys(descriptors).filter(
          (name) => descriptors[name as string].enumerable,
        );
        if (
          names.some(
            (name) =>
              typeof name !== "string" || !("value" in descriptors[name]),
          )
        )
          throw new TypeError("Not plain JSON properties.");
        let contextValue: OutboundJsonValue | undefined;
        if (!contextData && !array && descriptors["@context"]?.enumerable) {
          const context = copy(descriptors["@context"].value, depth + 1, true);
          contextValue = context;
          const urls = typeof context === "string" ? [context] : context;
          if (
            !Array.isArray(urls) ||
            urls.length === 0 ||
            (depth === 0 ? !urls.includes(asContext) : !compact) ||
            !urls.every((url) =>
              typeof url === "string"
                ? contexts.has(url)
                : depth === 0 && generatedContext(url),
            )
          ) {
            throw new TypeError("Unsupported document context.");
          }
          compact = true;
        }
        if (array) {
          const length = descriptors.length.value as number;
          if (
            names.length !== length ||
            names.some((name, index) => name !== String(index))
          )
            throw new TypeError("Not a JSON array.");
          return Object.freeze(
            names.map((name) =>
              copy(descriptors[name as string].value, depth + 1, contextData),
            ),
          );
        }
        const result: Record<string, OutboundJsonValue> = Object.create(null);
        for (const name of names as string[]) {
          if (contextData) {
            result[name] = copy(descriptors[name].value, depth + 1, true);
            continue;
          }
          if (name === "@context") {
            if (contextValue === undefined || !compact) {
              throw new TypeError("Scoped context not supported.");
            }
            result[name] = contextValue!;
            continue;
          }
          if (
            !compact &&
            !keywords.has(name) &&
            !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(name)
          )
            throw new TypeError("Unresolved document property.");
          const next = copy(descriptors[name].value, depth + 1);
          if (blind.has(name)) {
            redacted = true;
            continue;
          }
          result[name] = next;
        }
        return Object.freeze(result);
      } finally {
        seen.delete(value);
      }
    };
    if (input == null || typeof input !== "object") {
      throw new TypeError("Not an outgoing document.");
    }
    const value = copy(input, 0);
    return Object.freeze({
      stage: "sender-payload",
      type: "available",
      representation: "privacy-projection",
      redacted,
      value,
    });
  } catch {
    return Object.freeze({
      stage: "sender-payload",
      type: "unavailable",
      reason: "privacy-filter-unavailable",
    });
  }
}
