/**
 * Friendly error reporting for scenario validation failures.
 *
 * `@cfworker/json-schema` reports structural failures with a JSON-pointer
 * instance location and a terse message.  Raw `oneOf`/`contains` failures read
 * poorly, so this module turns the raw errors into a single readable message
 * while keeping the schema authoritative for correctness.
 * @since 2.3.0
 * @module
 */

/** A raw validation error as reported by `@cfworker/json-schema`. */
export interface RawValidationError {
  readonly instanceLocation: string;
  readonly keyword?: string;
  readonly error: string;
}

/** An error raised when a scenario suite fails schema validation. */
export class SuiteValidationError extends Error {
  /** The individual validation problems, most specific first. */
  readonly problems: readonly RawValidationError[];

  constructor(problems: readonly RawValidationError[], source?: string) {
    super(formatMessage(problems, source));
    this.name = "SuiteValidationError";
    this.problems = problems;
  }
}

function formatMessage(
  problems: readonly RawValidationError[],
  source?: string,
): string {
  const where = source == null ? "scenario suite" : source;
  if (problems.length === 0) {
    return `Invalid ${where}.`;
  }
  const lines = dedupe(problems).map((problem) => {
    const at =
      problem.instanceLocation === "#" || problem.instanceLocation === ""
        ? "(root)"
        : problem.instanceLocation.replace(/^#/, "");
    return `  - ${at}: ${problem.error}`;
  });
  return `Invalid ${where}:\n${lines.join("\n")}`;
}

function dedupe(
  problems: readonly RawValidationError[],
): RawValidationError[] {
  const seen = new Set<string>();
  const result: RawValidationError[] = [];
  // Prefer the most specific (deepest) instance locations first.
  const sorted = [...problems].sort((a, b) =>
    depth(b.instanceLocation) - depth(a.instanceLocation)
  );
  for (const problem of sorted) {
    const key = JSON.stringify([problem.instanceLocation, problem.error]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(problem);
  }
  return result;
}

function depth(instanceLocation: string): number {
  return (instanceLocation.match(/\//g) ?? []).length;
}
