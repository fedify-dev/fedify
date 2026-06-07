/**
 * Typed payload-generation directives for the scenario format.
 *
 * Rather than templating payload bodies as strings, the format uses typed
 * directives such as `content: { generate: lorem, size: 2KB }`, which are
 * JSON-Schema-validatable and produce deterministic output of a given byte
 * size.
 * @since 2.3.0
 * @module
 */

/**
 * The largest payload {@link resolveGenerate} will produce (100 MiB).  A
 * generated payload is held in memory as a single string, so a much larger size
 * would exhaust memory or overflow `String.repeat`; a realistic benchmark body
 * is far smaller.  (`parseSize` itself stays a plain parser with no limit.)
 */
const MAX_PAYLOAD_SIZE = 100 * 1024 * 1024;

/** Multipliers for the size units accepted by {@link parseSize}. */
const SIZE_UNITS: Readonly<Record<string, number>> = {
  b: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
};

const SIZE_RE = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?\s*$/i;

/**
 * Parses a human-friendly byte size such as `"2KB"`, `"1.5MiB"`, or `512` into
 * a number of bytes.  Units are binary (`KB` = 1024 bytes); a bare number is
 * interpreted as bytes.
 * @param value A size string or a plain number of bytes.
 * @returns The size in bytes, as a non-negative integer.
 * @throws {RangeError} If the value cannot be parsed or is negative.
 */
export function parseSize(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`Invalid size: ${value}.`);
    }
    return ensureSafe(Math.floor(value), value);
  }
  const match = value.match(SIZE_RE);
  if (match == null) {
    throw new RangeError(`Invalid size: ${JSON.stringify(value)}.`);
  }
  const amount = Number.parseFloat(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  return ensureSafe(Math.floor(amount * SIZE_UNITS[unit]), value);
}

function ensureSafe(bytes: number, original: string | number): number {
  if (!Number.isSafeInteger(bytes)) {
    throw new RangeError(`Size out of range: ${JSON.stringify(original)}.`);
  }
  return bytes;
}

/**
 * A typed payload-generation directive.
 * @since 2.3.0
 */
export interface GenerateDirective {
  /** The generator to use, e.g. `"lorem"`. */
  readonly generate: string;
  /** The desired output size, e.g. `"2KB"` or a number of bytes. */
  readonly size?: string | number;
}

/**
 * Determines whether a value is a {@link GenerateDirective} rather than a plain
 * literal (such as a string content body).
 * @param value The value to test.
 * @returns `true` if the value is a generate directive.
 */
export function isGenerateDirective(
  value: unknown,
): value is GenerateDirective {
  return value != null && typeof value === "object" && !Array.isArray(value) &&
    Object.hasOwn(value, "generate") &&
    typeof (value as { generate?: unknown }).generate === "string";
}

/** A fixed lorem ipsum corpus used by the `lorem` generator. */
const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod " +
  "tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim " +
  "veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea " +
  "commodo consequat. Duis aute irure dolor in reprehenderit in voluptate " +
  "velit esse cillum dolore eu fugiat nulla pariatur. ";

/**
 * Resolves a {@link GenerateDirective} into a deterministic payload string.
 *
 * The output is exactly the requested number of bytes (ASCII, so bytes equal
 * characters) and is identical across calls for the same directive, which keeps
 * benchmark payloads reproducible.
 * @param directive The directive to resolve.
 * @returns The generated payload string.
 * @throws {RangeError} If the generator is unknown or the size is invalid.
 */
export function resolveGenerate(directive: GenerateDirective): string {
  const size = directive.size == null ? 0 : parseSize(directive.size);
  if (size > MAX_PAYLOAD_SIZE) {
    throw new RangeError(
      `Payload size ${JSON.stringify(directive.size)} exceeds the maximum of ` +
        `${MAX_PAYLOAD_SIZE} bytes.`,
    );
  }
  switch (directive.generate) {
    case "lorem":
      return generateLorem(size);
    default:
      throw new RangeError(
        `Unknown payload generator: ${JSON.stringify(directive.generate)}.`,
      );
  }
}

function generateLorem(size: number): string {
  if (size <= 0) return "";
  let out = LOREM.repeat(Math.ceil(size / LOREM.length));
  if (out.length > size) out = out.slice(0, size);
  return out;
}
