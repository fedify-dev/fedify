/**
 * Target risk classification.
 *
 * A target is `loopback` or `private` when it is clearly one of the operator's
 * own boxes, and `public` otherwise.  Classification is conservative: a host
 * that is not obviously loopback or private is treated as `public` (the gated
 * tier), since the tool cannot tell staging from production without resolving
 * and trusting DNS.
 * @since 2.3.0
 * @module
 */

import { lookup } from "node:dns/promises";

/** The risk tier of a benchmark target. */
export type TargetTier = "loopback" | "private" | "public";

/** Resolves a hostname to IP addresses for target risk classification. */
export type ResolveTargetAddresses = (
  hostname: string,
) => Promise<readonly string[]>;

/**
 * Classifies a target URL into a risk tier from its host.
 * @param target The target URL.
 * @returns The risk tier.
 */
export function classifyTarget(target: URL): TargetTier {
  let host = target.hostname.replace(/^\[/, "").replace(/\]$/, "")
    .toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1); // strip the root dot
  // Hostname forms (not IP literals).
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  if (host.endsWith(".local")) return "private";
  if (isIpv4(host)) return classifyIpv4(host);
  if (host.includes(":")) return classifyIpv6(host);
  // Not a known-local hostname and not an IP literal: treat as public.
  return "public";
}

/**
 * Classifies a target URL, resolving DNS for public-looking hostnames.
 *
 * Literal addresses and known local hostname suffixes are classified directly.
 * Other hostnames are resolved and classified from their addresses; any public
 * address in the answer keeps the target public, and DNS failure is treated as
 * public so the safety gate remains conservative.
 * @param target The target URL.
 * @param resolveAddresses Hostname resolver, overridable for tests.
 * @returns The resolved target tier.
 */
export async function classifyResolvedTarget(
  target: URL,
  resolveAddresses: ResolveTargetAddresses = defaultResolveTargetAddresses,
): Promise<TargetTier> {
  const host = normalizedHost(target);
  const direct = classifyTarget(target);
  if (direct !== "public" || isIpLiteral(host)) return direct;
  let addresses: readonly string[];
  try {
    const resolved = await resolveAddresses(host);
    addresses = Array.isArray(resolved) ? resolved : [];
  } catch {
    return "public";
  }
  if (addresses.length < 1) return "public";
  let aggregate: TargetTier = "loopback";
  for (const address of addresses) {
    let tier: TargetTier;
    try {
      tier = classifyTarget(new URL(`http://${hostForAddress(address)}/`));
    } catch {
      return "public";
    }
    if (tier === "public") return "public";
    if (tier === "private") aggregate = "private";
  }
  return aggregate;
}

/** Resolves a hostname with the platform DNS resolver. */
export async function defaultResolveTargetAddresses(
  hostname: string,
): Promise<readonly string[]> {
  const entries = await lookup(hostname, { all: true });
  return entries.map((entry) => entry.address);
}

function normalizedHost(target: URL): string {
  let host = target.hostname.replace(/^\[/, "").replace(/\]$/, "")
    .toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

function isIpLiteral(host: string): boolean {
  return isIpv4(host) || host.includes(":");
}

function hostForAddress(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}

function isIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return match != null && match.slice(1).every((octet) => Number(octet) <= 255);
}

function classifyIpv4(host: string): TargetTier {
  if (host === "0.0.0.0" || /^127\./.test(host)) return "loopback";
  if (
    /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
  ) {
    return "private";
  }
  return "public";
}

function classifyIpv6(host: string): TargetTier {
  if (host === "::1") return "loopback";
  // IPv4-mapped IPv6, dotted or hex-compressed (e.g. ::ffff:127.0.0.1 or
  // ::ffff:7f00:1), so a mapped loopback/private address is not seen as public.
  const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted != null && isIpv4(dotted[1])) return classifyIpv4(dotted[1]);
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex != null) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    return classifyIpv4(
      `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`,
    );
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]*:/.test(host)) return "private";
  if (/^fe[89ab][0-9a-f]*:/.test(host)) return "private";
  return "public";
}
