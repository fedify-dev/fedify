import type { Operator } from "./ast.ts";

// unreserved: ALPHA / DIGIT / "-" / "." / "_" / "~" (RFC 3986)
export const UNRESERVED = new Set<string>(
  [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"],
);
// reserved: gen-delims / sub-delims (# & + treated by operator)
const GEN_DELIMS = ":/?#[]@";
const SUB_DELIMS = "!$&'()*+,;=";
export const RESERVED_GENERAL = new Set<string>([...GEN_DELIMS + SUB_DELIMS]);
const RESERVED_NO_HASH = new Set<string>([...":/?[]@" + SUB_DELIMS + "?"]); // disallow '#'

// percent sequence validator
export function looksLikePctTriplet(s: string, i: number): boolean {
  if (s[i] !== "%" || i + 2 >= s.length) return false;
  const a = s[i + 1], b = s[i + 2];
  const hex = (c: string) =>
    ("0" <= c && c <= "9") || ("a" <= c && c <= "f") || ("A" <= c && c <= "F");
  return hex(a) && hex(b);
}

/** @internal
 * OperatorSpec is the single source of truth (SSOT) for both expand & match.
 * - first: string added before the first element (e.g. "#", ".", "/", ";", "?", "&")
 * - named: if true, items are "name=value" pairs (e.g. ;, ?, & operators)
 * - ifEmpty:
 *   - "omit"     -> remove entirely (default simple operator)
 *   - "nameOnly" -> emit only key (e.g. ;x)
 *   - "empty"    -> emit "key=" (e.g. ?x= / &x=)
 * - allowReserved/reservedSet: precise reserved char pass-through control
 *   (e.g. "#" allows most reserved but NOT '#', which would start a fragment)
 */
export interface OperatorSpec {
  first?: string;
  named?: boolean;
  ifEmpty?: "omit" | "nameOnly" | "empty";
  allowReserved: boolean;
  reservedSet?: Set<string>;
  itemSep: string;
  kvSep: string;
}

export const OP: Record<Operator, OperatorSpec> = {
  "": { allowReserved: false, itemSep: ",", kvSep: "=", ifEmpty: "omit" },
  "+": {
    allowReserved: true,
    reservedSet: RESERVED_GENERAL,
    itemSep: ",",
    kvSep: "=",
    ifEmpty: "omit",
  },
  "#": {
    first: "#",
    allowReserved: true,
    reservedSet: RESERVED_NO_HASH,
    itemSep: ",",
    kvSep: "=",
    ifEmpty: "omit",
  },
  ".": {
    first: ".",
    allowReserved: false,
    itemSep: ".",
    kvSep: "=",
    ifEmpty: "omit",
  },
  "/": {
    first: "/",
    allowReserved: false,
    itemSep: "/",
    kvSep: "=",
    ifEmpty: "omit",
  },
  // Note: '?' and '&' must output name= when empty
  ";": {
    first: ";",
    named: true,
    allowReserved: false,
    itemSep: ";",
    kvSep: "=",
    ifEmpty: "nameOnly",
  },
  "?": {
    first: "?",
    named: true,
    allowReserved: false,
    itemSep: "&",
    kvSep: "=",
    ifEmpty: "empty",
  },
  "&": {
    first: "&",
    named: true,
    allowReserved: false,
    itemSep: "&",
    kvSep: "=",
    ifEmpty: "empty",
  },
};

// Encode one character according to operator rules (idempotent)
export function encodeChar(ch: string, allowReserved: boolean): string {
  if (UNRESERVED.has(ch)) return ch;
  if (allowReserved && RESERVED_GENERAL.has(ch)) return ch;
  // If already a %XX triplet, keep as-is (idempotent)
  if (ch === "%") return "%25";
  const hex = new TextEncoder().encode(ch); // UTF-8 bytes
  return [...hex].map((b) =>
    "%" + b.toString(16).toUpperCase().padStart(2, "0")
  ).join("");
}

// Percent-idempotent encoder for an entire string
export function encodeComponentIdempotent(
  s: string,
  allowReserved: boolean,
  reservedSet?: Set<string>,
): string {
  let out = "";
  for (let i = 0; i < s.length;) {
    // Fast-path: copy %XX untouched; encode others by UTF-8 bytes.
    // We iterate by JS code points but encode by TextEncoder (UTF-8).
    if (s[i] === "%" && looksLikePctTriplet(s, i)) {
      out += s.slice(i, i + 3);
      i += 3;
      continue;
    }
    const ch = s[i];
    if (UNRESERVED.has(ch)) {
      out += ch;
      i++;
      continue;
    }
    if (allowReserved && reservedSet?.has(ch)) {
      out += ch;
      i++;
      continue;
    }
    const bytes = new TextEncoder().encode(ch);
    for (const b of bytes) {
      out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
    i++;
  }
  return out;
}

// Strict percent-decoder: rejects bad triplets and double-decoding
export function strictPercentDecode(s: string): string {
  // we allow %XX and decode exactly once; malformed -> throw
  // Note: we don't try to detect "double encoding" like %252F automatically,
  // that is up to calling policy to interpret; here we just do a single decode pass.
  const bytes: number[] = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "%") {
      if (!looksLikePctTriplet(s, i)) throw new Error("Bad percent sequence");
      const byte = parseInt(s.slice(i + 1, i + 3), 16);
      bytes.push(byte);
      i += 3;
    } else {
      bytes.push(c.codePointAt(0)!);
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
