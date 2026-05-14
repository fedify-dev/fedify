import type { Operator, Path, Token } from "../../types.ts";
import { isLiteral } from "../../utils.ts";
import FallbackTrie from "./fallback/trie.ts";
import { compareRouteEntries, type RouteEntry } from "./priority.ts";
import StateTrie from "./state/trie.ts";

/**
 * Route candidate trie that delegates to a state trie for indexable templates
 * and a fallback prefix trie for the remaining RFC 6570 shapes.
 */
export default class Trie<TEntry extends RouteEntry> {
  readonly #state = new StateTrie<TEntry>();
  readonly #fallback = new FallbackTrie<TEntry>();

  insert = (entry: TEntry): void => {
    if (isStateTrieEntry(entry)) {
      this.#state.insert(entry);
    } else {
      this.#fallback.insert(entry);
    }
  };

  remove = (entry: TEntry): void => {
    if (isStateTrieEntry(entry)) {
      this.#state.remove(entry);
    } else {
      this.#fallback.remove(entry);
    }
  };

  insertAll = (entries: Iterable<TEntry>): void => {
    for (const entry of entries) this.insert(entry);
  };

  *candidates(path: Path): Generator<TEntry, void, unknown> {
    yield* Array.from(uniqueMergedEntries(
      this.#state.candidates(path),
      this.#fallback.candidates(path),
    )).sort(compareRouteEntries);
  }
}

const isStateTrieEntry = (entry: RouteEntry): boolean =>
  isIndexableRoute(entry.tokens);

const isIndexableRoute = (tokens: readonly Token[]): boolean => {
  let previousWasExpression = false;

  for (const token of tokens) {
    if (isLiteral(token)) {
      previousWasExpression = false;
    } else {
      if (previousWasExpression) return false;
      if (!isIndexableExpression(token)) return false;
      previousWasExpression = true;
    }
  }

  return true;
};

type ExpressionToken = Extract<Token, { readonly kind: "expression" }>;

const isIndexableExpression = ({ vars, operator }: ExpressionToken): boolean =>
  vars.length === 1 && INDEXABLE_OPERATORS.has(operator);

const INDEXABLE_OPERATORS = new Set<Operator>(["", "/", "+"]);

function uniqueMergedEntries<TEntry>(
  ...sources: Iterable<TEntry>[]
): Set<TEntry> {
  const seen = new Set<TEntry>();
  for (const source of sources) {
    for (const entry of source) {
      seen.add(entry);
    }
  }
  return seen;
}
