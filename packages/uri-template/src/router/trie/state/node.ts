import type { Operator } from "../../../types.ts";
import Node from "../node.ts";
import type { RouteEntry } from "../priority.ts";

export interface LiteralEdge<TEntry extends RouteEntry> {
  text: string;
  node: StateNode<TEntry>;
}

export interface ExpressionEdge<TEntry extends RouteEntry> {
  readonly key: string;
  readonly operator: Operator;
  readonly node: StateNode<TEntry>;
}

export default class StateNode<TEntry extends RouteEntry> extends Node<TEntry> {
  readonly literalEdges: LiteralEdge<TEntry>[] = [];
  readonly expressionEdges = new Map<string, ExpressionEdge<TEntry>>();

  insertLiteral = (text: string): StateNode<TEntry> => {
    if (text === "") return this;

    const edge = this.#findCommonLiteralEdge(text);
    if (edge == null) return this.#appendLiteralEdge(text);

    const length = commonPrefixLength(edge.text, text);
    if (length === edge.text.length) {
      return edge.node.insertLiteral(text.slice(length));
    }

    const intermediate = splitLiteralEdge(edge, length);
    if (length === text.length) return intermediate;
    return intermediate.#appendLiteralEdge(text.slice(length));
  };

  findLiteral = (text: string): StateNode<TEntry> | undefined => {
    if (text === "") return this;

    const edge: LiteralEdge<TEntry> | undefined = this.literalEdges
      .find(({ text: edgeText }) => text.startsWith(edgeText));
    if (edge == null) return undefined;
    return edge.node.findLiteral(text.slice(edge.text.length));
  };

  childOrInsertExpression = ({
    key,
    operator,
  }: Omit<ExpressionEdge<TEntry>, "node">): StateNode<TEntry> => {
    const existing = this.expressionEdges.get(key);
    if (existing != null) return existing.node;

    const node = new StateNode<TEntry>();
    this.expressionEdges.set(key, { key, operator, node });
    return node;
  };

  childExpression = (key: string): StateNode<TEntry> | undefined =>
    this.expressionEdges.get(key)?.node;

  #appendLiteralEdge(text: string): StateNode<TEntry> {
    const child = new StateNode<TEntry>();
    this.literalEdges.push({ text, node: child });
    return child;
  }

  #findCommonLiteralEdge = (text: string): LiteralEdge<TEntry> | undefined =>
    this.literalEdges.find(
      (edge) => commonPrefixLength(edge.text, text) > 0,
    );
}

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

const commonPrefixLength = (left: string, right: string): number => {
  const max = Math.min(left.length, right.length);
  for (let index = 0; index < max; index++) {
    if (left[index] !== right[index]) return index;
  }
  return max;
};
