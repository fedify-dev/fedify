import type { Operator, Path, Token } from "../../../types.ts";
import { fold, foldWhileDefined, isLiteral } from "../../../utils.ts";
import type { RouteEntry } from "../priority.ts";
import StateNode, { type ExpressionEdge } from "./node.ts";

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

  insert = (entry: TEntry): void =>
    fold(
      (node: StateNode<TEntry>, segment: RouteSegment) =>
        isLiteral(segment)
          ? node.insertLiteral(segment.text)
          : node.childOrInsertExpression(segment),
      this.#root,
      compileSegments(entry.tokens),
    ).insert(entry);

  remove = (entry: TEntry): void =>
    foldWhileDefined(
      (node: StateNode<TEntry>, segment: RouteSegment) =>
        isLiteral(segment)
          ? node.findLiteral(segment.text)
          : node.childExpression(segment.key),
      this.#root,
      compileSegments(entry.tokens),
    ).remove(entry);

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
