import { MemoryKvStore } from "@fedify/fedify";
import { createRelay, type RelayType } from "@fedify/relay";
import { strictEqual } from "node:assert";
import test, { describe } from "node:test";

describe("createRelay", () => {
  for (const type of ["mastodon", "litepub"] satisfies RelayType[]) {
    test(`${type} exposes the canonical relay URIs`, async () => {
      const relay = createRelay(type, {
        kv: new MemoryKvStore(),
        origin: "https://relay.example.com",
        subscriptionHandler: () => Promise.resolve(true),
      });

      strictEqual(
        (await relay.getActorUri()).href,
        "https://relay.example.com/users/relay",
      );
      strictEqual(
        (await relay.getSharedInboxUri()).href,
        "https://relay.example.com/inbox",
      );
    });
  }
});
