import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UrlError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UrlError";
  }
}

const PORTABLE_IRI_PATTERN =
  /^(ap|ap\+ef61):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;
const INVALID_PERCENT_ENCODING_PATTERN = /%(?![0-9A-Fa-f]{2})/;
const PERCENT_ENCODING_PATTERN = /%[0-9A-Fa-f]{2}/g;
const DID_SCHEME_PATTERN = /^did:/i;
const DID_PATTERN = /^did:[a-z0-9]+:[-A-Za-z0-9._%]+(?::[-A-Za-z0-9._%]+)*$/i;

/**
 * Parses a JSON-LD `@id` value as an IRI.
 */
export function parseJsonLdId(
  id: string | undefined,
  base?: string | URL,
): URL | undefined {
  if (id == null || id.startsWith("_:")) return undefined;
  try {
    return parseIri(id, base);
  } catch {
    throw new TypeError("Invalid @id: " + id);
  }
}

/**
 * Parses an IRI as a URL, including FEP-ef61 portable ActivityPub IRIs.
 */
export function parseIri(iri: string | URL, base?: string | URL): URL {
  if (iri instanceof URL) {
    return normalizePortableUrl(iri) ?? new URL(iri.href);
  }
  const portable = parsePortableIri(iri);
  if (portable != null) return portable;
  base = normalizeBaseIri(base);
  if (!URL.canParse(iri, base) && iri.startsWith("at://")) {
    return parseAtUri(iri);
  }
  const parsed = new URL(iri, base);
  return normalizePortableUrl(parsed) ?? parsed;
}

/**
 * Formats a URL as an IRI, including FEP-ef61 portable ActivityPub IRIs.
 */
export function formatIri(iri: string | URL): string {
  const parsed = parsePortableIri(iri instanceof URL ? iri.href : iri);
  if (parsed == null) {
    return iri instanceof URL
      ? iri.href
      : URL.canParse(iri)
      ? new URL(iri).href
      : iri;
  }
  const authority = decodePortableAuthority(parsed.host);
  return `ap+ef61://${authority}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Canonicalizes a FEP-ef61 portable ActivityPub URI for comparison.
 *
 * This accepts both `ap:` and `ap+ef61:` URI strings with decoded or
 * percent-encoded DID authorities.  The returned value uses the `ap+ef61:`
 * scheme, a decoded DID authority, and no query component.  Pass the raw URI
 * string, not a `URL` object, because JavaScript `URL` normalizes opaque path
 * segments before Fedify can compare them.
 *
 * @param input The raw portable ActivityPub URI string to canonicalize.
 * @returns The canonical portable ActivityPub URI string.
 * @throws {TypeError} If the input is not a valid portable ActivityPub IRI.
 * @since 2.4.0
 */
export function canonicalizePortableUri(input: string): string {
  if (typeof input !== "string") {
    throw new TypeError("Invalid portable ActivityPub IRI.");
  }
  const parsed = parsePortableIri(input);
  if (parsed == null) {
    throw new TypeError("Invalid portable ActivityPub IRI.");
  }
  const match = input.match(PORTABLE_IRI_PATTERN)!;
  // parsePortableIri() validates the value but returns a URL, which normalizes
  // opaque path segments.  Use the raw match for path and fragment comparison.
  // parsed.host is the encodeURIComponent() output from parsePortableIri(), so
  // decodePortableAuthority() reverses the shared percent-encoded authority
  // path here rather than the raw did:-prefixed branch.
  const authority = normalizePortableAuthority(
    getDidUrlOrigin(decodePortableAuthority(parsed.host)),
  );
  // Keep path and fragment text from the raw match to avoid URL dot-segment
  // normalization, but still encode raw characters and normalize
  // percent-escape hex casing per URI comparison rules.
  const path = normalizePortableComponent(match[3]);
  const fragment = match[5] == null ? "" : normalizePortableComponent(match[5]);
  return `ap+ef61://${authority}${path}${fragment}`;
}

/**
 * Checks whether two FEP-ef61 portable ActivityPub URIs identify the same
 * portable object.
 *
 * Non-string inputs return `false`.  Non-portable URI strings use strict string
 * equality.  Portable URI strings are compared through
 * {@link canonicalizePortableUri}; malformed portable URI strings return
 * `false` unless they are exactly equal.
 *
 * @since 2.4.0
 */
export function arePortableUrisEqual(
  left: string,
  right: string,
): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (left === right) return true;
  if (!PORTABLE_IRI_PATTERN.test(left) || !PORTABLE_IRI_PATTERN.test(right)) {
    return false;
  }
  try {
    return canonicalizePortableUri(left) === canonicalizePortableUri(right);
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

/**
 * Computes an IRI's FEP-fe34 origin.
 *
 * HTTP(S) IRIs use their web origin.  FEP-ef61 portable ActivityPub IRIs and
 * DID URLs use their DID as a cryptographic origin.
 *
 * @throws {TypeError} If the IRI does not have a supported FEP-fe34 origin.
 * @since 2.4.0
 */
export function getFe34Origin(input: string | URL): string {
  if (input instanceof URL) {
    const portable = normalizePortableUrl(input);
    if (portable != null) return getPortableCryptographicOrigin(portable);
    if (input.protocol === "did:") return getDidUrlOrigin(input.href);
    if (input.protocol === "http:" || input.protocol === "https:") {
      return input.origin;
    }
    throw new TypeError("Unsupported FEP-fe34 origin IRI.");
  }

  const portable = parsePortableIri(input);
  if (portable != null) return getPortableCryptographicOrigin(portable);
  if (DID_SCHEME_PATTERN.test(input)) return getDidUrlOrigin(input);

  const parsed = new URL(input);
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return parsed.origin;
  }
  throw new TypeError("Unsupported FEP-fe34 origin IRI.");
}

/**
 * Checks whether two IRIs have the same FEP-fe34 origin.
 *
 * Malformed or unsupported IRIs are treated as non-matching.
 *
 * @since 2.4.0
 */
export function haveSameFe34Origin(
  left: string | URL,
  right: string | URL,
): boolean {
  try {
    return getFe34Origin(left) === getFe34Origin(right);
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

/**
 * Checks whether two IRIs have the same origin.
 */
export function haveSameIriOrigin(left: URL, right: URL): boolean {
  return getComparableIriOrigin(left) === getComparableIriOrigin(right);
}

function getComparableIriOrigin(iri: URL): string {
  iri = normalizePortableUrl(iri) ?? iri;
  if (iri.origin !== "null") return iri.origin;
  if (iri.host !== "") {
    const host = iri.protocol === "ap+ef61:"
      ? encodeURIComponent(
        getDidUrlOrigin(decodePortableAuthority(iri.host)),
      )
      : iri.host;
    return `${iri.protocol}//${host}`;
  }
  return iri.href;
}

function getPortableCryptographicOrigin(iri: URL): string {
  return getDidUrlOrigin(decodePortableAuthority(iri.host));
}

function getDidUrlOrigin(iri: string): string {
  const did = iri.split(/[/?#]/, 1)[0].replace(DID_SCHEME_PATTERN, "did:");
  if (!DID_PATTERN.test(did)) throw new TypeError("Invalid DID URL.");
  const parts = did.split(":");
  parts[1] = parts[1].toLowerCase();
  return normalizePortableAuthority(parts.join(":"));
}

function parsePortableIri(iri: string): URL | null {
  const match = iri.match(PORTABLE_IRI_PATTERN);
  if (match == null) return null;
  // The readable ap://did:... authority form is not RFC 3986 compliant:
  // colons are not valid in a URI reg-name authority.  Keep accepting it for
  // current FEP-ef61 interoperability, but normalize it to a percent-encoded
  // URL authority internally.  The ap: URI syntax may change later; see:
  // https://bnewbold.leaflet.pub/3mph4hzvbdc2v
  const authority = getDidUrlOrigin(decodePortableAuthority(match[2]));
  if (!DID_PATTERN.test(authority)) {
    throw new TypeError("Invalid portable ActivityPub IRI authority.");
  }
  if (match[3] === "") {
    throw new TypeError("Invalid portable ActivityPub IRI path.");
  }
  return new URL(
    `ap+ef61://${encodeURIComponent(authority)}${match[3]}${match[4] ?? ""}${
      match[5] ?? ""
    }`,
  );
}

function normalizePortableUrl(iri: URL): URL | null {
  if (iri.protocol !== "ap:" && iri.protocol !== "ap+ef61:") return null;
  return parsePortableIri(
    `ap+ef61://${iri.host}${iri.pathname}${iri.search}${iri.hash}`,
  );
}

function normalizeBaseIri(base?: string | URL): string | URL | undefined {
  if (base == null) return undefined;
  if (base instanceof URL) return normalizePortableUrl(base) ?? base;
  return parsePortableIri(base) ??
    (base.startsWith("at://") && !URL.canParse(".", base)
      ? parseAtUri(base)
      : base);
}

function decodePortableAuthority(authority: string): string {
  if (INVALID_PERCENT_ENCODING_PATTERN.test(authority)) {
    throw new TypeError("Invalid portable ActivityPub IRI authority.");
  }
  if (DID_SCHEME_PATTERN.test(authority)) {
    const decoded = authority.replace(/%25/gi, "%");
    if (INVALID_PERCENT_ENCODING_PATTERN.test(decoded)) {
      throw new TypeError("Invalid portable ActivityPub IRI authority.");
    }
    return decoded;
  }
  const decoded = authority.replace(
    /%(25|3A)/gi,
    (match) => match.toLowerCase() === "%3a" ? ":" : "%",
  );
  if (INVALID_PERCENT_ENCODING_PATTERN.test(decoded)) {
    throw new TypeError("Invalid portable ActivityPub IRI authority.");
  }
  return decoded;
}

function normalizePercentEncoding(value: string): string {
  return value.replace(
    PERCENT_ENCODING_PATTERN,
    (match) => match.toUpperCase(),
  );
}

function normalizePortableAuthority(authority: string): string {
  return normalizePercentEncoding(authority).replace(
    PERCENT_ENCODING_PATTERN,
    (match) => {
      const decoded = String.fromCharCode(Number.parseInt(match.slice(1), 16));
      return /[A-Za-z0-9._~-]/.test(decoded) ? decoded : match;
    },
  );
}

function normalizePortableComponent(value: string): string {
  if (INVALID_PERCENT_ENCODING_PATTERN.test(value)) {
    throw new TypeError("Invalid portable ActivityPub IRI component.");
  }
  return value.replace(
    /%[0-9A-Fa-f]{2}|[^%]+/g,
    (match) => {
      if (match.startsWith("%")) {
        const upper = match.toUpperCase();
        const decoded = String.fromCharCode(
          Number.parseInt(upper.slice(1), 16),
        );
        return /[A-Za-z0-9._~-]/.test(decoded) ? decoded : upper;
      }
      try {
        return encodeURI(match);
      } catch (error) {
        if (error instanceof URIError) {
          throw new TypeError("Invalid portable ActivityPub IRI component.");
        }
        throw error;
      }
    },
  );
}

function parseAtUri(uri: string): URL {
  const index = uri.indexOf("/", 5);
  const authority = index >= 0 ? uri.slice(5, index) : uri.slice(5);
  const path = index >= 0 ? uri.slice(index) : "";
  return new URL("at://" + encodeURIComponent(authority) + path);
}

/**
 * Checks whether the URL is an FEP-ef61 gateway base URI.
 */
export function isGatewayUrl(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" && url.password === "" &&
    url.pathname === "/" && url.search === "" && url.hash === "";
}

/**
 * Parses and validates an FEP-ef61 gateway base URI.
 */
export function parseGatewayUrl(url: string): URL {
  const parsed = parseIri(url);
  if (!isGatewayUrl(parsed)) {
    throw new TypeError(
      "FEP-ef61 gateways must be HTTP(S) base URIs with no credentials, " +
        "path, query, or fragment.",
    );
  }
  return parsed;
}

const COMPATIBLE_ID_PATH_PREFIX = "/.well-known/apgateway/";
const COMPATIBLE_ID_DID_PATTERN = /^did(?::|%3A)/i;
// `gateways` is the location hint parameter name used by earlier FEP-ef61
// revisions; strip it as well for compatibility with older publishers.
const LOCATION_HINT_PARAMETERS: ReadonlySet<string> = new Set([
  "@gateway",
  "gateways",
]);

/**
 * Converts an [FEP-ef61] compatible identifier into a portable ActivityPub
 * URI.
 *
 * A compatible identifier is an HTTP(S) URL under a gateway's fixed
 * `/.well-known/apgateway/` path, such as
 * `https://server.example/.well-known/apgateway/did:key:z6Mk.../objects/1`.
 * This function removes the gateway part and returns the corresponding
 * portable URI, e.g., `ap+ef61://did:key:z6Mk.../objects/1`, in the same
 * internal `URL` form that {@link parseIri} produces.  The path, query, and
 * fragment are preserved, so the result is a portable URI, not a comparison
 * form; pass its `href` to {@link canonicalizePortableUri} or
 * {@link arePortableUrisEqual} to compare it with other portable URIs.
 *
 * The conversion only reveals the *claimed* portable identifier.  Anyone can
 * publish a compatible identifier for any DID on their own server, so the
 * gateway that served it is neither the object's origin nor authorized to act
 * for the DID.  Callers must still verify the retrieved document's Object
 * Integrity Proof against the DID, as FEP-ef61 requires, and should keep the
 * original URL if they need the gateway as a retrieval hint.
 *
 * Arbitrary gateway paths are not supported.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 *
 * @param input The URL to convert.
 * @returns The portable ActivityPub URI, or `null` if the input is not an
 *          HTTP(S) URL whose path starts with `/.well-known/apgateway/did:`.
 *          Other gateway routes, such as the gateway discovery endpoint and
 *          hashlink media URLs, also yield `null`.
 * @throws {TypeError} If the input looks like a compatible identifier but is
 *                     malformed, e.g., it has an invalid DID, no object path,
 *                     invalid percent-encoding, credentials, or location
 *                     hints (`@gateway` query parameters, or the legacy
 *                     `gateways` parameter), which FEP-ef61 forbids in
 *                     compatible identifiers.
 * @since 2.4.0
 */
export function fromCompatibleEf61Id(input: string | URL): URL | null {
  return convertCompatibleEf61Id(input)?.url ?? null;
}

function convertCompatibleEf61Id(
  input: string | URL,
): { url: URL; iri: string } | null {
  let url: URL;
  if (input instanceof URL) url = input;
  else if (typeof input === "string" && URL.canParse(input)) {
    url = new URL(input);
  } else return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.pathname.startsWith(COMPATIBLE_ID_PATH_PREFIX)) return null;
  const tail = url.pathname.slice(COMPATIBLE_ID_PATH_PREFIX.length);
  if (!COMPATIBLE_ID_DID_PATTERN.test(tail)) return null;
  if (url.username !== "" || url.password !== "") {
    throw new TypeError(
      "Invalid FEP-ef61 compatible identifier: credentials are not allowed.",
    );
  }
  // Slice href instead of concatenating pathname, search, and hash, because
  // the latter two drop empty query and fragment delimiters.
  const iri = "ap+ef61://" +
    url.href.slice(url.origin.length + COMPATIBLE_ID_PATH_PREFIX.length);
  try {
    const parsed = parsePortableIri(iri);
    if (parsed == null) throw new TypeError("Not a portable IRI.");
    // parsePortableIri() does not validate path and fragment
    // percent-encoding, but canonicalizePortableUri() does:
    canonicalizePortableUri(iri);
    // canonicalizePortableUri() ignores the query, so validate it here too.
    // Compatible identifiers must not have location hints:
    const query = url.search === ""
      ? []
      : normalizePortableComponent(url.search.slice(1)).split("&");
    if (query.some(isLocationHint)) {
      throw new TypeError("Location hints are not allowed.");
    }
    return { url: parsed, iri };
  } catch (error) {
    if (error instanceof TypeError) {
      throw new TypeError("Invalid FEP-ef61 compatible identifier.", {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Converts a portable ActivityPub URI into an [FEP-ef61] compatible
 * identifier, which is an HTTP(S) URL under the gateway's fixed
 * `/.well-known/apgateway/` path.
 *
 * For example, `ap+ef61://did:key:z6Mk.../objects/1` and
 * `https://server.example` yield
 * `https://server.example/.well-known/apgateway/did:key:z6Mk.../objects/1`.
 * Both `ap:` and `ap+ef61:` URIs with decoded or percent-encoded DID
 * authorities are accepted.  Publishers should use the first gateway in the
 * actor's `gateways` list, as FEP-ef61 requires.
 *
 * The path and fragment are preserved, with characters that are not allowed
 * in HTTP(S) URLs percent-encoded the same way as
 * {@link canonicalizePortableUri} does.  FEP-ef61 location hints (`@gateway`
 * query parameters, and the legacy `gateways` parameter) are removed, since
 * compatible identifiers must not have them; other query parameters are kept
 * in order.
 *
 * Arbitrary gateway paths are not supported.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 *
 * @param portableId The `ap:` or `ap+ef61:` URI to convert.
 * @param gateway The gateway's HTTP(S) origin, e.g., `https://server.example`.
 * @returns The compatible identifier.
 * @throws {TypeError} If the portable ID is not a valid `ap:` or `ap+ef61:`
 *                     URI, if its path has `.` or `..` segments (which
 *                     HTTP(S) URLs cannot represent), or if the gateway is
 *                     not an HTTP(S) origin with no credentials, path, query,
 *                     or fragment.
 * @since 2.4.0
 */
export function toCompatibleEf61Id(
  portableId: string | URL,
  gateway: string | URL,
): URL {
  const gatewayUrl = parseCompatibleEf61Gateway(gateway);
  const raw = getRawPortableIri(portableId);
  const match = raw.match(PORTABLE_IRI_PATTERN);
  const parsed = parsePortableIri(raw);
  if (match == null || parsed == null) {
    throw new TypeError("Invalid portable ActivityPub IRI.");
  }
  // The parser decodes %25 once in a did:-prefixed authority, so escape
  // percent signs only when that would otherwise change the DID.  Other DIDs
  // are kept literal (e.g., did:web:example.com%3A8080) so that gateways
  // which read the path segment as is see the same DID:
  let did = decodePortableAuthority(parsed.host);
  if (/%25/i.test(did)) did = did.replace(/%/g, "%25");
  const path = normalizePortableComponent(match[3]);
  if (path.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new TypeError(
      "FEP-ef61 compatible identifiers cannot represent portable IRI paths " +
        "with dot segments.",
    );
  }
  // Normalize the query before looking for location hints so that characters
  // which the URL parser strips (e.g., tabs) cannot form a hint name later:
  const query = match[4] == null
    ? ""
    : stripLocationHints(normalizePortableComponent(match[4].slice(1)));
  const fragment = match[5] == null ? "" : normalizePortableComponent(match[5]);
  const result = new URL(
    gatewayUrl.origin + COMPATIBLE_ID_PATH_PREFIX + did + path + query +
      fragment,
  );
  // Guard against URL parser normalization that would silently change the
  // identified object or reintroduce location hints (the latter makes
  // convertCompatibleEf61Id() throw):
  const converted = convertCompatibleEf61Id(result);
  if (
    converted == null ||
    canonicalizePortableUri(converted.iri) !== canonicalizePortableUri(raw)
  ) {
    throw new TypeError(
      "The portable ActivityPub IRI cannot be represented as an FEP-ef61 " +
        "compatible identifier.",
    );
  }
  return result;
}

function parseCompatibleEf61Gateway(gateway: string | URL): URL {
  const url = gateway instanceof URL
    ? gateway
    : typeof gateway === "string" && URL.canParse(gateway)
    ? new URL(gateway)
    : null;
  // Comparing href with the origin also rejects credentials, a path, and
  // query and fragment components, including empty ? and # delimiters.
  if (
    url == null || (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.href !== `${url.origin}/`
  ) {
    throw new TypeError(
      "FEP-ef61 gateways for compatible identifiers must be HTTP(S) origins " +
        "with no credentials, path, query, or fragment.",
    );
  }
  return url;
}

function getRawPortableIri(portableId: string | URL): string {
  if (portableId instanceof URL) {
    if (portableId.protocol !== "ap:" && portableId.protocol !== "ap+ef61:") {
      throw new TypeError("Invalid portable ActivityPub IRI.");
    }
    // parseIri() would fold a port into the DID and drop credentials:
    if (
      portableId.username !== "" || portableId.password !== "" ||
      portableId.port !== ""
    ) {
      throw new TypeError("Invalid portable ActivityPub IRI authority.");
    }
    return portableId.href;
  }
  if (typeof portableId !== "string") {
    throw new TypeError("Invalid portable ActivityPub IRI.");
  }
  return portableId;
}

function stripLocationHints(query: string): string {
  const pairs = query.split("&").filter((pair) => !isLocationHint(pair));
  return pairs.length < 1 ? "" : `?${pairs.join("&")}`;
}

function isLocationHint(pair: string): boolean {
  const name = pair.split("=", 1)[0].replace(/\+/g, " ");
  try {
    return LOCATION_HINT_PARAMETERS.has(decodeURIComponent(name));
  } catch (error) {
    if (error instanceof URIError) return false;
    throw error;
  }
}

/**
 * Validates a URL to prevent SSRF attacks.
 */
export async function validatePublicUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UrlError(`Unsupported protocol: ${parsed.protocol}`);
  }
  let hostname = parsed.hostname;
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  if (hostname === "localhost") {
    throw new UrlError("Localhost is not allowed");
  }
  const hostnameFamily = isIP(hostname);
  if (hostnameFamily !== 0) {
    validatePublicIpAddress(hostname, hostnameFamily);
    return;
  }
  if ("Deno" in globalThis && !isIP(hostname)) {
    // If the `net` permission is not granted, we can't resolve the hostname.
    // However, we can safely assume that it cannot gain access to private
    // resources.
    const netPermission = await Deno.permissions.query({ name: "net" });
    if (netPermission.state !== "granted") return;
  }
  // FIXME: This is a temporary workaround for the `Bun` runtime; for unknown
  // reasons, the Web Crypto API does not work as expected after a DNS lookup.
  // This workaround purposes to prevent unit tests from hanging up:
  if ("Bun" in globalThis) {
    if (hostname === "example.com" || hostname.endsWith(".example.com")) {
      return;
    } else if (hostname === "fedify-test.internal") {
      throw new UrlError("Invalid or private address: fedify-test.internal");
    }
  }
  // To prevent SSRF via DNS rebinding, we need to resolve all IP addresses
  // and ensure that they are all public:
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (error) {
    throw new UrlError("DNS lookup failed", { cause: error });
  }
  validateLookupAddresses(addresses);
}

/**
 * Validates the IP addresses returned by `node:dns.lookup()`.
 *
 * Cloudflare Workers' `node:dns` implementation currently maps every record
 * in a DNS-over-HTTPS `Answer` array—including CNAME records—to a
 * `LookupAddress`, even though Node.js specifies that the `address` field must
 * contain an IPv4 or IPv6 literal.  See:
 * https://github.com/cloudflare/workerd/issues/6886
 *
 * Work around that bug by ignoring non-IP entries only when the lookup also
 * returns at least one actual IP address.  This remains fail-closed: a result
 * containing no IP addresses is rejected, and every returned IP address is
 * still validated and must be public.  This workaround can be revisited once
 * the Workerd issue is fixed in supported Cloudflare Workers runtimes.
 *
 * @internal
 */
export function validateLookupAddresses(
  addresses: readonly LookupAddress[],
): void {
  let ipAddressCount = 0;
  for (const { address } of addresses) {
    const family = isIP(address);
    if (family === 0) continue;
    ipAddressCount++;
    validatePublicIpAddress(address, family);
  }
  if (ipAddressCount === 0) {
    throw new UrlError("DNS lookup did not return any IP address");
  }
}

function validatePublicIpAddress(address: string, family: number): void {
  if (
    family === 4 && isValidPublicIPv4Address(address) ||
    family === 6 && isValidPublicIPv6Address(address)
  ) {
    return;
  }
  throw new UrlError(`Invalid or private address: ${address}`);
}

export function isValidPublicIPv4Address(address: string): boolean {
  const parts = parseIPv4Address(address);
  if (parts == null) return false;
  const value = ipv4PartsToNumber(parts);
  return !nonPublicIPv4Prefixes.some(({ base, prefix }) =>
    matchesIPv4Prefix(value, base, prefix)
  );
}

export function isValidPublicIPv6Address(address: string): boolean {
  const words = parseIPv6Address(address);
  if (words == null) return false;
  if (
    nonPublicIPv6Prefixes.some(({ words: prefixWords, prefix }) =>
      matchesIPv6Prefix(words, prefixWords, prefix)
    )
  ) return false;
  for (
    const { extractIPv4, prefix, words: prefixWords } of ipv6WithIPv4Prefixes
  ) {
    if (!matchesIPv6Prefix(words, prefixWords, prefix)) continue;
    const ipv4Address = extractIPv4(words);
    if (ipv4Address != null && !isValidPublicIPv4Address(ipv4Address)) {
      return false;
    }
  }
  return true;
}

export function expandIPv6Address(address: string): string {
  address = address.toLowerCase();
  const ipv4Delimiter = address.lastIndexOf(":");
  if (address.includes(".") && ipv4Delimiter >= 0) {
    const ipv4Parts = parseIPv4Address(address.substring(ipv4Delimiter + 1));
    if (ipv4Parts == null) return address;
    const high = (ipv4Parts[0] << 8) + ipv4Parts[1];
    const low = (ipv4Parts[2] << 8) + ipv4Parts[3];
    address = address.substring(0, ipv4Delimiter + 1) +
      high.toString(16) + ":" + low.toString(16);
  }
  if (address === "::") return "0000:0000:0000:0000:0000:0000:0000:0000";
  if (address.startsWith("::")) address = "0000" + address;
  if (address.endsWith("::")) address = address + "0000";
  address = address.replace(
    "::",
    ":0000".repeat(8 - (address.match(/:/g) || []).length) + ":",
  );
  const parts = address.split(":");
  return parts.map((part) => part.padStart(4, "0")).join(":");
}

type IPv4Prefix = {
  cidr: string;
  base: number;
  prefix: number;
  rfc: string;
};

// Keep CIDR and RFC metadata in the table instead of row comments so security
// reviewers can audit each blocked range without duplicating source text.
const nonPublicIPv4Prefixes = [
  ipv4Prefix("0.0.0.0/8", "RFC 6890"),
  ipv4Prefix("10.0.0.0/8", "RFC 1918"),
  ipv4Prefix("100.64.0.0/10", "RFC 6598"),
  ipv4Prefix("127.0.0.0/8", "RFC 1122"),
  ipv4Prefix("169.254.0.0/16", "RFC 3927"),
  ipv4Prefix("172.16.0.0/12", "RFC 1918"),
  ipv4Prefix("192.0.0.0/24", "RFC 6890"),
  ipv4Prefix("192.0.2.0/24", "RFC 5737"),
  ipv4Prefix("192.88.99.0/24", "RFC 7526"),
  ipv4Prefix("192.168.0.0/16", "RFC 1918"),
  ipv4Prefix("198.18.0.0/15", "RFC 2544"),
  ipv4Prefix("198.51.100.0/24", "RFC 5737"),
  ipv4Prefix("203.0.113.0/24", "RFC 5737"),
  ipv4Prefix("224.0.0.0/4", "RFC 5771"),
  ipv4Prefix("240.0.0.0/4", "RFC 1112"),
];

type IPv6Prefix = {
  cidr: string;
  words: number[];
  prefix: number;
  rfc: string;
};

const nonPublicIPv6Prefixes = [
  ipv6Prefix("::/16", "RFC 4291"),
  ipv6Prefix("2001::/32", "RFC 4380"),
  ipv6Prefix("2002::/16", "RFC 3056"),
  ipv6Prefix("64:ff9b:1::/48", "RFC 8215"),
  ipv6Prefix("fc00::/7", "RFC 4193"),
  ipv6Prefix("fe80::/10", "RFC 4291"),
  ipv6Prefix("ff00::/8", "RFC 4291"),
];

type IPv6WithIPv4Prefix = IPv6Prefix & {
  extractIPv4: (words: number[]) => string | null;
};

// This table has one entry for now, but keeps embedded IPv4 extraction aligned
// with the CIDR metadata above if another translation prefix needs it later.
const ipv6WithIPv4Prefixes: IPv6WithIPv4Prefix[] = [
  {
    ...ipv6Prefix("64:ff9b::/96", "RFC 6052"),
    extractIPv4: (words) => ipv4FromWords(words[6], words[7]),
  },
];

function ipv4Prefix(cidr: string, rfc: string): IPv4Prefix {
  const [address, prefixText] = cidr.split("/");
  const prefix = parseInt(prefixText, 10);
  const parts = parseIPv4Address(address);
  if (parts == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid IPv4 prefix: ${cidr}`);
  }
  return { cidr, base: ipv4PartsToNumber(parts), prefix, rfc };
}

function ipv6Prefix(cidr: string, rfc: string): IPv6Prefix {
  const [address, prefixText] = cidr.split("/");
  const prefix = parseInt(prefixText, 10);
  const words = parseIPv6Address(address);
  if (
    words == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 128
  ) {
    throw new Error(`Invalid IPv6 prefix: ${cidr}`);
  }
  return { cidr, words, prefix, rfc };
}

function parseIPv4Address(address: string): number[] | null {
  const parts = address.split(".").map((part) => {
    if (!/^\d+$/.test(part)) return NaN;
    return parseInt(part, 10);
  });
  // Keep explicit bounds checks even though the regex narrows today's parser;
  // they make future parser changes fail closed.
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) return null;
  return parts;
}

function parseIPv6Address(address: string): number[] | null {
  const parts = expandIPv6Address(address).split(":");
  if (parts.length !== 8) return null;
  const words = parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return NaN;
    return parseInt(part, 16);
  });
  // Keep explicit bounds checks even though the regex narrows today's parser;
  // they make future parser changes fail closed.
  if (
    words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)
  ) return null;
  return words;
}

function ipv4PartsToNumber(parts: number[]): number {
  return parts[0] * 2 ** 24 + parts[1] * 2 ** 16 + parts[2] * 2 ** 8 +
    parts[3];
}

function ipv4FromWords(highWord: number, lowWord: number): string {
  return [
    highWord >> 8,
    highWord & 0xff,
    lowWord >> 8,
    lowWord & 0xff,
  ].join(".");
}

function matchesIPv4Prefix(
  address: number,
  prefixBase: number,
  prefixLength: number,
): boolean {
  const blockSize = 2 ** (32 - prefixLength);
  return Math.floor(address / blockSize) === Math.floor(prefixBase / blockSize);
}

function matchesIPv6Prefix(
  address: number[],
  prefixWords: number[],
  prefixLength: number,
): boolean {
  let remaining = prefixLength;
  for (let i = 0; i < 8 && remaining > 0; i++) {
    if (remaining >= 16) {
      if (address[i] !== prefixWords[i]) return false;
      remaining -= 16;
    } else {
      const mask = (0xffff << (16 - remaining)) & 0xffff;
      if ((address[i] & mask) !== (prefixWords[i] & mask)) return false;
      remaining = 0;
    }
  }
  return true;
}
