import { assertEquals } from "@std/assert";
import { decodeHex } from "byte-encodings/hex";
import { test } from "../testing/mod.ts";
import { buildCollectionSynchronizationHeader, digest } from "./collection.ts";

test("digest()", async () => {
  // See also:
  // https://codeberg.org/fediverse/fep/src/branch/main/fep/8fcf/fep-8fcf.md#partial-follower-collection-digest
  const uris = [
    new URL("https://testing.example.org/users/1"),
    new URL("https://testing.example.org/users/2"),
    new URL("https://testing.example.org/users/2"), // dup
  ];
  const result = await digest(uris);
  assertEquals(
    result,
    decodeHex(
      "c33f48cd341ef046a206b8a72ec97af65079f9a3a9b90eef79c5920dce45c61f",
    ),
  );
});

test("buildCollectionSynchronizationHeader()", async () => {
  const header = await buildCollectionSynchronizationHeader(
    "https://testing.example.org/users/1/followers",
    [
      "https://testing.example.org/users/2",
      "https://testing.example.org/users/1",
    ],
  );
  assertEquals(
    header,
    'collectionId="https://testing.example.org/users/1/followers", ' +
      'url="https://testing.example.org/users/1/followers' +
      '?base-url=https%3A%2F%2Ftesting.example.org%2F", ' +
      'digest="c33f48cd341ef046a206b8a72ec97af65079f9a3a9b90eef79c5920dce45c61f"',
  );
});

// cSpell: ignore 2Ftesting
