import baseX from "@multiformats/base-x";
import { Base } from "./base.ts";
import { rfc4648 } from "./rfc4648.ts";
import { decodeText, encodeText } from "./util.ts";
import type { BaseCode, BaseName, CodecFactory } from "./types.d.ts";

const identity: CodecFactory = () => {
  return {
    encode: decodeText,
    decode: encodeText,
  };
};

/**
 * name, code, implementation, alphabet
 *
 * @type {Array<[BaseName, BaseCode, CodecFactory, string]>}
 */
const constants: Array<[BaseName, BaseCode, CodecFactory, string]> = [
  ["identity", "\x00", identity, ""],
  ["base2", "0", rfc4648(1), "01"],
  ["base8", "7", rfc4648(3), "01234567"],
  ["base10", "9", baseX, "0123456789"],
  ["base16", "f", rfc4648(4), "0123456789abcdef"],
  ["base16upper", "F", rfc4648(4), "0123456789ABCDEF"],
  ["base32hex", "v", rfc4648(5), "0123456789abcdefghijklmnopqrstuv"],
  ["base32hexupper", "V", rfc4648(5), "0123456789ABCDEFGHIJKLMNOPQRSTUV"],
  ["base32hexpad", "t", rfc4648(5), "0123456789abcdefghijklmnopqrstuv="],
  ["base32hexpadupper", "T", rfc4648(5), "0123456789ABCDEFGHIJKLMNOPQRSTUV="],
  ["base32", "b", rfc4648(5), "abcdefghijklmnopqrstuvwxyz234567"],
  ["base32upper", "B", rfc4648(5), "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"],
  ["base32pad", "c", rfc4648(5), "abcdefghijklmnopqrstuvwxyz234567="],
  ["base32padupper", "C", rfc4648(5), "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567="],
  ["base32z", "h", rfc4648(5), "ybndrfg8ejkmcpqxot1uwisza345h769"],
  ["base36", "k", baseX, "0123456789abcdefghijklmnopqrstuvwxyz"],
  ["base36upper", "K", baseX, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
  [
    "base58btc",
    "z",
    baseX,
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
  ],
  [
    "base58flickr",
    "Z",
    baseX,
    "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ",
  ],
  [
    "base64",
    "m",
    rfc4648(6),
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
  ],
  [
    "base64pad",
    "M",
    rfc4648(6),
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
  ],
  [
    "base64url",
    "u",
    rfc4648(6),
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  ],
  [
    "base64urlpad",
    "U",
    rfc4648(6),
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=",
  ],
];

export const names: Record<BaseName, Base> = constants.reduce<
  Record<BaseName, Base>
>(
  (prev, tupple) => {
    prev[tupple[0]] = new Base(tupple[0], tupple[1], tupple[2], tupple[3]);
    return prev;
  },
  {} as Record<BaseName, Base>,
);

export const codes: Record<BaseCode, Base> = constants.reduce<
  Record<BaseCode, Base>
>(
  (prev, tupple) => {
    prev[tupple[1]] = names[tupple[0]];
    return prev;
  },
  {} as Record<BaseCode, Base>,
);
