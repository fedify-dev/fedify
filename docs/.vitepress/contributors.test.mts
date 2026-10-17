import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import {
  fetchContributors,
  parseContributors,
  visibleContributors,
} from "./contributors.mts";

test("filters bots, maintainers, and agents even if typed as users", () => {
  deepStrictEqual(
    visibleContributors([
      { id: 12431, login: "dahlia", type: "User" },
      { id: 209825114, login: "renamed-agent", type: "User" },
      { id: 1, login: "automation[bot]", type: "Bot" },
      { id: 2, login: "Zoe", type: "User" },
      { id: 3, login: "alice", type: "User" },
      { id: 3, login: "alice", type: "User" },
      { id: 81847, login: "claude", type: "User" },
    ]).map((person) => person.login),
    ["alice", "claude", "Zoe"],
  );
});

test("follows pagination and sends a build token only when supplied", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    return Response.json(
      calls.length === 1
        ? Array.from(
          { length: 100 },
          (_, i) => ({ id: i + 1, login: `person-${i}`, type: "User" }),
        )
        : [{ id: 101, login: "last-person", type: "User" }],
    );
  };
  strictEqual(
    (await fetchContributors({ token: "test-token", fetch: request })).length,
    101,
  );
  strictEqual(calls.length, 2);
  strictEqual(calls[1].url.endsWith("page=2"), true);
  strictEqual(calls[0].headers.get("Authorization"), "Bearer test-token");
  await fetchContributors({ fetch: request });
  strictEqual(calls[2].headers.has("Authorization"), false);
});

test("rejects a partial result when a later page fails", async () => {
  let calls = 0;
  await rejects(
    fetchContributors({
      fetch: async () =>
        ++calls === 1
          ? Response.json(
            Array.from(
              { length: 100 },
              (_, i) => ({ id: i + 1, login: `person-${i}`, type: "User" }),
            ),
          )
          : new Response(null, { status: 403 }),
    }),
    /403/,
  );
});

test("rejects malformed API and cache data", async () => {
  await rejects(
    fetchContributors({
      fetch: async () => Response.json({ message: "rate limited" }),
    }),
  );
  for (
    const entry of [null, { id: -1, login: "bad", type: "User" }, {
      id: 1,
      login: "../bad",
      type: "User",
    }]
  ) {
    await rejects(async () => parseContributors([entry]));
  }
});
