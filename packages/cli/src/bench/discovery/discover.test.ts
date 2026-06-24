import { Endpoints, Note, Person } from "@fedify/vocab";
import assert from "node:assert/strict";
import test from "node:test";
import { discoverInbox, DiscoveryError, selectInbox } from "./discover.ts";

function actor(): Person {
  return new Person({
    id: new URL("http://localhost:3000/users/alice"),
    inbox: new URL("http://localhost:3000/users/alice/inbox"),
    endpoints: new Endpoints({
      sharedInbox: new URL("http://localhost:3000/inbox"),
    }),
  });
}

test("discoverInbox - resolves personal and shared inboxes", async () => {
  const discovered = await discoverInbox("acct:alice@localhost:3000", {
    lookup: () => Promise.resolve(actor()),
  });
  assert.strictEqual(
    discovered.actorUri.href,
    "http://localhost:3000/users/alice",
  );
  assert.strictEqual(
    discovered.personalInbox.href,
    "http://localhost:3000/users/alice/inbox",
  );
  assert.strictEqual(
    discovered.sharedInbox?.href,
    "http://localhost:3000/inbox",
  );
});

test("discoverInbox - throws when the recipient is not an actor", async () => {
  await assert.rejects(
    discoverInbox("acct:bob@localhost", {
      lookup: () => Promise.resolve(new Note({})),
    }),
    DiscoveryError,
  );
});

test("discoverInbox - throws when resolution fails", async () => {
  await assert.rejects(
    discoverInbox("acct:bob@localhost", {
      lookup: () => Promise.reject(new Error("boom")),
    }),
    DiscoveryError,
  );
});

test("discoverInbox - throws when the actor has no inbox", async () => {
  await assert.rejects(
    discoverInbox("acct:bob@localhost", {
      lookup: () =>
        Promise.resolve(
          new Person({ id: new URL("http://localhost/users/bob") }),
        ),
    }),
    DiscoveryError,
  );
});

test("selectInbox - shared is the default and falls back to personal", () => {
  const both = {
    actorUri: new URL("http://localhost/users/a"),
    personalInbox: new URL("http://localhost/users/a/inbox"),
    sharedInbox: new URL("http://localhost/inbox"),
  };
  assert.strictEqual(
    selectInbox(both, undefined).href,
    "http://localhost/inbox",
  );
  assert.strictEqual(
    selectInbox(both, "shared").href,
    "http://localhost/inbox",
  );
  assert.strictEqual(
    selectInbox(both, "personal").href,
    "http://localhost/users/a/inbox",
  );
  const personalOnly = { ...both, sharedInbox: null };
  assert.strictEqual(
    selectInbox(personalOnly, "shared").href,
    "http://localhost/users/a/inbox",
  );
});

test("selectInbox - an explicit URL is used verbatim", () => {
  const discovered = {
    actorUri: new URL("http://localhost/users/a"),
    personalInbox: new URL("http://localhost/users/a/inbox"),
    sharedInbox: null,
  };
  assert.strictEqual(
    selectInbox(discovered, "http://localhost/custom-inbox").href,
    "http://localhost/custom-inbox",
  );
});
