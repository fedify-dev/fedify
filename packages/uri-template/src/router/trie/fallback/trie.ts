import type { Path } from "../../../types.ts";
import { fold, foldWhileDefined } from "../../../utils.ts";
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
    fold(
      (n: FallbackNode<TEntry>, char: string) => n.childOrInsert(char),
      this.#root,
      entry.initialLiteralPrefix,
    ).insert(entry);
    this.#dirty = true;
  };

  remove = (entry: TEntry): void => {
    foldWhileDefined(
      (node: FallbackNode<TEntry>, char: string) => node.child(char),
      this.#root,
      entry.initialLiteralPrefix,
    ).remove(entry);
    this.#dirty = true;
  };

  *candidates(path: Path): Generator<TEntry, void, unknown> {
    if (this.#dirty) this.#rebuildCandidates();
    yield* this.#deepestNode(path).candidates;
  }

  #deepestNode = (path: Path): FallbackNode<TEntry> =>
    foldWhileDefined(
      (n: FallbackNode<TEntry>, char: string) => n.child(char),
      this.#root,
      path,
    );

  #rebuildCandidates = (): void => {
    this.#root.rebuildCandidates([]);
    this.#dirty = false;
  };
}
