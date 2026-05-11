import type { Path } from "../types.ts";
import Node from "./node.ts";

interface TrieEntry {
  readonly index: number;
  readonly initialLiteralPrefix: string;
  readonly literalLength: number;
  readonly variableCount: number;
}

/**
 * Prefix trie for registered route candidates.
 */
export default class Trie<TEntry extends TrieEntry> {
  readonly #root = new Node<TEntry>();
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

  insertAll = (entries: readonly TEntry[]): void => {
    if (entries.length === 0) return;

    const buckets = new Map<Node<TEntry>, TEntry[]>();

    for (const entry of entries) {
      let node = this.#root;
      for (const char of entry.initialLiteralPrefix) {
        node = node.childOrInsert(char);
      }
      const bucket = buckets.get(node);
      if (bucket == null) buckets.set(node, [entry]);
      else bucket.push(entry);
    }

    for (const [node, bucket] of buckets) {
      node.insertAll(bucket);
    }

    this.#dirty = true;
  };

  *candidates(path: Path): Generator<TEntry, void, unknown> {
    if (this.#dirty) this.#rebuildCandidates();

    for (const entry of this.#deepestNode(path).candidates) {
      yield entry;
    }
  }

  #deepestNode(path: Path): Node<TEntry> {
    let node = this.#root;

    for (const char of path) {
      const child = node.child(char);
      if (child == null) return node;
      node = child;
    }

    return node;
  }

  #rebuildCandidates = (): void => {
    this.#root.rebuildCandidates([]);
    this.#dirty = false;
  };
}
