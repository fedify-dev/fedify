// Adopted from Deno's @std/semver
const MAX_LENGTH = 256;

/**
 * A SemVer object parsed into its constituent parts.
 * @since 1.2.0
 */
export interface SemVer {
  /** The major version */
  major: number;
  /** The minor version */
  minor: number;
  /** The patch version */
  patch: number;
  /**
   * The prerelease version
   *
   * @default {[]}
   */
  prerelease?: (string | number)[];
  /**
   * The build metadata
   *
   * @default {[]}
   */
  build?: string[];
}

/**
 * A single `0`, or a non-zero digit followed by zero or more digits.
 */
const NUMERIC_IDENTIFIER = "0|[1-9]\\d*";

/**
 * Zero or more digits, followed by a letter or hyphen, and then zero or more letters, digits, or hyphens.
 */
const NON_NUMERIC_IDENTIFIER = "\\d*[a-zA-Z-][a-zA-Z0-9-]*";

/**
 * Three dot-separated numeric identifiers.
 */
const VERSION_CORE =
  `(?<major>${NUMERIC_IDENTIFIER})\\.(?<minor>${NUMERIC_IDENTIFIER})\\.(?<patch>${NUMERIC_IDENTIFIER})`;

/**
 * A numeric identifier, or a non-numeric identifier.
 */
const PRERELEASE_IDENTIFIER =
  `(?:${NUMERIC_IDENTIFIER}|${NON_NUMERIC_IDENTIFIER})`;

/**
 * A hyphen, followed by one or more dot-separated pre-release version identifiers.
 * @example "-pre.release"
 */
const PRERELEASE =
  `(?:-(?<prerelease>${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*))`;

/**
 * Any combination of digits, letters, or hyphens.
 */
const BUILD_IDENTIFIER = "[0-9A-Za-z-]+";

/**
 * A plus sign, followed by one or more period-separated build metadata identifiers.
 * @example "+build.meta"
 */
const BUILD =
  `(?:\\+(?<buildmetadata>${BUILD_IDENTIFIER}(?:\\.${BUILD_IDENTIFIER})*))`;

/**
 * A version, followed optionally by a pre-release version and build metadata.
 */
const FULL_VERSION = `v?${VERSION_CORE}${PRERELEASE}?${BUILD}?`;

export const FULL_REGEXP = new RegExp(`^${FULL_VERSION}$`);

/**
 * Attempt to parse a string as a semantic version, returning a SemVer object.
 *
 * @example Usage
 * ```ts
 * import { parseSemVer } from "@fedify/fedify/nodeinfo";
 * import { assertEquals } from "@std/assert";
 *
 * const version = parseSemVer("1.2.3");
 * assertEquals(version, {
 *   major: 1,
 *   minor: 2,
 *   patch: 3,
 *   prerelease: [],
 *   build: [],
 * });
 * ```
 *
 * @throws {TypeError} If the input string is invalid.
 * @param value The version string to parse
 * @returns A valid SemVer
 * @since 1.2.0
 */
export function parseSemVer(value: string): SemVer {
  if (typeof value !== "string") {
    throw new TypeError(
      `Cannot parse version as version must be a string: received ${typeof value}`,
    );
  }

  if (value.length > MAX_LENGTH) {
    throw new TypeError(
      `Cannot parse version as version length is too long: length is ${value.length}, max length is ${MAX_LENGTH}`,
    );
  }

  value = value.trim();

  const groups = value.match(FULL_REGEXP)?.groups;
  if (!groups) throw new TypeError(`Cannot parse version: ${value}`);

  const major = parseNumber(
    groups.major!,
    `Cannot parse version ${value}: invalid major version`,
  );
  const minor = parseNumber(
    groups.minor!,
    `Cannot parse version ${value}: invalid minor version`,
  );
  const patch = parseNumber(
    groups.patch!,
    `Cannot parse version ${value}: invalid patch version`,
  );

  const prerelease = groups.prerelease
    ? parsePrerelease(groups.prerelease)
    : [];
  const build = groups.buildmetadata ? parseBuild(groups.buildmetadata) : [];

  return { major, minor, patch, prerelease, build };
}

/**
 * Returns true if the value is a valid SemVer number.
 *
 * Must be a number. Must not be NaN. Can be positive or negative infinity.
 * Can be between 0 and MAX_SAFE_INTEGER.
 * @param value The value to check
 * @returns True if its a valid semver number
 */
function isValidNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    !Number.isNaN(value) &&
    (!Number.isFinite(value) ||
      (0 <= value && value <= Number.MAX_SAFE_INTEGER))
  );
}

const NUMERIC_IDENTIFIER_REGEXP = new RegExp(`^${NUMERIC_IDENTIFIER}$`);
function parsePrerelease(prerelease: string) {
  return prerelease
    .split(".")
    .filter(Boolean)
    .map((id: string) => {
      if (NUMERIC_IDENTIFIER_REGEXP.test(id)) {
        const number = Number(id);
        if (isValidNumber(number)) return number;
      }
      return id;
    });
}

function parseBuild(buildmetadata: string) {
  return buildmetadata.split(".").filter(Boolean);
}

function parseNumber(input: string, errorMessage: string) {
  const number = Number(input);
  if (!isValidNumber(number)) throw new TypeError(errorMessage);
  return number;
}

function formatNumber(value: number) {
  return value.toFixed(0);
}

/**
 * Format a SemVer object into a string.
 *
 * @example Usage
 * ```ts
 * import { formatSemVer } from "@fedify/fedify/nodeinfo";
 * import { assertEquals } from "@std/assert";
 *
 * const semver = {
 *   major: 1,
 *   minor: 2,
 *   patch: 3,
 * };
 * assertEquals(formatSemVer(semver), "1.2.3");
 * ```
 *
 * @param version The SemVer to format
 * @returns The string representation of a semantic version.
 * @since 1.2.0
 */
export function formatSemVer(version: SemVer): string {
  const major = formatNumber(version.major);
  const minor = formatNumber(version.minor);
  const patch = formatNumber(version.patch);
  const pre = version.prerelease?.join(".") ?? "";
  const build = version.build?.join(".") ?? "";

  const primary = `${major}.${minor}.${patch}`;
  const release = [primary, pre].filter((v) => v).join("-");
  return [release, build].filter((v) => v).join("+");
}
