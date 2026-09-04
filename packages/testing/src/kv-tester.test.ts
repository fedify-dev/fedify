import { MemoryKvStore } from "@fedify/fedify";
import { test } from "@fedify/fixture";
import "temporal-polyfill/global";
import testKvStore from "./kv-tester.ts";

test("testKvStore() validates MemoryKvStore", () =>
  testKvStore(
    () => new MemoryKvStore(),
    () => undefined,
  ));
