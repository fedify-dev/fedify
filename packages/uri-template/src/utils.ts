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
 * Reduces `iter` to a single value by applying `step` left-to-right, starting
 * from `init`.
 */
export const fold = <Acc, Item>(
  step: (acc: Acc, item: Item) => Acc,
  init: Acc,
  iter: Iterable<Item>,
): Acc => {
  let acc = init;
  for (const item of iter) acc = step(acc, item);
  return acc;
};

/**
 * Variant of {@link fold} that stops as soon as `step` yields `null` or
 * `undefined`, returning the last accumulator value that was defined. Useful
 * for descending through a trie where missing children fall back to the
 * deepest reachable node.
 */
export const foldWhileDefined = <Acc, Item>(
  step: (acc: Acc, item: Item) => Acc | undefined | null,
  init: Acc,
  iter: Iterable<Item>,
): Acc => {
  let acc = init;
  for (const item of iter) {
    const next = step(acc, item);
    if (next == null) break;
    acc = next;
  }
  return acc;
};

/**
 * Returns whether `path` is a path-shaped URI Template accepted by the
 * router.
 *
 * A path is either an empty string, a literal string starting with `/`, or a
 * path-expansion expression (`{/var}`).
 * Templates that fail to parse — and therefore could never be routed —
 * return `false`.
 */
export function isPath(path: string): path is Path {
  if (path === "") return true;

  try {
    const template = new Template(path);

    const [first] = template.tokens;
    if (first == null) return false;
    if (isLiteral(first)) return first.text.startsWith("/");
    if (first.operator === "/") return true;
    return false;
  } catch {
    return false;
  }
}

export function assertPath(path: string): asserts path is Path {
  if (!isPath(path)) {
    throw new RouterError(
      `"${path}" is not a router path. It must be empty, start with ` +
        "`/`, or start with a expression with slash(`/`) like `{/id}`.",
    );
  }
}
