// @ts-ignore TS7016
import jsonld from "jsonld";
import type { DocumentLoader } from "../runtime/docloader.ts";
import { getNormalizationContextLoader } from "../sig/ld.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function normalizeDateTimeLiteral(value: string): string {
  return value.substring(19).match(/[Z+-]/) ? value : value + "Z";
}

function isMalformedDateTimeLiteral(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    Temporal.Instant.from(normalizeDateTimeLiteral(value));
    return false;
  } catch {
    return true;
  }
}

function isMalformedDurationLiteral(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    Temporal.Duration.from(value);
    return false;
  } catch {
    return true;
  }
}

const TEMPORAL_DATE_TIME_IRIS = new Set([
  "https://www.w3.org/ns/activitystreams#deleted",
  "https://www.w3.org/ns/activitystreams#endTime",
  "https://www.w3.org/ns/activitystreams#published",
  "https://www.w3.org/ns/activitystreams#startTime",
  "https://www.w3.org/ns/activitystreams#updated",
  "http://purl.org/dc/terms/created",
  "https://w3id.org/security#created",
]);

const TEMPORAL_DURATION_IRIS = new Set([
  "https://www.w3.org/ns/activitystreams#duration",
]);

const QUESTION_CLOSED_IRI = "https://www.w3.org/ns/activitystreams#closed";
const XSD_DATE_TIME_IRI = "http://www.w3.org/2001/XMLSchema#dateTime";

function hasMalformedExpandedDateTimeLiteral(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasMalformedExpandedDateTimeLiteral);
  }
  return isPlainObject(value) && "@value" in value &&
    isMalformedDateTimeLiteral(value["@value"]);
}

function hasMalformedExpandedQuestionClosedLiteral(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasMalformedExpandedQuestionClosedLiteral);
  }
  if (!isPlainObject(value) || !("@value" in value)) return false;
  const literal = value["@value"];
  if (typeof literal === "boolean") return false;
  if (typeof literal !== "string") return false;
  // Mirror the generated Question.closed decoder semantics: values that are
  // not even date-like are ignored by the parser, but only xsd:dateTime
  // literals
  // that pass the Date gate and then fail Temporal.Instant.from() still raise
  // RangeError and therefore belong in this boundary recovery path.
  if (value["@type"] !== XSD_DATE_TIME_IRI) return false;
  if (new Date(literal).toString() === "Invalid Date") return false;
  return isMalformedDateTimeLiteral(literal);
}

function hasMalformedExpandedDurationLiteral(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasMalformedExpandedDurationLiteral);
  }
  return isPlainObject(value) && "@value" in value &&
    isMalformedDurationLiteral(value["@value"]);
}

function hasMalformedKnownTemporalLiteralInternal(
  value: unknown,
  visited: Set<object>,
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) =>
      hasMalformedKnownTemporalLiteralInternal(item, visited)
    );
  }
  if (!isPlainObject(value)) return false;
  if (visited.has(value)) return false;
  visited.add(value);

  // expanded JSON-LD value objects may contain arbitrary raw JSON for @json
  // typed literals inside @value.  Treat those as opaque so the boundary check
  // does not reinterpret extension blobs as ActivityPub structure.
  if ("@value" in value) return false;

  for (const [key, child] of Object.entries(value)) {
    if (TEMPORAL_DATE_TIME_IRIS.has(key)) {
      if (hasMalformedExpandedDateTimeLiteral(child)) return true;
      continue;
    }
    if (key === QUESTION_CLOSED_IRI) {
      if (hasMalformedExpandedQuestionClosedLiteral(child)) return true;
      continue;
    }
    if (TEMPORAL_DURATION_IRIS.has(key)) {
      if (hasMalformedExpandedDurationLiteral(child)) return true;
      continue;
    }
    if (hasMalformedKnownTemporalLiteralInternal(child, visited)) return true;
  }
  return false;
}

export async function hasMalformedKnownTemporalLiteral(
  value: unknown,
  contextLoader: DocumentLoader | undefined,
): Promise<boolean> {
  // Patch releases should not change the exception types thrown by the public
  // parsers just to distinguish malformed Temporal literals from transient
  // loader / KV failures.  Instead, after a parser raises RangeError we do a
  // best-effort JSON-LD expansion pass at the inbox boundary and only restore
  // the old 400/drop semantics when expansion positively proves that one of
  // ActivityPub's or DataIntegrityProof's well-known temporal IRIs carries an
  // invalid literal.  Using jsonld.expand() here is deliberate: it lets this
  // boundary-only check follow aliases, expanded literals, and nested object
  // structure according to JSON-LD semantics instead of reimplementing those
  // rules with another partial compact-form walker.  Keep this set aligned
  // with the generated parser behavior rather than "all date-like fields":
  // for example, as:closed is a boolean-or-date union, so only date-like
  // strings that actually reach Temporal.Instant.from() should be treated as
  // malformed.  Non-date strings are ignored by the parser and therefore must
  // not be over-classified as permanent defects here.
  try {
    const expanded = await jsonld.expand(value, {
      documentLoader: getNormalizationContextLoader(contextLoader),
      keepFreeFloatingNodes: true,
    });
    return hasMalformedKnownTemporalLiteralInternal(expanded, new Set());
  } catch {
    // Expansion may fail for the same transient loader or context-resolution
    // problems that should remain retriable.  Only use this helper as a
    // positive signal for sender-side malformed temporal literals.
    return false;
  }
}
