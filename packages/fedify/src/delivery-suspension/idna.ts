/** Private IDNA2008 validation using the pinned Unicode 12.0.0 repertoire. */
import { IDNA_TABLES } from "./idna-data.ts";

type Table = keyof typeof IDNA_TABLES;
/** Look up inclusive generated ranges without depending on the runtime's Unicode data. */
export function idnaProperty(table: Table, point: number): number {
  const ranges = IDNA_TABLES[table];
  let low = 0,
    high = ranges.length / 3 - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2),
      index = middle * 3;
    if (point < ranges[index]) high = middle - 1;
    else if (point > ranges[index + 1]) low = middle + 1;
    else return ranges[index + 2];
  }
  return 0;
}

const MAX_INTEGER = 0x7fffffff;
function checked(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INTEGER) {
    throw new RangeError("Punycode arithmetic overflow");
  }
  return value;
}
function adapt(delta: number, count: number, first: boolean): number {
  delta = Math.floor(delta / (first ? 700 : 2));
  delta = checked(delta + Math.floor(delta / count));
  let k = 0;
  while (delta > 455) {
    delta = Math.floor(delta / 35);
    k += 36;
  }
  return k + Math.floor((36 * delta) / (delta + 38));
}
function digit(value: number): string {
  return String.fromCharCode(value + (value < 26 ? 97 : 22));
}
function value(code: number): number {
  if (code >= 97 && code <= 122) return code - 97;
  if (code >= 48 && code <= 57) return code - 22;
  return 36;
}
/** RFC 3492 codec; callers still need IDNA validation. */
export function encodePunycode(input: string): string {
  const points = Array.from(input, (character) => character.codePointAt(0)!);
  let result = points
    .filter((point) => point < 128)
    .map((point) => String.fromCharCode(point))
    .join("");
  let handled = result.length,
    n = 128,
    delta = 0,
    bias = 72;
  const basic = handled;
  if (handled > 0) result += "-";
  while (handled < points.length) {
    let next = 0x110000;
    for (const point of points) if (point >= n && point < next) next = point;
    delta = checked(delta + checked((next - n) * (handled + 1)));
    n = next;
    for (const point of points) {
      if (point < n) delta = checked(delta + 1);
      if (point !== n) continue;
      let q = delta;
      for (let k = 36; ; k += 36) {
        const threshold = Math.max(1, Math.min(26, k - bias));
        if (q < threshold) break;
        result += digit(threshold + ((q - threshold) % (36 - threshold)));
        q = Math.floor((q - threshold) / (36 - threshold));
      }
      result += digit(q);
      bias = adapt(delta, handled + 1, handled === basic);
      delta = 0;
      handled++;
    }
    delta = checked(delta + 1);
    n = checked(n + 1);
  }
  return result;
}
/** RFC 3492 codec; malformed input throws and never undergoes compatibility mapping. */
export function decodePunycode(input: string): string {
  const points: number[] = [];
  let cursor = 0,
    n = 128,
    i = 0,
    bias = 72;
  const delimiter = input.lastIndexOf("-");
  if (delimiter >= 0) {
    for (const character of input.slice(0, delimiter)) {
      const point = character.charCodeAt(0);
      if (point >= 128)
        throw new RangeError("Non-ASCII Punycode basic character");
      points.push(point);
    }
    cursor = delimiter + 1;
  }
  while (cursor < input.length) {
    const old = i;
    let weight = 1;
    for (let k = 36; ; k += 36) {
      if (cursor >= input.length) throw new RangeError("Truncated Punycode");
      const decoded = value(input.charCodeAt(cursor++));
      if (decoded >= 36) throw new RangeError("Invalid Punycode digit");
      i = checked(i + checked(decoded * weight));
      const threshold = Math.max(1, Math.min(26, k - bias));
      if (decoded < threshold) break;
      weight = checked(weight * (36 - threshold));
    }
    const count = points.length + 1;
    bias = adapt(i - old, count, old === 0);
    n = checked(n + Math.floor(i / count));
    i %= count;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff))
      throw new RangeError("Invalid Unicode scalar");
    points.splice(i++, 0, n);
  }
  return points.map((point) => String.fromCodePoint(point)).join("");
}

function contextValid(points: readonly number[], index: number): boolean {
  const point = points[index],
    previous = points[index - 1],
    next = points[index + 1];
  const property = (table: Table, cp: number | undefined) =>
    cp == null ? 0 : idnaProperty(table, cp);
  switch (point) {
    case 0x200d:
      return property("virama", previous) === 1;
    case 0x200c: {
      if (property("virama", previous) === 1) return true;
      let left = index - 1,
        right = index + 1;
      while (left >= 0 && property("joining", points[left]) === 4) left--;
      while (right < points.length && property("joining", points[right]) === 4)
        right++;
      return (
        [1, 3].includes(property("joining", points[left])) &&
        [2, 3].includes(property("joining", points[right]))
      );
    }
    case 0x00b7:
      return previous === 0x6c && next === 0x6c;
    case 0x0375:
      return property("script", next) === 1;
    case 0x05f3:
    case 0x05f4:
      return property("script", previous) === 2;
    case 0x30fb:
      return points.some((cp) => [3, 4, 5].includes(property("script", cp)));
    default:
      if (point >= 0x0660 && point <= 0x0669)
        return !points.some((cp) => cp >= 0x06f0 && cp <= 0x06f9);
      if (point >= 0x06f0 && point <= 0x06f9)
        return !points.some((cp) => cp >= 0x0660 && cp <= 0x0669);
      return false;
  }
}
function validLabel(label: string): boolean {
  const points = Array.from(label, (character) => character.codePointAt(0)!);
  // Check the pinned repertoire before using the runtime NFC implementation.
  if (points.some((point) => idnaProperty("assigned", point) === 0))
    return false;
  if (
    label.normalize("NFC") !== label ||
    label.startsWith("-") ||
    label.endsWith("-") ||
    (points[2] === 0x2d && points[3] === 0x2d)
  )
    return false;
  if (!points.length || idnaProperty("mark", points[0]) !== 0) return false;
  return points.every((point, index) => {
    const status = idnaProperty("validity", point);
    return (
      status === 1 ||
      ((status === 2 || status === 3) && contextValid(points, index))
    );
  });
}
function validBidi(label: string): boolean {
  // RFC 5893 section 2: R/AL starts RTL; L starts LTR.
  const classes = Array.from(label, (character) =>
    idnaProperty("bidi", character.codePointAt(0)!),
  );
  const rtl = classes[0] === 2 || classes[0] === 3;
  if (!rtl && classes[0] !== 1) return false;
  const allowed = rtl
    ? [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    : [1, 5, 6, 7, 8, 9, 10, 11];
  if (classes.some((property) => !allowed.includes(property))) return false;
  let last = classes.length - 1;
  while (last >= 0 && classes[last] === 11) last--;
  if (!(rtl ? [2, 3, 4, 5] : [1, 5]).includes(classes[last])) return false;
  return !rtl || !(classes.includes(4) && classes.includes(5));
}

/**
 * Validate an ASCII DNS hostname as IDNA2008, preserving a terminal DNS dot.
 * Unicode 12.0.0 data is pinned; newer assigned characters are rejected.
 * Returns an error message or null. No UTS #46 or IDNA2003 mappings are used.
 */
export function validateIdnaHostname(hostname: string): string | null {
  const name = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  if (name.length > 253 || !name)
    return "The DNS hostname must contain 1–253 ASCII characters.";
  const decoded: string[] = [];
  for (const label of name.split(".")) {
    if (!/^[a-z0-9-]{1,63}$/.test(label))
      return "DNS labels must contain 1–63 ASCII letters, digits, or hyphens.";
    let unicode = label;
    if (label.startsWith("xn--")) {
      try {
        unicode = decodePunycode(label.slice(4));
        if (
          !Array.from(unicode).some(
            (character) => character.codePointAt(0)! > 127,
          ) ||
          encodePunycode(unicode) !== label.slice(4)
        )
          return "The IDNA A-label is not canonical.";
      } catch {
        return "The IDNA A-label contains invalid Punycode.";
      }
    }
    if (!validLabel(unicode))
      return "The DNS label fails Unicode 12.0.0 IDNA2008 validation.";
    decoded.push(unicode);
  }
  // Bidi is a domain-wide condition, including decoded A-labels and ASCII siblings.
  const bidiDomain = decoded.some((label) =>
    Array.from(label).some((character) =>
      [2, 3, 4].includes(idnaProperty("bidi", character.codePointAt(0)!)),
    ),
  );
  if (bidiDomain && !decoded.every(validBidi))
    return "The domain fails RFC 5893 bidirectional-label rules.";
  return null;
}
