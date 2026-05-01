const textEncoder = new TextEncoder();

const hexDigits = "0123456789ABCDEF";

/**
 * Returns whether a character is an RFC 3986 hexadecimal digit.
 *
 * Used by parsers and encoders when recognizing pct-encoded triplets.
 */
export function isHexDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code >= 0x30 && code <= 0x39 ||
    code >= 0x41 && code <= 0x46 ||
    code >= 0x61 && code <= 0x66
  );
}

/**
 * Returns whether `value[index]` starts a complete pct-encoded triplet.
 */
export function isPctEncodedAt(value: string, index: number): boolean {
  return value[index] === "%" &&
    index + 2 < value.length &&
    isHexDigit(value[index + 1]) &&
    isHexDigit(value[index + 2]);
}

/**
 * Returns the UTF-16 length of an RFC 6570 `varchar` at `index`, or `0` when
 * no varchar starts there.
 */
export function isVarcharAt(value: string, index: number): number {
  const char = value[index];
  if (char == null) return 0;
  if (isAlpha(char) || isDigit(char) || char === "_") return 1;
  return isPctEncodedAt(value, index) ? 3 : 0;
}

/**
 * Returns the UTF-16 length of an RFC 6570 literal token at `index`, or `0`
 * when the character is not valid literal syntax.
 */
export function isLiteralAt(value: string, index: number): number {
  if (isPctEncodedAt(value, index)) return 3;
  const { char, size } = readCodePoint(value, index);
  return isLiteralChar(char) ? size : 0;
}

/**
 * Reads one Unicode code point from a JavaScript string.
 */
export function readCodePoint(
  value: string,
  index: number,
): { char: string; size: number } {
  const codePoint = value.codePointAt(index);
  if (codePoint == null) return { char: "", size: 0 };
  const size = codePoint > 0xffff ? 2 : 1;
  return { char: value.slice(index, index + size), size };
}

/**
 * Percent-encodes an expanded variable value according to the operator's
 * allowed-character rule.
 */
export function encodeValue(value: string, allowReserved: boolean): string {
  let encoded = "";
  for (let index = 0; index < value.length;) {
    if (allowReserved && isPctEncodedAt(value, index)) {
      encoded += value.slice(index, index + 3);
      index += 3;
      continue;
    }

    const { char, size } = readCodePoint(value, index);
    encoded += isUnreserved(char) || allowReserved && isReserved(char)
      ? char
      : percentEncode(char);
    index += size;
  }
  return encoded;
}

/**
 * Percent-encodes a variable name or associative key for named expansions.
 */
export function encodeName(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length;) {
    if (isPctEncodedAt(value, index)) {
      encoded += value.slice(index, index + 3);
      index += 3;
      continue;
    }

    const { char, size } = readCodePoint(value, index);
    encoded += isUnreserved(char) ? char : percentEncode(char);
    index += size;
  }
  return encoded;
}

/**
 * Returns the first `length` RFC 6570 prefix characters without splitting a
 * Unicode code point or a pct-encoded triplet.
 */
export function truncateValue(value: string, length: number): string {
  let truncated = "";
  let count = 0;
  for (let index = 0; index < value.length && count < length; count++) {
    if (isPctEncodedAt(value, index)) {
      truncated += value.slice(index, index + 3);
      index += 3;
      continue;
    }

    const { char, size } = readCodePoint(value, index);
    truncated += char;
    index += size;
  }
  return truncated;
}

function isAlpha(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0x41 && code <= 0x5a || code >= 0x61 && code <= 0x7a;
}

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0x30 && code <= 0x39;
}

function isUnreserved(char: string): boolean {
  return isAlpha(char) || isDigit(char) ||
    char === "-" || char === "." || char === "_" || char === "~";
}

function isReserved(char: string): boolean {
  return ":/?#[]@!$&'()*+,;=".includes(char);
}

function isLiteralChar(char: string): boolean {
  const code = char.codePointAt(0);
  if (code == null) return false;
  return code === 0x21 ||
    code >= 0x23 && code <= 0x24 ||
    code === 0x26 ||
    code >= 0x28 && code <= 0x3b ||
    code === 0x3d ||
    code >= 0x3f && code <= 0x5b ||
    code === 0x5d ||
    code === 0x5f ||
    code >= 0x61 && code <= 0x7a ||
    code === 0x7e ||
    isUcsChar(code) ||
    isIPrivate(code);
}

function isUcsChar(code: number): boolean {
  return code >= 0xa0 && code <= 0xd7ff ||
    code >= 0xf900 && code <= 0xfdcf ||
    code >= 0xfdf0 && code <= 0xffef ||
    code >= 0x10000 && code <= 0x1fffd ||
    code >= 0x20000 && code <= 0x2fffd ||
    code >= 0x30000 && code <= 0x3fffd ||
    code >= 0x40000 && code <= 0x4fffd ||
    code >= 0x50000 && code <= 0x5fffd ||
    code >= 0x60000 && code <= 0x6fffd ||
    code >= 0x70000 && code <= 0x7fffd ||
    code >= 0x80000 && code <= 0x8fffd ||
    code >= 0x90000 && code <= 0x9fffd ||
    code >= 0xa0000 && code <= 0xafffd ||
    code >= 0xb0000 && code <= 0xbfffd ||
    code >= 0xc0000 && code <= 0xcfffd ||
    code >= 0xd0000 && code <= 0xdfffd ||
    code >= 0xe1000 && code <= 0xefffd;
}

function isIPrivate(code: number): boolean {
  return code >= 0xe000 && code <= 0xf8ff ||
    code >= 0xf0000 && code <= 0xffffd ||
    code >= 0x100000 && code <= 0x10fffd;
}

function percentEncode(char: string): string {
  return Array.from(textEncoder.encode(char))
    .map((byte) => `%${hexDigits[byte >> 4]}${hexDigits[byte & 0x0f]}`)
    .join("");
}
