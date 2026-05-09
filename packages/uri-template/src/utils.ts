import { RouterError } from "./router/errors.ts";
import Template from "./template/template.ts";
import type { Path } from "./types.ts";

export const isExpression = <T extends { kind: string }>(
  token: T,
): token is Extract<T, { kind: "expression" }> => token.kind === "expression";

export const isLiteral = <T extends { kind: string }>(
  token: T,
): token is Extract<T, { kind: "literal" }> => token.kind === "literal";

/**
 * Returns whether `path` is a path-shaped URI Template accepted by the
 * router.
 *
 * A path is either a literal string starting with `/`, or a path-expansion
 * expression (`{/var}`) followed by a literal segment that starts with `/`.
 * Templates that fail to parse — and therefore could never be routed —
 * return `false`.
 */
export function isPath(path: string): path is Path {
  const template = new Template(path);

  const [first] = template.tokens;
  if (first == null) return false;
  if (isLiteral(first)) return first.text.startsWith("/");
  if (first.operator === "/") return true;
  return false;
}

export function assertPath(path: string): asserts path is Path {
  if (!isPath(path)) {
    throw new RouterError(
      `"${path}" is not looks like a path. Is this start with slash(\`//\`?)`,
    );
  }
}
