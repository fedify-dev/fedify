/**
 * `Accept-Signature` header parsing, serialization, and validation utilities
 * for RFC 9421 §5 challenge-response negotiation.
 *
 * @module
 */
import { getLogger, type Logger } from "@logtape/logtape";
import { uniqBy } from "es-toolkit";
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
 * A single covered component identifier from an `Accept-Signature` inner list,
 * as defined in [RFC 9421 §2.1](https://www.rfc-editor.org/rfc/rfc9421#section-2.1)
 * and [§5.1](https://www.rfc-editor.org/rfc/rfc9421#section-5.1).
 *
 * RFC 9421 §5.1 requires that the list of component identifiers includes
 * *all applicable component parameters*.  Parameters such as `;sf`, `;bs`,
 * `;req`, `;tr`, `;name`, and `;key` narrow the meaning of a component
 * identifier and MUST be preserved exactly as received so that the signer
 * can cover the same components the verifier requested.
 *
 * Examples:
 * - `{ value: "@method", params: {} }`
 * - `{ value: "content-type", params: { sf: true } }`
 * - `{ value: "@query-param", params: { name: "foo" } }`
 *
 * @since 2.1.0
 */

export interface AcceptSignatureComponent {
  /**
   * The component identifier name (e.g., `"@method"`, `"content-digest"`,
   * `"@query-param"`).
   */
  value: string;

  /**
   * Component parameters attached to this identifier (e.g., `{ sf: true }`,
   * `{ name: "foo" }`).  An empty object means no parameters were present.
   * Parameters MUST NOT be dropped; doing so would cause the signer to cover
   * a different component than the verifier requested.
   */
  params: Record<string, unknown>;
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
   * The exact list of covered component identifiers requested for the target
   * signature, including all applicable component parameters, as required by
   * [RFC 9421 §5.1](https://www.rfc-editor.org/rfc/rfc9421#section-5.1).
   *
   * Each element is an {@link AcceptSignatureComponent} that preserves
   * both the identifier name and any parameters (e.g., `;sf`, `;name="foo"`).
   * The signer MUST cover exactly these components—with their parameters—when
   * fulfilling the challenge.
   */
  components: AcceptSignatureComponent[];

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
    return parseEachSignature(decodeDict(header));
  } catch {
    getLogger(["fedify", "sig", "http"]).warn(
      "Failed to parse Accept-Signature header: {header}",
      { header },
    );
    return [];
  }
}

const compactObject = <T extends object>(obj: T): T =>
  Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined),
  ) as T;

const parseEachSignature = (dict: Dictionary): AcceptSignatureMember[] =>
  Object.entries(dict)
    .filter(([_, item]) => Array.isArray(item.value))
    .map(([label, item]) => ({
      label,
      components: (item.value as Item[])
        .filter((subitem) => typeof subitem.value === "string")
        .map((subitem) => ({
          value: subitem.value as string,
          params: subitem.params ?? {},
        })),
      parameters: compactParams(item),
    }));

const compactParams = (
  item: { params: AcceptSignatureParameters },
): AcceptSignatureParameters => {
  const { keyid, alg, created, expires, nonce, tag } = item.params ?? {};
  return compactObject({
    keyid: stringOrUndefined(keyid),
    alg: stringOrUndefined(alg),
    created: trueOrUndefined(created),
    expires: trueOrUndefined(expires),
    nonce: stringOrUndefined(nonce),
    tag: stringOrUndefined(tag),
  });
};

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
  const items = members.map((member) =>
    [
      member.label,
      new Item(
        compToItems(member),
        compactParameters(member),
      ),
    ] as const
  );
  return encodeDict(Object.fromEntries(items));
}

const compToItems = (member: AcceptSignatureMember): Item[] =>
  member.components.map((c) => new Item(c.value, c.params));
const compactParameters = (
  member: AcceptSignatureMember,
): AcceptSignatureParameters => {
  const { keyid, alg, created, expires, nonce, tag } = member.parameters;
  return compactObject({ keyid, alg, created, expires, nonce, tag });
};

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
export function validateAcceptSignature(
  members: AcceptSignatureMember[],
): AcceptSignatureMember[] {
  const logger = getLogger(["fedify", "sig", "http"]);
  return members.filter((member) => {
    if (member.components.every((c) => c.value !== "@status")) return true;
    logLabel(logger, member.label);
    return false;
  });
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
  /**
   * The merged set of covered component identifiers, including all component
   * parameters, ready to be passed to the signer.
   */
  components: AcceptSignatureComponent[];
  /** The nonce requested by the challenge, if any. */
  nonce?: string;
  /** The tag requested by the challenge, if any. */
  tag?: string;
}

/**
 * The minimum set of covered component identifiers that Fedify always
 * includes in RFC 9421 signatures for security.
 */
const MINIMUM_COMPONENTS: AcceptSignatureComponent[] = [
  { value: "@method", params: {} },
  { value: "@target-uri", params: {} },
  { value: "@authority", params: {} },
];

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

/**
 * Merge components: minimum required set + challenge components not already
 * covered
 */
const concatMinimumComponents = (
  components: AcceptSignatureComponent[],
): AcceptSignatureComponent[] =>
  uniqBy(MINIMUM_COMPONENTS.concat(components), (c) => c.value);

// cspell: ignore keyid
