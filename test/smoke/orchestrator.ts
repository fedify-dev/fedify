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

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const SERVER_URL = requireEnv("SERVER_BASE_URL");
const SERVER_TOKEN = requireEnv("SERVER_ACCESS_TOKEN");
const HARNESS_URL = requireEnv("HARNESS_BASE_URL");
const HARNESS_ORIGIN = requireEnv("HARNESS_ORIGIN");
const SERVER_INTERNAL_HOST = requireEnv("SERVER_INTERNAL_HOST");

const HARNESS_HOST = new URL(HARNESS_ORIGIN).host;

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
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result !== null) return result;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  const suffix = lastError instanceof Error
    ? ` (last error: ${lastError.message})`
    : "";
  throw new Error(`Timed out waiting for: ${label}${suffix}`);
}

type InboxItem = {
  type: string;
  id: string;
  receivedAt: string;
  inReplyTo?: string;
  content?: string;
};

async function snapshotInboxIds(): Promise<Set<string>> {
  const res = await fetch(`${HARNESS_URL}/_test/inbox`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Harness inbox fetch failed → ${res.status}: ${body}`);
  }
  const items = await res.json() as InboxItem[];
  return new Set(items.map((a) => a.id));
}

function pollHarnessInbox(
  activityType: string,
  filter?: (item: InboxItem) => boolean,
): Promise<InboxItem> {
  return poll(`${activityType} in harness inbox`, async () => {
    const res = await fetch(`${HARNESS_URL}/_test/inbox`);
    if (!res.ok) {
      throw new Error(
        `Harness inbox poll failed → ${res.status}: ${await res.text()}`,
      );
    }
    const items = await res.json() as InboxItem[];
    return items.find((a) =>
      a.type === activityType &&
      (!filter || filter(a))
    ) ?? null;
  });
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
  requested: boolean;
};

// Resolved once by the first follow scenario and reused by later scenarios.
let fedifyAccountId: string | undefined;

async function lookupFedifyAccount(): Promise<string> {
  if (fedifyAccountId) return fedifyAccountId;

  const handle = `testuser@${HARNESS_HOST}`;

  const searchResult = await poll("Fedify user resolvable", async () => {
    // Try /api/v1/accounts/search (Mastodon standard).
    // Fall back to /api/v1/accounts/lookup (exact match, supported by Sharkey)
    // if search returns 404.
    try {
      const results = await serverGet(
        `/api/v1/accounts/search?q=${
          encodeURIComponent(`@${handle}`)
        }&resolve=true&limit=5`,
      ) as RemoteAccount[];
      const match = results?.find((a) =>
        a.acct === handle || a.acct === `@${handle}`
      );
      if (match) return match;
    } catch {
      // Search endpoint may return 404 on some servers (e.g. Sharkey);
      // fall through to the lookup endpoint.
    }

    try {
      const account = await serverGet(
        `/api/v1/accounts/lookup?acct=${encodeURIComponent(handle)}`,
      ) as RemoteAccount;
      if (account?.id) return account;
    } catch {
      // lookup also failed
    }

    // Misskey-native fallback: POST /api/users/show with username + host.
    // Sharkey's Mastodon-compat search/lookup endpoints have bugs with
    // remote users, but the native API works reliably.  The returned id
    // is the same internal ID used by the Mastodon-compat layer.
    try {
      const [user, host] = handle.split("@");
      const res = await fetch(`${SERVER_URL}/api/users/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, host }),
      });
      if (res.ok) {
        const data = await res.json() as { id?: string };
        if (data?.id) return { id: data.id, acct: handle };
      }
    } catch {
      // Not a Misskey-family server
    }

    return null;
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
  const knownIds = await snapshotInboxIds();
  await serverPost(`/api/v1/accounts/${accountId}/follow`);

  await pollHarnessInbox("Follow", (a) => !knownIds.has(a.id));

  // Wait until Mastodon has processed the Accept from the harness.
  // Check both following=true AND requested=false: the latter only
  // flips once the Accept activity has actually been received.
  await poll("follow accepted", async () => {
    const rels = await serverGet(
      `/api/v1/accounts/relationships?id[]=${accountId}`,
    ) as Relationship[];
    const rel = rels.find((r) => r.id === accountId);
    return rel?.following && !rel?.requested ? rel : null;
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
  const knownIds = await snapshotInboxIds();

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

  await pollHarnessInbox("Accept", (a) => !knownIds.has(a.id));
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

  // Find a note from the Fedify harness on the Mastodon timeline to reply to.
  type Status = {
    id: string;
    content: string;
    uri: string;
    account: { acct: string };
  };
  const parent = await poll("find Fedify note to reply to", async () => {
    const statuses = await serverGet(
      "/api/v1/timelines/home?limit=20",
    ) as Status[];
    return statuses.find((s) => s.account.acct.includes(HARNESS_HOST)) ??
      null;
  });

  const token = `smoke-reply-${crypto.randomUUID()}`;
  const handle = `@testuser@${HARNESS_HOST}`;
  const replyContent = `${token} ${handle}`;

  const knownIds = await snapshotInboxIds();

  await serverPost("/api/v1/statuses", {
    status: replyContent,
    in_reply_to_id: parent.id,
  });

  const received = await pollHarnessInbox(
    "Create",
    (a) => !knownIds.has(a.id) && !!a.content?.includes(token),
  );

  if (!received.inReplyTo) {
    throw new Error(
      "Received Create activity has no inReplyTo—" +
        "cannot distinguish reply from plain mention",
    );
  }
  if (received.inReplyTo !== parent.uri) {
    throw new Error(
      `inReplyTo mismatch: expected ${parent.uri}, ` +
        `got ${received.inReplyTo}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Scenario: Mastodon → Fedify (Unfollow)
// ---------------------------------------------------------------------------

async function testUnfollowMastodonFromFedify(): Promise<void> {
  await harnessPost("/_test/reset");
  const knownIds = await snapshotInboxIds();

  const accountId = await lookupFedifyAccount();
  await serverPost(`/api/v1/accounts/${accountId}/unfollow`);

  // Primary assertion: the server-side relationship must show following=false.
  await poll("unfollow confirmed", async () => {
    const rels = await serverGet(
      `/api/v1/accounts/relationships?id[]=${accountId}`,
    ) as Relationship[];
    const rel = rels.find((r) => r.id === accountId);
    return rel && !rel.following ? rel : null;
  });

  // The harness should receive an Undo Follow activity.
  await pollHarnessInbox("Undo", (a) => !knownIds.has(a.id));
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
