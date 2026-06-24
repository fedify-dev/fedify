import assert from "node:assert/strict";
import test from "node:test";
import { createActivityIdMinter } from "./activity-id.ts";

test("createActivityIdMinter - mints unique ids under the base", () => {
  const minter = createActivityIdMinter(new URL("http://127.0.0.1:3000"));
  const a = minter.next();
  const b = minter.next();
  assert.notStrictEqual(a.href, b.href);
  assert.strictEqual(a.protocol, "http:");
  assert.strictEqual(a.hostname, "127.0.0.1");
  assert.match(a.pathname, /^\/activities\//);
});

test("createActivityIdMinter - separate minters do not collide", () => {
  const base = new URL("http://127.0.0.1:3000");
  const first = createActivityIdMinter(base).next();
  const second = createActivityIdMinter(base).next();
  assert.notStrictEqual(first.href, second.href);
});
