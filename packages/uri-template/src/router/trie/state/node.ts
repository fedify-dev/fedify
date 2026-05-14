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

  childOrInsertExpression = (
    key: string,
    operator: Operator,
  ): StateNode<TEntry> => {
    const existing = this.expressionEdges.get(key);
    if (existing != null) return existing.node;

    const node = new StateNode<TEntry>();
    this.expressionEdges.set(key, { key, operator, node });
    return node;
  };

  childExpression = (key: string): StateNode<TEntry> | undefined =>
    this.expressionEdges.get(key)?.node;
}
