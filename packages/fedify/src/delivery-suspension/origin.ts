import { validateIdnaHostname } from "./idna.ts";
import type { DeliverySuspensionOrigin, ParseResult } from "./types.ts";

interface HttpsUri {
  readonly host: string;
  readonly bracketed: boolean;
  readonly port: string | undefined;
  readonly suffix: string;
}
function ipv4(host: string): boolean {
  const octets = host.split(".");
  return (
    octets.length === 4 &&
    octets.every(
      (octet) => /^(?:0|[1-9][0-9]{0,2})$/.test(octet) && Number(octet) <= 255,
    )
  );
}
function ipv6(host: string): boolean {
  if (!/^[0-9a-fA-F:.]+$/.test(host)) return false;
  let text = host;
  if (text.includes(".")) {
    const lastColon = text.lastIndexOf(":");
    if (lastColon < 0 || !ipv4(text.slice(lastColon + 1))) return false;
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }
  const compressed = text.includes("::");
  if (compressed && text.indexOf("::") !== text.lastIndexOf("::")) return false;
  const halves = compressed ? text.split("::") : [text];
  const groups = halves.flatMap((half) => (half === "" ? [] : half.split(":")));
  return (
    groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group)) &&
    (compressed ? groups.length < 8 : groups.length === 8)
  );
}
function lexicalHttpsUri(raw: string): HttpsUri | string {
  if (/[^\x21-\x7e]/.test(raw) || raw.includes("\\"))
    return "An HTTPS URI must use ASCII without whitespace, controls, or backslashes.";
  const match = /^https:\/\/([^/?#]*)(.*)$/i.exec(raw);
  if (!match || !match[1])
    return "An absolute HTTPS URI with a nonempty host is required.";
  const authority = match[1],
    suffix = match[2];
  if (authority.includes("@"))
    return "User information is not allowed in an HTTPS URI.";
  let host: string,
    port: string | undefined,
    bracketed = false;
  if (authority.startsWith("[")) {
    const literal = /^\[([^\]]+)\](?::([0-9]*))?$/.exec(authority);
    if (!literal) return "The bracketed IP authority is malformed.";
    host = literal[1];
    port = literal[2];
    bracketed = true;
    // RFC 3986 also permits IPvFuture literals; strict origin computation below
    // accepts only IPv6. This distinction preserves syntax-only URI claims.
    if (
      !ipv6(host) &&
      !/^v[0-9a-f]+\.[A-Za-z0-9._~!$&'()*+,;=:-]+$/i.test(host)
    )
      return "The IP literal is malformed.";
  } else {
    const registered =
      /^((?:[A-Za-z0-9._~!$&'()*+,;=-]|%[0-9a-fA-F]{2})+)(?::([0-9]*))?$/.exec(
        authority,
      );
    if (!registered) return "The host or decimal port is malformed.";
    host = registered[1];
    port = registered[2];
  }
  // RFC 3986 path-abempty, query and fragment. Validate percent escapes before
  // accepting their percent characters as members of a component.
  if (/%(?![0-9a-fA-F]{2})/.test(suffix))
    return "The HTTPS URI has a malformed percent escape.";
  if (
    !/^(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?(?:#[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$/.test(
      suffix,
    )
  )
    return "The HTTPS URI path, query, or fragment is malformed.";
  return { host, bracketed, port, suffix };
}
/** Internal RFC 3986 HTTPS URI syntax check; no identity or authority inference. */
export function validateHttpsUri(raw: string): string | null {
  const parsed = lexicalHttpsUri(raw);
  return typeof parsed === "string" ? parsed : null;
}
function failure(message: string): ParseResult<DeliverySuspensionOrigin> {
  return Object.freeze({
    ok: false,
    issues: Object.freeze([
      Object.freeze({ code: "invalid-origin", path: "", message }),
    ]),
  });
}
function parse(
  raw: string,
  rootOnly: boolean,
): ParseResult<DeliverySuspensionOrigin> {
  const parsed = lexicalHttpsUri(raw);
  if (typeof parsed === "string") return failure(parsed);
  if (parsed.host.includes("%"))
    return failure("Percent escapes are not allowed in a strict origin host.");
  if (rootOnly && parsed.suffix !== "" && parsed.suffix !== "/")
    return failure(
      "An origin must have an empty or single-slash path, with no query or fragment.",
    );
  // A long all-zero prefix is valid and bounded by the caller's input limit;
  // Number's infinity result is rejected without requiring integer coercion.
  const port =
    parsed.port === undefined || parsed.port === "" ? 443 : Number(parsed.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    return failure("The HTTPS port must be a decimal integer from 0 to 65535.");
  let hostname = parsed.host.toLowerCase(),
    serialized: string;
  if (parsed.bracketed) {
    if (!ipv6(hostname))
      return failure("Only IPv6 bracketed literals are supported for origins.");
    // WHATWG is used only after independent IPv6 lexical validation, never
    // for DNS names or origin assembly. It emits compressed hexadecimal even
    // for embedded IPv4 tails (RFC 5952 section 5 mixed notation is optional).
    try {
      hostname = new URL(`https://[${hostname}]/`).hostname.slice(1, -1);
    } catch {
      return failure("The IPv6 literal is invalid.");
    }
    serialized = `[${hostname}]`;
  } else {
    // WHATWG's numeric-host rules would rewrite these legacy IPv4 forms.
    // Accept only canonical four-octet decimal; preserve ordinary DNS names
    // ending in a numeric label, such as test.42, without calling URL.
    const candidate = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
    const numeric = candidate
      .split(".")
      .every((part) => /^(?:[0-9]+|0x[0-9a-f]*)$/i.test(part));
    if (numeric) {
      if (hostname.endsWith(".") || !ipv4(hostname))
        return failure(
          "IPv4 origins require four decimal octets without leading zeros or a terminal dot.",
        );
    } else {
      const error = validateIdnaHostname(hostname);
      if (error != null) return failure(error);
    }
    serialized = hostname;
  }
  const normalized = `https://${serialized}${port === 443 ? "" : `:${port}`}`;
  return Object.freeze({
    ok: true,
    value: Object.freeze({ raw, normalized, hostname, port }),
    warnings: Object.freeze([]),
  });
}
/**
 * Parse an FEP-f799 HTTPS origin claim without fetching or granting authority.
 *
 * Accepts equivalent root spellings, preserves a DNS terminal dot, and validates
 * IDNA2008 A-labels against Unicode 12.0.0. Unicode wire hosts are rejected.
 * Pass the original string: an already normalized `URL.href` can conceal invalid
 * input such as legacy IPv4, backslashes, dot segments, or compatibility mappings.
 *
 * @example
 * ```typescript
 * import { parseDeliverySuspensionOrigin } from "@fedify/fedify/delivery-suspension";
 * const origin = parseDeliverySuspensionOrigin("https://EXAMPLE.org:443/");
 * ```
 * @since 2.5.0
 */
export function parseDeliverySuspensionOrigin(
  raw: string,
): ParseResult<DeliverySuspensionOrigin> {
  return parse(raw, true);
}
/**
 * Compute the strict HTTPS origin of a lexically valid endpoint or identifier.
 * Valid path, query, and fragment components are permitted and remain in `raw`.
 * This only reports a claimed origin; it does not verify control or authority.
 * IDNA2008 validation uses Unicode 12.0.0. Supply the original string rather
 * than an already normalized `URL.href`, which can erase invalid wire spellings.
 *
 * @example
 * ```typescript
 * import { getDeliverySuspensionUrlOrigin } from "@fedify/fedify/delivery-suspension";
 * const origin = getDeliverySuspensionUrlOrigin("https://example.org/inbox?key=1");
 * ```
 * @since 2.5.0
 */
export function getDeliverySuspensionUrlOrigin(
  raw: string,
): ParseResult<DeliverySuspensionOrigin> {
  return parse(raw, false);
}
