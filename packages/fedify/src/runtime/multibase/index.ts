import * as constants from "./constants.ts";
import { concat, decodeText, encodeText } from "./util.ts";
import type { BaseCode, BaseName, BaseNameOrCode } from "./types.d.ts";
import type { Base } from "./base.ts";

/**
 * Encode data with the specified base and add the multibase prefix.
 *
 * @throws {Error} Will throw if the encoding is not supported
 */
export function encode(
  nameOrCode: BaseNameOrCode,
  buf: Uint8Array,
): Uint8Array {
  const enc = encoding(nameOrCode);
  const data = encodeText(enc.encode(buf));

  return concat([enc.codeBuf, data], enc.codeBuf.length + data.length);
}

/**
 * Takes a Uint8Array or string encoded with multibase header, decodes it and
 * returns the decoded buffer
 *
 * @throws {Error} Will throw if the encoding is not supported
 */
export function decode(data: Uint8Array | string): Uint8Array {
  if (data instanceof Uint8Array) {
    data = decodeText(data);
  }
  const prefix = data[0];

  // Make all encodings case-insensitive except the ones that include upper and lower chars in the alphabet
  if (
    ["f", "F", "v", "V", "t", "T", "b", "B", "c", "C", "h", "k", "K"].includes(
      prefix,
    )
  ) {
    data = data.toLowerCase();
  }
  const enc = encoding(data[0] as BaseCode);
  return enc.decode(data.substring(1));
}

/**
 * Get the encoding by name or code
 * @throws {Error} Will throw if the encoding is not supported
 */
function encoding(nameOrCode: BaseNameOrCode): Base {
  if (
    Object.prototype.hasOwnProperty.call(
      constants.names,
      nameOrCode as BaseName,
    )
  ) {
    return constants.names[nameOrCode as BaseName];
  } else if (
    Object.prototype.hasOwnProperty.call(
      constants.codes,
      /** @type {BaseCode} */ (nameOrCode),
    )
  ) {
    return constants.codes[nameOrCode as BaseCode];
  } else {
    throw new Error(`Unsupported encoding: ${nameOrCode}`);
  }
}

/**
 * Get encoding from data
 *
 * @param {string|Uint8Array} data
 * @returns {Base}
 * @throws {Error} Will throw if the encoding is not supported
 */
export function encodingFromData(data: string | Uint8Array): Base {
  if (data instanceof Uint8Array) {
    data = decodeText(data);
  }

  return encoding(data[0] as BaseCode);
}
