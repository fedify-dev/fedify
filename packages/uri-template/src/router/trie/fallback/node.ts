import Node from "../node.ts";
import { mergeRouteEntries, type RouteEntry } from "../priority.ts";

/**
 * Prefix-trie node for routes the main router index cannot handle.
 * Precomputes merged candidates per node so path lookups only read the
 * deepest matching node's {@link candidates}.
 */
export default class FallbackNode<TEntry extends RouteEntry>
  extends Node<TEntry> {
  readonly #children = new Map<string, FallbackNode<TEntry>>();
  #candidates: readonly TEntry[] = [];

  get candidates(): readonly TEntry[] {
    return this.#candidates;
  }

  child = (key: string): FallbackNode<TEntry> | undefined =>
    this.#children.get(key);

  childOrInsert = (key: string): FallbackNode<TEntry> => {
    const existing = this.#children.get(key);
    if (existing != null) return existing;

    const inserted = new FallbackNode<TEntry>();
    this.#children.set(key, inserted);
    return inserted;
  };

  rebuildCandidates = (parentCandidates: readonly TEntry[]): void => {
    this.#candidates = mergeRouteEntries(parentCandidates, this.entries);

    for (const child of this.#children.values()) {
      child.rebuildCandidates(this.#candidates);
    }
  };
}
