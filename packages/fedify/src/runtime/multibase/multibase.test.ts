import { decode, encode } from "./index.ts";
import * as constants from "./constants.ts";
import { decodeText, encodeText } from "./util.ts";
import { assertEquals } from "@std/assert";
import { test } from "../../testing/mod.ts";
import type { BaseName } from "./types.d.ts";

test("multibase.encode and decode", async (t) => {
  const testCases: Array<[BaseName, string, string]> = [
    ["base16", decodeText(Uint8Array.from([0x01])), "f01"],
    ["base16", decodeText(Uint8Array.from([15])), "f0f"],
    ["base16", "f", "f66"],
    ["base16", "fo", "f666f"],
    ["base16", "foo", "f666f6f"],
    ["base16", "foob", "f666f6f62"],
    ["base16", "fooba", "f666f6f6261"],
    ["base16", "foobar", "f666f6f626172"],
    ["base32", "yes mani !", "bpfsxgidnmfxgsibb"],
    ["base32", "f", "bmy"],
    ["base32", "fo", "bmzxq"],
    ["base32", "foo", "bmzxw6"],
    ["base32", "foob", "bmzxw6yq"],
    ["base32", "fooba", "bmzxw6ytb"],
    ["base32", "foobar", "bmzxw6ytboi"],
    ["base32pad", "yes mani !", "cpfsxgidnmfxgsibb"],
    ["base32pad", "f", "cmy======"],
    ["base32pad", "fo", "cmzxq===="],
    ["base32pad", "foo", "cmzxw6==="],
    ["base32pad", "foob", "cmzxw6yq="],
    ["base32pad", "fooba", "cmzxw6ytb"],
    ["base32pad", "foobar", "cmzxw6ytboi======"],
    ["base32hex", "yes mani !", "vf5in683dc5n6i811"],
    ["base32hex", "f", "vco"],
    ["base32hex", "fo", "vcpng"],
    ["base32hex", "foo", "vcpnmu"],
    ["base32hex", "foob", "vcpnmuog"],
    ["base32hex", "fooba", "vcpnmuoj1"],
    ["base32hex", "foobar", "vcpnmuoj1e8"],
    ["base32hexpad", "yes mani !", "tf5in683dc5n6i811"],
    ["base32hexpad", "f", "tco======"],
    ["base32hexpad", "fo", "tcpng===="],
    ["base32hexpad", "foo", "tcpnmu==="],
    ["base32hexpad", "foob", "tcpnmuog="],
    ["base32hexpad", "fooba", "tcpnmuoj1"],
    ["base32hexpad", "foobar", "tcpnmuoj1e8======"],
    ["base32z", "yes mani !", "hxf1zgedpcfzg1ebb"],
    ["base58flickr", "yes mani !", "Z7Pznk19XTTzBtx"],
    ["base58btc", "yes mani !", "z7paNL19xttacUY"],
    ["base64", "÷ïÿ", "mw7fDr8O/"],
    ["base64", "f", "mZg"],
    ["base64", "fo", "mZm8"],
    ["base64", "foo", "mZm9v"],
    ["base64", "foob", "mZm9vYg"],
    ["base64", "fooba", "mZm9vYmE"],
    ["base64", "foobar", "mZm9vYmFy"],
    ["base64", "÷ïÿ🥰÷ïÿ😎🥶🤯", "mw7fDr8O/8J+lsMO3w6/Dv/CfmI7wn6W28J+krw"],
    ["base64pad", "f", "MZg=="],
    ["base64pad", "fo", "MZm8="],
    ["base64pad", "foo", "MZm9v"],
    ["base64pad", "foob", "MZm9vYg=="],
    ["base64pad", "fooba", "MZm9vYmE="],
    ["base64pad", "foobar", "MZm9vYmFy"],
    ["base64url", "÷ïÿ", "uw7fDr8O_"],
    ["base64url", "÷ïÿ🥰÷ïÿ😎🥶🤯", "uw7fDr8O_8J-lsMO3w6_Dv_CfmI7wn6W28J-krw"],
    ["base64urlpad", "f", "UZg=="],
    ["base64urlpad", "fo", "UZm8="],
    ["base64urlpad", "foo", "UZm9v"],
    ["base64urlpad", "foob", "UZm9vYg=="],
    ["base64urlpad", "fooba", "UZm9vYmE="],
    ["base64urlpad", "foobar", "UZm9vYmFy"],
    [
      "base64urlpad",
      "÷ïÿ🥰÷ïÿ😎🥶🤯",
      "Uw7fDr8O_8J-lsMO3w6_Dv_CfmI7wn6W28J-krw==",
    ],
  ];

  for (const [name, input, expectedOutput] of testCases) {
    await t.step(`Encoding/Decoding ${name} with ${input}`, () => {
      const encoded = encode(name, encodeText(input));
      assertEquals(
        decodeText(encoded),
        expectedOutput,
        `Encoding ${name} failed`,
      );

      const decoded = decode(expectedOutput);
      assertEquals(decoded, encodeText(input), `Decoding ${name} failed`);

      const decodedFromBuffer = decode(encodeText(expectedOutput));
      assertEquals(
        decodedFromBuffer,
        encodeText(input),
        `Decoding buffer of ${name} failed`,
      );
    });
  }

  await t.step("should allow base32pad full alphabet", () => {
    const encodedStr = "ctimaq4ygg2iegci7";
    const decoded = decode(encodedStr);
    const encoded = encode("c", decoded);
    assertEquals(decode(encoded), decoded);
  });
});

test("constants", async (t) => {
  await t.step("constants indexed by name", () => {
    const names = constants.names;
    assertEquals(Object.keys(names).length, 23);
  });

  await t.step("constants indexed by code", () => {
    const codes = constants.codes;
    assertEquals(Object.keys(codes).length, 23);
  });
});
