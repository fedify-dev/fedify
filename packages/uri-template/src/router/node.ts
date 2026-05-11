import {
  compareRouteEntries,
  mergeRouteEntries,
  type PrioritizedRouteEntry,
} from "./priority.ts";

/**
 * Trie node used by the router index.
 */
export default class Node<TEntry extends PrioritizedRouteEntry> {
  readonly #children = new Map<string, Node<TEntry>>();
  readonly #entries: TEntry[] = [];
  #candidates: readonly TEntry[] = [];

  get entries(): readonly TEntry[] {
    return this.#entries;
  }

  get candidates(): readonly TEntry[] {
    return this.#candidates;
  }

  child = (key: string): Node<TEntry> | undefined => this.#children.get(key);

  childOrInsert = (key: string): Node<TEntry> => {
    const existing = this.#children.get(key);
    if (existing != null) return existing;

    const inserted = new Node<TEntry>();
    this.#children.set(key, inserted);
    return inserted;
  };

  insert = (entry: TEntry): void => {
    this.#entries.splice(this.#insertionIndex(entry), 0, entry);
  };

  remove = (entry: TEntry): void => {
    const index = this.#entries.indexOf(entry);
    if (index < 0) return;
    this.#entries.splice(index, 1);
  };

  insertAll = (entries: TEntry[]): void => {
    if (entries.length === 0) return;
    if (entries.length === 1) {
      this.insert(entries[0]);
      return;
    }

    entries.sort(compareRouteEntries);
    const merged = mergeRouteEntries(this.#entries, entries);

    this.#entries.length = 0;
    for (const entry of merged) this.#entries.push(entry);
  };

  rebuildCandidates = (parentCandidates: readonly TEntry[]): void => {
    this.#candidates = mergeRouteEntries(parentCandidates, this.#entries);

    for (const child of this.#children.values()) {
      child.rebuildCandidates(this.#candidates);
    }
  };

  #insertionIndex(entry: TEntry): number {
    let low = 0;
    let high = this.#entries.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.#compare(this.#entries[middle], entry) <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }

  #compare(left: TEntry, right: TEntry): number {
    return compareRouteEntries(left, right);
  }
}
