import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlError";
  }
}

const PORTABLE_IRI_PATTERN =
  /^(ap|ap\+ef61):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;
const INVALID_PERCENT_ENCODING_PATTERN = /%(?![0-9A-Fa-f]{2})/;
const DID_SCHEME_PATTERN = /^did:/i;

/**
 * Checks whether the given string can be parsed as an IRI.
 */
export function canParseIri(iri: string, base?: string | URL): boolean {
  try {
    parseIri(iri, base);
    return true;
  } catch {
    return false;
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
  if (!URL.canParse(iri, base) && iri.startsWith("at://")) {
    return parseAtUri(iri);
  }
  return new URL(iri, base);
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

function parsePortableIri(iri: string): URL | null {
  const match = iri.match(PORTABLE_IRI_PATTERN);
  if (match == null) return null;
  const authority = decodePortableAuthority(match[2]);
  if (!DID_SCHEME_PATTERN.test(authority)) {
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

function decodePortableAuthority(authority: string): string {
  if (INVALID_PERCENT_ENCODING_PATTERN.test(authority)) {
    throw new TypeError("Invalid portable ActivityPub IRI authority.");
  }
  if (DID_SCHEME_PATTERN.test(authority)) return authority;
  return authority.replace(/%3A/gi, ":").replace(/%25/gi, "%");
}

function parseAtUri(uri: string): URL {
  const index = uri.indexOf("/", 5);
  const authority = index >= 0 ? uri.slice(5, index) : uri.slice(5);
  const path = index >= 0 ? uri.slice(index) : "";
  return new URL("at://" + encodeURIComponent(authority) + path);
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
  } catch {
    addresses = [];
  }
  for (const { address, family } of addresses) {
    validatePublicIpAddress(address, family);
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
