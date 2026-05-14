import { test } from "@fedify/fixture";
import { deepEqual } from "node:assert/strict";
import { Template } from "../../../template/mod.ts";
import type { Path, Token } from "../../../types.ts";
import { isLiteral } from "../../../utils.ts";
import type { RouteEntry } from "../priority.ts";
import FallbackTrie from "./trie.ts";

const makeEntry = (path: string, index = 0): RouteEntry => {
  const tokens = new Template(path).tokens;
  return {
    index,
    tokens,
    initialLiteralPrefix: tokens[0] != null && isLiteral(tokens[0])
      ? tokens[0].text
      : "",
    literalLength: literalLengthOf(tokens),
    variableCount: variableCountOf(tokens),
  };
};

const literalLengthOf = (tokens: readonly Token[]): number =>
  tokens.reduce(
    (sum, token) => isLiteral(token) ? sum + token.text.length : sum,
    0,
  );

const variableCountOf = (tokens: readonly Token[]): number => {
  const names = new Set<string>();
  for (const token of tokens) {
    if (isLiteral(token)) continue;
    for (const varSpec of token.vars) names.add(varSpec.name);
  }
  return names.size;
};

const candidatesOf = (
  trie: FallbackTrie<RouteEntry>,
  path: Path,
): RouteEntry[] => Array.from(trie.candidates(path));

test(
  "FallbackTrie.candidates() yields entries " +
    "whose literal prefix is a prefix of the path",
  () => {
    const trie = new FallbackTrie<RouteEntry>();
    const a = makeEntry("/a/{x,y}", 0);
    const ab = makeEntry("/ab/{x,y}", 1);
    trie.insert(a);
    trie.insert(ab);

    deepEqual(candidatesOf(trie, "/a/foo"), [a]);
    deepEqual(candidatesOf(trie, "/ab/foo"), [ab]);
  },
);

test("FallbackTrie inherits ancestor entries at deeper descent points", () => {
  const trie = new FallbackTrie<RouteEntry>();
  const root = makeEntry("/{x,y}", 0);
  const sub = makeEntry("/x/{a,b}", 1);
  trie.insert(root);
  trie.insert(sub);

  deepEqual(candidatesOf(trie, "/x/anything"), [sub, root]);
  deepEqual(candidatesOf(trie, "/other"), [root]);
});

test("FallbackTrie.remove() removes an inserted entry from candidates", () => {
  const trie = new FallbackTrie<RouteEntry>();
  const a = makeEntry("/a/{x,y}", 0);
  const b = makeEntry("/b/{x,y}", 1);
  trie.insert(a);
  trie.insert(b);
  trie.remove(a);

  deepEqual(candidatesOf(trie, "/a/foo"), []);
  deepEqual(candidatesOf(trie, "/b/foo"), [b]);
});

test(
  "FallbackTrie.remove() is a no-op for an entry that was never inserted",
  () => {
    const trie = new FallbackTrie<RouteEntry>();
    const inserted = makeEntry("/a/{x,y}", 0);
    const stranger = makeEntry("/b/{x,y}", 1);
    trie.insert(inserted);
    trie.remove(stranger);

    deepEqual(candidatesOf(trie, "/a/foo"), [inserted]);
  },
);

test(
  "FallbackTrie.remove() is a no-op when the entry's prefix is not in the trie",
  () => {
    const trie = new FallbackTrie<RouteEntry>();
    const inserted = makeEntry("/a/{x,y}", 0);
    const stranger = makeEntry("/zzz/{x,y}", 1);
    trie.insert(inserted);
    trie.remove(stranger);

    deepEqual(candidatesOf(trie, "/a/foo"), [inserted]);
  },
);

test(
  "FallbackTrie.candidates() yields nothing " +
    "when no entry prefix matches the path",
  () => {
    const trie = new FallbackTrie<RouteEntry>();
    const entry = makeEntry("/a/{x,y}", 0);
    trie.insert(entry);

    deepEqual(candidatesOf(trie, "/z"), []);
  },
);

test("FallbackTrie.candidates() is empty for an empty trie", () => {
  const trie = new FallbackTrie<RouteEntry>();
  deepEqual(candidatesOf(trie, "/anything"), []);
});
