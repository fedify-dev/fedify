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

/** The risk tier of a benchmark target. */
export type TargetTier = "loopback" | "private" | "public";

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
