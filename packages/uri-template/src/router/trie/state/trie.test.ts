import { test } from "@fedify/fixture";
import { deepEqual } from "node:assert/strict";
import { Template } from "../../../template/mod.ts";
import type { Path, Token } from "../../../types.ts";
import { isLiteral } from "../../../utils.ts";
import type { RouteEntry } from "../priority.ts";
import StateTrie from "./trie.ts";

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
  trie: StateTrie<RouteEntry>,
  path: Path,
): RouteEntry[] => Array.from(trie.candidates(path));

test(
  "StateTrie.candidates() yields entries with matching literal segments",
  () => {
    const trie = new StateTrie<RouteEntry>();
    const users = makeEntry("/users/{id}", 0);
    const posts = makeEntry("/posts/{id}", 1);
    trie.insert(users);
    trie.insert(posts);

    deepEqual(candidatesOf(trie, "/users/42"), [users]);
    deepEqual(candidatesOf(trie, "/posts/42"), [posts]);
    deepEqual(candidatesOf(trie, "/unknown/42"), []);
  },
);

test(
  "StateTrie shares dynamic prefixes across entries that diverge by suffix",
  () => {
    const trie = new StateTrie<RouteEntry>();
    const inbox = makeEntry("/ap/{id}/inbox", 0);
    const outbox = makeEntry("/ap/{id}/outbox", 1);
    trie.insert(inbox);
    trie.insert(outbox);

    deepEqual(candidatesOf(trie, "/ap/alice/inbox"), [inbox]);
    deepEqual(candidatesOf(trie, "/ap/alice/outbox"), [outbox]);
    deepEqual(candidatesOf(trie, "/ap/alice/unknown"), []);
  },
);

test("StateTrie supports path-expansion {/var} templates", () => {
  const trie = new StateTrie<RouteEntry>();
  const entry = makeEntry("{/id}", 0);
  trie.insert(entry);

  deepEqual(candidatesOf(trie, "/anything"), [entry]);
});

test("StateTrie.remove() removes an inserted entry from candidates", () => {
  const trie = new StateTrie<RouteEntry>();
  const entry = makeEntry("/users/{id}", 0);
  trie.insert(entry);
  trie.remove(entry);

  deepEqual(candidatesOf(trie, "/users/42"), []);
});

test(
  "StateTrie.remove() is a no-op for an entry that was never inserted",
  () => {
    const trie = new StateTrie<RouteEntry>();
    const inserted = makeEntry("/users/{id}", 0);
    const stranger = makeEntry("/posts/{id}", 1);
    trie.insert(inserted);
    trie.remove(stranger);

    deepEqual(candidatesOf(trie, "/users/42"), [inserted]);
  },
);

test(
  "StateTrie.remove() is a no-op " +
    "when descent partially overlaps an inserted path",
  () => {
    const trie = new StateTrie<RouteEntry>();
    const inserted = makeEntry("/users/{id}", 0);
    const stranger = makeEntry("/users/{id}/posts/{post}", 1);
    trie.insert(inserted);
    trie.remove(stranger);

    deepEqual(candidatesOf(trie, "/users/42"), [inserted]);
  },
);

test("StateTrie.candidates() is empty for an empty trie", () => {
  const trie = new StateTrie<RouteEntry>();
  deepEqual(candidatesOf(trie, "/users/42"), []);
});

test(
  "StateTrie shares /ap/{identifier} dynamic prefix across sibling endpoints",
  () => {
    const trie = new StateTrie<RouteEntry>();
    const actor = makeEntry("/ap/{identifier}", 0);
    const inbox = makeEntry("/ap/{identifier}/inbox", 1);
    const outbox = makeEntry("/ap/{identifier}/outbox", 2);
    const followers = makeEntry("/ap/{identifier}/followers", 3);
    const following = makeEntry("/ap/{identifier}/following", 4);
    const featured = makeEntry("/ap/{identifier}/featured", 5);
    for (
      const entry of [actor, inbox, outbox, followers, following, featured]
    ) {
      trie.insert(entry);
    }

    deepEqual(candidatesOf(trie, "/ap/alice"), [actor]);
    deepEqual(candidatesOf(trie, "/ap/alice/inbox"), [inbox]);
    deepEqual(candidatesOf(trie, "/ap/alice/outbox"), [outbox]);
    deepEqual(candidatesOf(trie, "/ap/alice/followers"), [followers]);
    deepEqual(candidatesOf(trie, "/ap/alice/following"), [following]);
    deepEqual(candidatesOf(trie, "/ap/alice/featured"), [featured]);
    deepEqual(candidatesOf(trie, "/ap/alice/unknown"), []);
  },
);

test(
  "StateTrie shares root-adjacent {identifier} prefix " +
    "across multi-tenant routes",
  () => {
    const trie = new StateTrie<RouteEntry>();
    const inbox = makeEntry("/{identifier}/inbox", 0);
    const outbox = makeEntry("/{identifier}/outbox", 1);
    const followers = makeEntry("/{identifier}/followers", 2);
    const tenantInbox = makeEntry("/{tenant}/users/{identifier}/inbox", 3);
    const tenantOutbox = makeEntry("/{tenant}/users/{identifier}/outbox", 4);
    for (const entry of [inbox, outbox, followers, tenantInbox, tenantOutbox]) {
      trie.insert(entry);
    }

    deepEqual(candidatesOf(trie, "/alice/inbox"), [inbox]);
    deepEqual(candidatesOf(trie, "/alice/outbox"), [outbox]);
    deepEqual(candidatesOf(trie, "/alice/followers"), [followers]);
    deepEqual(
      candidatesOf(trie, "/example/users/alice/inbox"),
      [tenantInbox],
    );
    deepEqual(
      candidatesOf(trie, "/example/users/alice/outbox"),
      [tenantOutbox],
    );
  },
);
