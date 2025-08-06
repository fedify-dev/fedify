import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlError";
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
    hostname = hostname.substring(1, hostname.length - 2);
  }
  if (hostname === "localhost") {
    throw new UrlError("Localhost is not allowed");
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
    if (
      family === 4 && !isValidPublicIPv4Address(address) ||
      family === 6 && !isValidPublicIPv6Address(address) ||
      family < 4 || family === 5 || family > 6
    ) {
      throw new UrlError(`Invalid or private address: ${address}`);
    }
  }
}

export function isValidPublicIPv4Address(address: string): boolean {
  const parts = address.split(".");
  const first = parseInt(parts[0]);
  if (first === 0 || first === 10 || first === 127) return false;
  const second = parseInt(parts[1]);
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && second === 168) return false;
  return true;
}

export function isValidPublicIPv6Address(address: string) {
  address = expandIPv6Address(address);
  if (address.at(4) !== ":") return false;
  const firstWord = parseInt(address.substring(0, 4), 16);
  return !(
    (firstWord >= 0xfc00 && firstWord <= 0xfdff) || // ULA
    (firstWord >= 0xfe80 && firstWord <= 0xfebf) || // Link-local
    firstWord === 0 || firstWord >= 0xff00 // Multicast
  );
}

export function expandIPv6Address(address: string): string {
  address = address.toLowerCase();
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
