/**
 * `Accept-Signature` header parsing, serialization, and validation utilities
 * for RFC 9421 §5 challenge-response negotiation.
 *
 * @module
 */
import {
  compactObject,
  concat,
  entries,
  evolve,
  filter,
  fromEntries,
  isArray,
  map,
  pick,
  pipe,
  toArray,
  uniq,
} from "@fxts/core";
import { getLogger, type Logger } from "@logtape/logtape";
import {
  decodeDict,
  type Dictionary,
  encodeDict,
  Item,
} from "structured-field-values";

/**
 * Signature metadata parameters that may appear in an
 * `Accept-Signature` member, as defined in
 * [RFC 9421 §5.1](https://www.rfc-editor.org/rfc/rfc9421#section-5.1).
 *
 * @since 2.1.0
 */
export interface AcceptSignatureParameters {
  /**
   * If present, the signer is requested to use the indicated key
   * material to create the target signature.
   */
  keyid?: string;

  /**
   * If present, the signer is requested to use the indicated algorithm
   * from the HTTP Signature Algorithms registry.
   */
  alg?: string;

  /**
   * If `true`, the signer is requested to generate and include a
   * creation timestamp.  This parameter has no associated value in the
   * wire format.
   */
  created?: true;

  /**
   * If `true`, the signer is requested to generate and include an
   * expiration timestamp.  This parameter has no associated value in
   * the wire format.
   */
  expires?: true;

  /**
   * If present, the signer is requested to include this value as the
   * signature nonce in the target signature.
   */
  nonce?: string;

  /**
   * If present, the signer is requested to include this value as the
   * signature tag in the target signature.
   */
  tag?: string;
}

/**
 * Represents a single member of the `Accept-Signature` Dictionary
 * Structured Field, as defined in
 * [RFC 9421 §5.1](https://www.rfc-editor.org/rfc/rfc9421#section-5.1).
 *
 * @since 2.1.0
 */
export interface AcceptSignatureMember {
  /**
   * The label that uniquely identifies the requested message signature
   * within the context of the target HTTP message (e.g., `"sig1"`).
   */
  label: string;

  /**
   * The set of covered component identifiers for the target message
   * (e.g., `["@method", "@target-uri", "@authority",
   * "content-digest"]`).
   */
  components: string[];

  /**
   * Optional signature metadata parameters requested by the verifier.
   */
  parameters: AcceptSignatureParameters;
}

/**
 * Parses an `Accept-Signature` header value (RFC 9421 §5.1) into an
 * array of {@link AcceptSignatureMember} objects.
 *
 * The `Accept-Signature` field is a Dictionary Structured Field
 * (RFC 8941 §3.2).  Each dictionary member describes a single
 * requested message signature.
 *
 * On parse failure (malformed or empty header), returns an empty array.
 *
 * @param header The raw `Accept-Signature` header value string.
 * @returns An array of parsed members.  Empty if the header is
 *          malformed or empty.
 * @since 2.1.0
 */
export function parseAcceptSignature(
  header: string,
): AcceptSignatureMember[] {
  try {
    return pipe(
      header,
      decodeDict,
      parseEachSignature,
      toArray,
    ) as AcceptSignatureMember[];
  } catch {
    return [];
  }
}

const parseEachSignature = (
  dict: Dictionary,
): IterableIterator<AcceptSignatureMember> =>
  pipe(
    dict,
    entries,
    filter(([_, item]) => isArray(item.value)),
    map(([label, item]) =>
      ({
        label,
        components: item.value
          .map((subitem: Item) => subitem.value)
          .filter((v: unknown): v is string => typeof v === "string"),
        parameters: extractParams(item),
      }) as AcceptSignatureMember
    ),
  ) as IterableIterator<AcceptSignatureMember>;

const extractParams = (
  item: { params: AcceptSignatureParameters },
): AcceptSignatureParameters =>
  pipe(
    item.params ?? {},
    pick(["keyid", "alg", "created", "expires", "nonce", "tag"]),
    evolve({
      keyid: stringOrUndefined,
      alg: stringOrUndefined,
      created: trueOrUndefined,
      expires: trueOrUndefined,
      nonce: stringOrUndefined,
      tag: stringOrUndefined,
    }),
    compactObject,
  ) as AcceptSignatureParameters;

const stringOrUndefined = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const trueOrUndefined = (
  v: unknown,
): true | undefined => (v === true ? true : undefined);

/**
 * Serializes an array of {@link AcceptSignatureMember} objects into an
 * `Accept-Signature` header value string (RFC 9421 §5.1).
 *
 * The output is a Dictionary Structured Field (RFC 8941 §3.2).
 *
 * @param members The members to serialize.
 * @returns The serialized header value string.
 * @since 2.1.0
 */
export function formatAcceptSignature(
  members: AcceptSignatureMember[],
): string {
  return pipe(
    members,
    map((member) =>
      [
        member.label,
        new Item(
          extractComponents(member),
          extractParameters(member),
        ),
      ] as const
    ),
    fromEntries,
    encodeDict,
  );
}

const extractComponents = (member: AcceptSignatureMember): Item[] =>
  member.components.map((c) => new Item(c, {}));
const extractParameters = (
  member: AcceptSignatureMember,
): AcceptSignatureParameters =>
  pipe(
    member.parameters,
    pick(["keyid", "alg", "created", "expires", "nonce", "tag"]),
    compactObject,
  );

/**
 * Filters out {@link AcceptSignatureMember} entries whose covered
 * components include response-only identifiers (`@status`) that are
 * not applicable to request-target messages, as required by
 * [RFC 9421 §5](https://www.rfc-editor.org/rfc/rfc9421#section-5).
 *
 * A warning is logged for each discarded entry.
 *
 * @param members The parsed `Accept-Signature` entries to validate.
 * @returns Only entries that are valid for request-target messages.
 * @since 2.1.0
 */
export function validateAcceptSignatureForRequest(
  members: AcceptSignatureMember[],
): AcceptSignatureMember[] {
  const logger = getLogger(["fedify", "sig", "http"]);
  return members.filter((member) =>
    !member.components.includes("@status")
      ? true
      : logLabel(logger, member.label) || false
  );
}

const logLabel = (logger: Logger, label: string): undefined =>
  logger.warn(
    "Discarding Accept-Signature member {label}: " +
      "covered components include response-only identifier @status.",
    { label },
  ) as undefined;

/**
 * The result of {@link fulfillAcceptSignature}.  This can be used directly
 * as the `rfc9421` option of {@link SignRequestOptions}.
 * @since 2.1.0
 */
export interface FulfillAcceptSignatureResult {
  /** The label for the signature. */
  label: string;
  /** The merged set of covered component identifiers. */
  components: string[];
  /** The nonce requested by the challenge, if any. */
  nonce?: string;
  /** The tag requested by the challenge, if any. */
  tag?: string;
}

/**
 * The minimum set of covered component identifiers that Fedify always
 * includes in RFC 9421 signatures for security.
 */
const MINIMUM_COMPONENTS = ["@method", "@target-uri", "@authority"];

/**
 * Attempts to translate an {@link AcceptSignatureMember} challenge into
 * RFC 9421 signing options that the local signer can fulfill.
 *
 * Returns `null` if the challenge cannot be fulfilled—for example, if
 * the requested `alg` or `keyid` is incompatible with the local key.
 *
 * Safety constraints:
 * - `alg`: only honored if it matches `localAlg`.
 * - `keyid`: only honored if it matches `localKeyId`.
 * - `components`: merged with the minimum required set
 *   (`@method`, `@target-uri`, `@authority`).
 * - `nonce` and `tag` are passed through directly.
 *
 * @param entry The challenge entry from the `Accept-Signature` header.
 * @param localKeyId The local key identifier (e.g., the actor key URL).
 * @param localAlg The algorithm of the local private key
 *                 (e.g., `"rsa-v1_5-sha256"`).
 * @returns Signing options if the challenge can be fulfilled, or `null`.
 * @since 2.1.0
 */
export function fulfillAcceptSignature(
  entry: AcceptSignatureMember,
  localKeyId: string,
  localAlg: string,
): FulfillAcceptSignatureResult | null {
  // Check algorithm compatibility
  if (entry.parameters.alg != null && entry.parameters.alg !== localAlg) {
    return null;
  }
  // Check key ID compatibility
  if (
    entry.parameters.keyid != null && entry.parameters.keyid !== localKeyId
  ) {
    return null;
  }
  return {
    label: entry.label,
    components: concatMinimumComponents(entry.components),
    nonce: entry.parameters.nonce,
    tag: entry.parameters.tag,
  };
}

/** Merge components: challenge components + minimum required set */
const concatMinimumComponents = (components: string[]): string[] =>
  pipe(MINIMUM_COMPONENTS, concat(components), uniq, toArray);

// cspell: ignore keyid
