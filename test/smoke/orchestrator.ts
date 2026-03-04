/**
 * Smoke test orchestrator.
 *
 * Drives E2E scenarios between the Fedify test harness and a Mastodon
 * instance, asserting that federated activities are correctly delivered
 * and interpreted by both sides.
 *
 * Expects env vars (from .env.test produced by provision.sh):
 *   SERVER_BASE_URL, SERVER_ACCESS_TOKEN,
 *   HARNESS_BASE_URL, HARNESS_ORIGIN, SERVER_INTERNAL_HOST
 */

const SERVER_URL = Deno.env.get("SERVER_BASE_URL")!;
const SERVER_TOKEN = Deno.env.get("SERVER_ACCESS_TOKEN")!;
const HARNESS_URL = Deno.env.get("HARNESS_BASE_URL")!;
const SERVER_INTERNAL_HOST = Deno.env.get("SERVER_INTERNAL_HOST")!;

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function poll<T>(
  label: string,
  fn: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result !== null) return result;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function serverGet(path: string): Promise<unknown> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    headers: { Authorization: `Bearer ${SERVER_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Server GET ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function serverPost(
  path: string,
  body?: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVER_TOKEN}`,
      "Content-Type": body ? "application/json" : "text/plain",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function harnessPost(
  path: string,
  body?: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(`${HARNESS_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Harness POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type RemoteAccount = { id: string; acct: string };
type Relationship = {
  id: string;
  following: boolean;
  followed_by: boolean;
};

// Resolved once by the first follow scenario and reused by later scenarios.
let fedifyAccountId: string | undefined;

async function lookupFedifyAccount(): Promise<string> {
  if (fedifyAccountId) return fedifyAccountId;

  const handle = `testuser@fedify-harness:3001`;

  const searchResult = await poll("Fedify user resolvable", async () => {
    const results = await serverGet(
      `/api/v1/accounts/search?q=${
        encodeURIComponent(`@${handle}`)
      }&resolve=false&limit=5`,
    ) as RemoteAccount[];
    const match = results?.find((a) =>
      a.acct === handle || a.acct === `@${handle}`
    );
    return match ?? null;
  });

  fedifyAccountId = searchResult.id;
  return fedifyAccountId;
}

async function assertNotFollowing(
  accountId: string,
  direction: "following" | "followed_by",
): Promise<void> {
  const rels = await serverGet(
    `/api/v1/accounts/relationships?id[]=${accountId}`,
  ) as Relationship[];
  const rel = rels.find((r) => r.id === accountId);
  if (rel && rel[direction]) {
    throw new Error(
      `Expected ${direction} to be false, but it was true (account ${accountId})`,
    );
  }
}

async function ensureNotFollowing(
  accountId: string,
  direction: "following" | "followed_by",
): Promise<void> {
  const rels = await serverGet(
    `/api/v1/accounts/relationships?id[]=${accountId}`,
  ) as Relationship[];
  const rel = rels.find((r) => r.id === accountId);
  if (rel?.[direction]) {
    if (direction === "following") {
      await serverPost(`/api/v1/accounts/${accountId}/unfollow`);
    } else {
      // Ask the harness to send Undo Follow to clear followed_by
      await harnessPost("/_test/unfollow", {
        target: `testuser@${SERVER_INTERNAL_HOST}`,
      });
    }
    // Wait for the relationship to actually clear
    await poll(`${direction} cleared`, async () => {
      const updated = await serverGet(
        `/api/v1/accounts/relationships?id[]=${accountId}`,
      ) as Relationship[];
      const r = updated.find((r) => r.id === accountId);
      return r && !r[direction] ? r : null;
    });
  }
}

// ---------------------------------------------------------------------------
// Scenario: Mastodon → Fedify (Follow)
// ---------------------------------------------------------------------------

async function testFollowMastodonToFedify(): Promise<void> {
  await harnessPost("/_test/reset");
  const accountId = await lookupFedifyAccount();
  await ensureNotFollowing(accountId, "following");
  await assertNotFollowing(accountId, "following");
  await serverPost(`/api/v1/accounts/${accountId}/follow`);

  await poll("Follow in harness inbox", async () => {
    const res = await fetch(`${HARNESS_URL}/_test/inbox`);
    const items = await res.json() as { type: string; id: string }[];
    return items.find((a) => a.type === "Follow") ?? null;
  });

  await poll("follow accepted", async () => {
    const rels = await serverGet(
      `/api/v1/accounts/relationships?id[]=${accountId}`,
    ) as Relationship[];
    const rel = rels.find((r) => r.id === accountId);
    return rel?.following ? rel : null;
  });
}

// ---------------------------------------------------------------------------
// Scenario: Fedify → Mastodon (Follow)
// ---------------------------------------------------------------------------

async function testFollowFedifyToMastodon(): Promise<void> {
  await harnessPost("/_test/reset");
  const accountId = await lookupFedifyAccount();
  await ensureNotFollowing(accountId, "followed_by");
  await assertNotFollowing(accountId, "followed_by");

  await harnessPost("/_test/follow", {
    target: `testuser@${SERVER_INTERNAL_HOST}`,
  });

  await poll("followed_by on Mastodon", async () => {
    const rels = await serverGet(
      `/api/v1/accounts/relationships?id[]=${accountId}`,
    ) as Relationship[];
    const rel = rels.find((r) => r.id === accountId);
    return rel?.followed_by ? rel : null;
  });

  await poll("Accept in harness inbox", async () => {
    const res = await fetch(`${HARNESS_URL}/_test/inbox`);
    const items = await res.json() as { type: string; id: string }[];
    return items.find((a) => a.type === "Accept") ?? null;
  });
}

// ---------------------------------------------------------------------------
// Scenario: Fedify → Mastodon (Create Note)
// ---------------------------------------------------------------------------

async function testCreateNote(): Promise<void> {
  await harnessPost("/_test/reset");

  const content = `Smoke test ${Date.now()}`;
  await harnessPost("/_test/create-note", {
    to: `testuser@${SERVER_INTERNAL_HOST}`,
    content,
  });

  type Status = { id: string; content: string };

  await poll("note on Mastodon timeline", async () => {
    const statuses = await serverGet(
      "/api/v1/timelines/home?limit=20",
    ) as Status[];
    return statuses.find((s) => s.content.includes(content)) ?? null;
  });
}

// ---------------------------------------------------------------------------
// Scenario: Mastodon → Fedify (Reply)
// ---------------------------------------------------------------------------

async function testReply(): Promise<void> {
  await harnessPost("/_test/reset");

  const handle = `@testuser@fedify-harness:3001`;
  const replyContent = `Reply smoke test ${Date.now()} ${handle}`;

  await serverPost("/api/v1/statuses", {
    status: replyContent,
  });

  await poll("Create in harness inbox", async () => {
    const res = await fetch(`${HARNESS_URL}/_test/inbox`);
    const items = await res.json() as { type: string; id: string }[];
    return items.find((a) => a.type === "Create") ?? null;
  });
}

// ---------------------------------------------------------------------------
// Scenario: Mastodon → Fedify (Unfollow)
// ---------------------------------------------------------------------------

async function testUnfollowMastodonFromFedify(): Promise<void> {
  await harnessPost("/_test/reset");

  const accountId = await lookupFedifyAccount();
  await serverPost(`/api/v1/accounts/${accountId}/unfollow`);

  await poll("Undo in harness inbox", async () => {
    const res = await fetch(`${HARNESS_URL}/_test/inbox`);
    const items = await res.json() as { type: string; id: string }[];
    return items.find((a) => a.type === "Undo") ?? null;
  });

  await poll("unfollow confirmed", async () => {
    const rels = await serverGet(
      `/api/v1/accounts/relationships?id[]=${accountId}`,
    ) as Relationship[];
    const rel = rels.find((r) => r.id === accountId);
    return rel && !rel.following ? rel : null;
  });
}

// ---------------------------------------------------------------------------
// Scenario: Fedify → Mastodon (Unfollow)
// ---------------------------------------------------------------------------

async function testUnfollowFedifyFromMastodon(): Promise<void> {
  await harnessPost("/_test/reset");

  const accountId = await lookupFedifyAccount();

  await harnessPost("/_test/unfollow", {
    target: `testuser@${SERVER_INTERNAL_HOST}`,
  });

  await poll("unfollow confirmed on Mastodon", async () => {
    const rels = await serverGet(
      `/api/v1/accounts/relationships?id[]=${accountId}`,
    ) as Relationship[];
    const rel = rels.find((r) => r.id === accountId);
    return rel && !rel.followed_by ? rel : null;
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

try {
  const scenarios: [string, () => Promise<void>][] = [
    ["Mastodon → Fedify (Follow)", testFollowMastodonToFedify],
    ["Fedify → Mastodon (Follow)", testFollowFedifyToMastodon],
    ["Fedify → Mastodon (Create Note)", testCreateNote],
    ["Mastodon → Fedify (Reply)", testReply],
    ["Mastodon → Fedify (Unfollow)", testUnfollowMastodonFromFedify],
    ["Fedify → Mastodon (Unfollow)", testUnfollowFedifyFromMastodon],
  ];

  let failed = false;
  for (const [name, fn] of scenarios) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (err) {
      console.error(`✗ ${name}:`, err);
      failed = true;
    }
  }

  Deno.exit(failed ? 1 : 0);
} catch (err) {
  console.error("\n✗ Unexpected error:", err);
  Deno.exit(1);
}
