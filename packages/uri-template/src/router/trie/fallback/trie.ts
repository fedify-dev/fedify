import type { Path } from "../../../types.ts";
import type { RouteEntry } from "../priority.ts";
import FallbackNode from "./node.ts";

/**
 * Prefix trie for route templates that cannot be safely compiled into the
 * token-level state trie.
 */
export default class FallbackTrie<TEntry extends RouteEntry> {
  readonly #root = new FallbackNode<TEntry>();
  #dirty = true;

  insert = (entry: TEntry): void => {
    let node = this.#root;

    for (const char of entry.initialLiteralPrefix) {
      node = node.childOrInsert(char);
    }

    node.insert(entry);
    this.#dirty = true;
  };

  remove = (entry: TEntry): void => {
    let node = this.#root;

    for (const char of entry.initialLiteralPrefix) {
      const child = node.child(char);
      if (child == null) return;
      node = child;
    }

    node.remove(entry);
    this.#dirty = true;
  };

  *candidates(path: Path): Generator<TEntry, void, unknown> {
    if (this.#dirty) this.#rebuildCandidates();
    yield* this.#deepestNode(path).candidates;
  }

  #deepestNode(path: Path): FallbackNode<TEntry> {
    let node = this.#root;

    for (const char of path) {
      const child = node.child(char);
      if (child == null) break;
      node = child;
    }
    return node;
  }

  #rebuildCandidates = (): void => {
    this.#root.rebuildCandidates([]);
    this.#dirty = false;
  };
}
