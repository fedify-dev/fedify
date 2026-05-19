const textEncoder = new TextEncoder();

const hexDigits = "0123456789ABCDEF";

/**
 * Returns whether a character is an RFC 3986 hexadecimal digit.
 *
 * Used by parsers and encoders when recognizing pct-encoded triplets.
 */
export const isHexDigit: (char: string) => boolean = (
  char: string,
): boolean =>
  some(
    between(0x30, 0x39),
    between(0x41, 0x46),
    between(0x61, 0x66),
  )(char.charCodeAt(0));

/**
 * Returns whether `value[index]` starts a complete pct-encoded triplet.
 */
export const isPctEncodedAt: (
  value: string,
  index: number,
) => boolean = (value: string, index: number): boolean =>
  value[index] === "%" &&
  index + 2 < value.length &&
  isHexDigit(value[index + 1]) &&
  isHexDigit(value[index + 2]);

/**
 * Returns the UTF-16 length of an RFC 6570 `varchar` at `index`, or `0` when
 * no varchar starts there.
 */
export function isVarcharAt(value: string, index: number): number {
  const char = value[index];
  if (char == null) return 0;
  if (some(isAlpha, isDigit, eq("_"))(char)) return 1;
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
export const encodeValue: (
  allowReserved: boolean,
) => (value: string) => string = (
  allowReserved: boolean,
): (value: string) => string =>
(value: string): string => {
  let encoded = "";
  for (let index = 0; index < value.length;) {
    if (allowReserved && isPctEncodedAt(value, index)) {
      encoded += value.slice(index, index + 3);
      index += 3;
      continue;
    }

    const { char, size } = readCodePoint(value, index);
    encoded += some(
        isUnreserved,
        (char: string): boolean => allowReserved && isReserved(char),
      )(char)
      ? char
      : percentEncode(char);
    index += size;
  }
  return encoded;
};

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

const isAlpha: (char: string) => boolean = (char: string): boolean =>
  some(between(0x41, 0x5a), between(0x61, 0x7a))(char.charCodeAt(0));

const isDigit: (char: string) => boolean = (char: string): boolean =>
  between(0x30, 0x39)(char.charCodeAt(0));

const isUnreserved: (char: string) => boolean = (char: string): boolean =>
  some(
    isAlpha,
    isDigit,
    (char: string) => "-._~".includes(char),
  )(char);

const isReserved: (char: string) => boolean = (char: string): boolean =>
  ":/?#[]@!$&'()*+,;=".includes(char);

const isLiteralChar: (char: string) => boolean = (char: string): boolean =>
  isLiteralCodePoint(char.codePointAt(0));

const isLiteralCodePoint: (
  code: number | undefined,
) => boolean = (code: number | undefined): boolean =>
  code != null &&
  some(
    eq(0x21),
    between(0x23, 0x24),
    eq(0x26),
    between(0x28, 0x3b),
    eq(0x3d),
    between(0x3f, 0x5b),
    eq(0x5d),
    eq(0x5f),
    between(0x61, 0x7a),
    eq(0x7e),
    isUcsChar,
    isIPrivate,
  )(code);

function isUcsChar(code: number): boolean {
  if (code < 0x10000) {
    return some(
      between(0xa0, 0xd7ff),
      between(0xf900, 0xfdcf),
      between(0xfdf0, 0xffef),
    )(code);
  }

  if (code > 0xefffd) return false;
  const offset = code % 0x10000;
  return offset <= 0xfffd && (code < 0xe0000 || offset >= 0x1000);
}

const isIPrivate: (code: number) => boolean = (code: number): boolean =>
  some(
    between(0xe000, 0xf8ff),
    between(0xf0000, 0xffffd),
    between(0x100000, 0x10fffd),
  )(code);

const percentEncode: (char: string) => string = (char: string): string =>
  Array.from(textEncoder.encode(char))
    .map((byte) => `%${hexDigits[byte >> 4]}${hexDigits[byte & 0x0f]}`)
    .join("");

const between: (
  min: number,
  max: number,
) => (num: number) => boolean =
  (min: number, max: number): (num: number) => boolean =>
  (num: number): boolean => min <= num && num <= max;

const eq: <T>(a: T) => (b: T) => boolean =
  <T>(a: T): (b: T) => boolean => (b: T): boolean => a === b;

const some: <T>(
  ...preds: ((arg: T) => boolean)[]
) => (arg: T) => boolean =
  <T>(...preds: ((arg: T) => boolean)[]): (arg: T) => boolean =>
  (arg: T): boolean => preds.some((pred) => pred(arg));
// cspell: ignore preds
