import type {
  OutboundHeaderPolicy,
  OutboundHeaderSnapshot,
} from "./outbound-report.ts";

const protectedHeaders = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "signature",
  "signature-input",
  "authentication-info",
  "proxy-authentication-info",
  "x-api-key",
  "x-auth-token",
]);

function snapshotNames(names: readonly string[]): readonly string[] {
  if (!Array.isArray(names)) {
    throw new TypeError("Outbound header names must be an array.");
  }
  const normalized = new Set<string>();
  for (const name of names) {
    if (
      typeof name !== "string" ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || name.includes("*")
    ) {
      throw new TypeError("Outbound header names must be literal HTTP tokens.");
    }
    normalized.add(name.toLowerCase());
  }
  return Object.freeze([...normalized].sort());
}

/** Validate/copy policy before registration replaces the selected observers. */
export function snapshotHeaderPolicy(
  policy: OutboundHeaderPolicy | undefined,
): OutboundHeaderPolicy | undefined {
  if (policy === undefined) return undefined;
  if (policy == null || typeof policy !== "object") {
    throw new TypeError("Outbound header policy must be an object.");
  }
  const { allow, redact, maxBytes } = policy;
  if (typeof maxBytes !== "number") {
    throw new TypeError("Outbound header maxBytes must be a number.");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError(
      "Outbound header maxBytes must be a positive safe integer.",
    );
  }
  return Object.freeze({
    allow: snapshotNames(allow),
    ...(redact === undefined ? {} : { redact: snapshotNames(redact) }),
    maxBytes,
  });
}

/** Copy only selected/redacted entries; budgets never truncate a header value. */
export function snapshotHeaders(
  headers: Headers,
  policy: OutboundHeaderPolicy,
): OutboundHeaderSnapshot {
  const redact = new Set([...protectedHeaders, ...(policy.redact ?? [])]);
  const entries: (readonly [string, string])[] = [];
  const encoder = new TextEncoder();
  let bytes = 0;
  let limitReached = false;
  for (const name of policy.allow) {
    if (!headers.has(name)) continue;
    // Preserve the runtime's entry order without retaining unselected values.
    for (const [key, rawValue] of headers) {
      if (key !== name) continue;
      const value = redact.has(name) ? "[redacted]" : rawValue;
      const size = encoder.encode(`${name}: ${value}\r\n`).byteLength;
      if (size > policy.maxBytes - bytes) {
        limitReached = true;
        continue;
      }
      entries.push(Object.freeze([name, value] as const));
      bytes += size;
    }
  }
  return Object.freeze({ entries: Object.freeze(entries), limitReached });
}
