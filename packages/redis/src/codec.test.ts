import { DecodingError, EncodingError, JsonCodec } from "@fedify/redis/codec";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";

test("JsonCodec.encode()", () => {
  const codec = new JsonCodec();
  assert.deepStrictEqual(
    codec.encode({ foo: "bar" }),
    Buffer.from(new TextEncoder().encode('{"foo":"bar"}')),
  );
  assert.throws(
    () => codec.encode(1n),
    EncodingError,
  );
});

test("JsonCodec.decode()", () => {
  const codec = new JsonCodec();
  assert.deepStrictEqual(
    codec.decode(Buffer.from(new TextEncoder().encode('{"foo":"bar"}'))),
    { foo: "bar" },
  );
  assert.throws(
    () => codec.decode(Buffer.from(new TextEncoder().encode("invalid"))),
    DecodingError,
  );
});
