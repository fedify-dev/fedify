import type { Operator, Path, Token } from "../../../types.ts";
import { isLiteral } from "../../../utils.ts";
import type { RouteEntry } from "../priority.ts";
import StateNode, { type ExpressionEdge, type LiteralEdge } from "./node.ts";

type RouteSegment =
  | { readonly kind: "literal"; readonly text: string }
  | {
    readonly kind: "expression";
    readonly key: string;
    readonly operator: Operator;
  };

type ExpressionToken = Extract<Token, { readonly kind: "expression" }>;

/**
 * Token-level state trie for common path-shaped URI templates.
 */
export default class StateTrie<TEntry extends RouteEntry> {
  readonly #root = new StateNode<TEntry>();

  insert = (entry: TEntry): void => {
    let node = this.#root;
    for (const segment of compileSegments(entry.tokens)) {
      node = isLiteral(segment)
        ? insertLiteral(node, segment.text)
        : node.childOrInsertExpression(segment.key, segment.operator);
    }

    node.insert(entry);
  };

  remove = (entry: TEntry): void => {
    let node: StateNode<TEntry> | undefined = this.#root;
    for (const segment of compileSegments(entry.tokens)) {
      node = isLiteral(segment)
        ? findLiteral(node, segment.text)
        : node.childExpression(segment.key);
      if (node == null) return;
    }

    node.remove(entry);
  };

  *candidates(path: Path): Generator<TEntry, void, unknown> {
    yield* stateEntries(this.#root, path, 0);
  }
}

function* compileSegments(
  tokens: readonly Token[],
): Generator<RouteSegment, void, unknown> {
  for (const token of tokens) {
    if (isLiteral(token)) {
      if (token.text !== "") yield token;
    } else {
      yield {
        kind: "expression",
        key: expressionKey(token),
        operator: token.operator,
      };
    }
  }
}

const expressionKey = (
  { operator, vars: [{ explode, prefix }] }: ExpressionToken,
): string => [operator, explode ? "*" : "", prefix ?? ""].join("\0");

const insertLiteral = <TEntry extends RouteEntry>(
  node: StateNode<TEntry>,
  text: string,
): StateNode<TEntry> => {
  let current = node;
  let rest = text;

  while (rest !== "") {
    const edge = findCommonLiteralEdge(current, rest);
    if (edge == null) return appendLiteralEdge(current, rest);

    const length = commonPrefixLength(edge.text, rest);
    if (length === edge.text.length) {
      current = edge.node;
      rest = rest.slice(length);
      continue;
    }

    const intermediate = splitLiteralEdge(edge, length);
    if (length === rest.length) return intermediate;
    return appendLiteralEdge(intermediate, rest.slice(length));
  }

  return current;
};

const findLiteral = <TEntry extends RouteEntry>(
  node: StateNode<TEntry>,
  text: string,
): StateNode<TEntry> | undefined => {
  let current: StateNode<TEntry> | undefined = node;
  let rest = text;

  while (current != null && rest !== "") {
    const edge: LiteralEdge<TEntry> | undefined = current.literalEdges
      .find(({ text }) => rest.startsWith(text));
    if (edge == null) return undefined;
    current = edge.node;
    rest = rest.slice(edge.text.length);
  }

  return current;
};

const appendLiteralEdge = <TEntry extends RouteEntry>(
  node: StateNode<TEntry>,
  text: string,
): StateNode<TEntry> => {
  const child = new StateNode<TEntry>();
  node.literalEdges.push({ text, node: child });
  return child;
};

const splitLiteralEdge = <TEntry extends RouteEntry>(
  edge: LiteralEdge<TEntry>,
  length: number,
): StateNode<TEntry> => {
  const intermediate = new StateNode<TEntry>();
  const suffix = edge.text.slice(length);
  intermediate.literalEdges.push({ text: suffix, node: edge.node });
  edge.text = edge.text.slice(0, length);
  edge.node = intermediate;
  return intermediate;
};

const findCommonLiteralEdge = <TEntry extends RouteEntry>(
  node: StateNode<TEntry>,
  text: string,
): LiteralEdge<TEntry> | undefined =>
  node.literalEdges.find((edge) => commonPrefixLength(edge.text, text) > 0);

const commonPrefixLength = (left: string, right: string): number => {
  const max = Math.min(left.length, right.length);
  for (let index = 0; index < max; index++) {
    if (left[index] !== right[index]) return index;
  }
  return max;
};

function* stateEntries<TEntry extends RouteEntry>(
  node: StateNode<TEntry>,
  path: Path,
  index: number,
): Generator<TEntry, void, unknown> {
  if (index === path.length) {
    yield* node.entries;
  }

  for (const edge of node.literalEdges) {
    if (path.startsWith(edge.text, index)) {
      yield* stateEntries(
        edge.node,
        path,
        index + edge.text.length,
      );
    }
  }

  for (const edge of node.expressionEdges.values()) {
    yield* expressionEntries(edge, path, index);
  }
}

function* expressionEntries<TEntry extends RouteEntry>(
  edge: ExpressionEdge<TEntry>,
  path: Path,
  index: number,
): Generator<TEntry, void, unknown> {
  for (const end of expressionEndIndexes(edge.node, path, index)) {
    const expression = path.slice(index, end);
    if (!matchesExpressionShape(edge.operator, expression)) continue;
    yield* stateEntries(edge.node, path, end);
  }
}

function* expressionEndIndexes<TEntry extends RouteEntry>(
  node: StateNode<TEntry>,
  path: Path,
  index: number,
): Generator<number, void, unknown> {
  if (node.entries.length > 0) yield path.length;

  for (const edge of node.literalEdges) {
    for (
      let found = path.indexOf(edge.text, index);
      found >= 0;
      found = path.indexOf(edge.text, found + 1)
    ) {
      yield found;
    }
  }
}

const matchesExpressionShape = (
  operator: Operator,
  expression: string,
): boolean => {
  if (expression === "") return true;
  if (operator === "") return !expression.includes("/");
  if (operator === "/") return expression.startsWith("/");
  return true;
};
