import { deepStrictEqual, throws } from "node:assert";
import { test } from "node:test";
import {
  addMulticodecPrefix,
  getMulticodecPrefix,
  removeMulticodecPrefix,
} from "./multicodec.ts";

test("getMulticodecPrefix() decodes supported multicodec prefixes", () => {
  deepStrictEqual(
    getMulticodecPrefix(Uint8Array.from([0xed, 0x01, 0xaa])),
    { code: 0xed, prefixLength: 2 },
  );
  deepStrictEqual(
    getMulticodecPrefix(Uint8Array.from([0x85, 0x24, 0xaa])),
    { code: 0x1205, prefixLength: 2 },
  );
});

test("removeMulticodecPrefix() strips the varint prefix", () => {
  deepStrictEqual(
    removeMulticodecPrefix(Uint8Array.from([0xed, 0x01, 0x11, 0x22])),
    Uint8Array.from([0x11, 0x22]),
  );
});

test("addMulticodecPrefix() prepends the varint-encoded code", () => {
  deepStrictEqual(
    addMulticodecPrefix(0xed, Uint8Array.from([0x11, 0x22])),
    Uint8Array.from([0xed, 0x01, 0x11, 0x22]),
  );
  deepStrictEqual(
    addMulticodecPrefix(0x1205, Uint8Array.from([0x11, 0x22])),
    Uint8Array.from([0x85, 0x24, 0x11, 0x22]),
  );
});

test("multicodec helpers round-trip prefixed payloads", () => {
  const payload = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
  const prefixed = addMulticodecPrefix(0x1205, payload);
  deepStrictEqual(getMulticodecPrefix(prefixed), {
    code: 0x1205,
    prefixLength: 2,
  });
  deepStrictEqual(removeMulticodecPrefix(prefixed), payload);
});

test("multicodec helpers reject malformed prefixes", () => {
  throws(
    () => getMulticodecPrefix(new Uint8Array([])),
    new TypeError("Invalid multicodec prefix."),
  );
  throws(
    () => getMulticodecPrefix(Uint8Array.from([0x80])),
    new TypeError("Invalid multicodec prefix."),
  );
  throws(
    () =>
      getMulticodecPrefix(
        Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80]),
      ),
    new TypeError("Invalid multicodec prefix."),
  );
  throws(
    () => addMulticodecPrefix(-1, Uint8Array.from([0x00])),
    new TypeError("Invalid multicodec code."),
  );
});
