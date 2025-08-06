import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/assert-equals";
import { assertInstanceOf } from "@std/assert/assert-instance-of";
import { MemoryKvStore } from "../federation/kv.ts";
import { FederationImpl } from "../federation/middleware.ts";
import { test } from "../testing/mod.ts";
import { Follow, Person } from "../vocab/vocab.ts";
import { actorDehydrator, autoIdAssigner } from "./transformers.ts";

const federation = new FederationImpl<void>({
  kv: new MemoryKvStore(),
});
const context = federation.createContext(new URL("http://example.com/"));

test("autoIdAssigner", async () => {
  const activity = new Follow({
    actor: new URL("http://example.com/actors/1"),
    object: new Person({
      id: new URL("http://example.com/actors/2"),
      name: "Bob",
      preferredUsername: "bob",
    }),
  });
  const result = autoIdAssigner(activity, context);
  const { id } = result;
  assertInstanceOf(id, URL);
  assertEquals(id.origin, "http://example.com");
  assertEquals(id.pathname, "/");
  assertEquals(id.search, "");
  assert(
    id.hash.match(
      /^#Follow\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    ),
  );
  assertEquals(
    await result.toJsonLd(),
    await new Follow({
      id,
      actor: new URL("http://example.com/actors/1"),
      object: new Person({
        id: new URL("http://example.com/actors/2"),
        name: "Bob",
        preferredUsername: "bob",
      }),
    }).toJsonLd(),
  );
});

test("actorDehydrator()", async () => {
  const activity = new Follow({
    id: new URL("http://example.com/activities/1"),
    actor: new Person({
      id: new URL("http://example.com/actors/1"),
      name: "Alice",
      preferredUsername: "alice",
    }),
    object: new Person({
      id: new URL("http://example.com/actors/2"),
      name: "Bob",
      preferredUsername: "bob",
    }),
  });
  const result = actorDehydrator(activity, context);
  assertEquals(
    await result.toJsonLd(),
    await new Follow({
      id: new URL("http://example.com/activities/1"),
      actor: new URL("http://example.com/actors/1"),
      object: new Person({
        id: new URL("http://example.com/actors/2"),
        name: "Bob",
        preferredUsername: "bob",
      }),
    }).toJsonLd(),
  );
});
