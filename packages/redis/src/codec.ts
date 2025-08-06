import { Buffer } from "node:buffer";

/**
 * Encode and decodes JavaScript objects to and from binary data.
 */
export interface Codec {
  /**
   * Encodes a JavaScript object to binary data.
   * @param value The JavaScript object to encode.
   * @returns The encoded binary data.
   * @throws {EncodingError} If the JavaScript object cannot be encoded.
   */
  encode(value: unknown): Buffer;

  /**
   * Decodes a JavaScript object from binary data.
   * @param encoded The binary data to decode.
   * @returns The decoded JavaScript object.
   * @throws {DecodingError} If the binary data is invalid.
   */
  decode(encoded: Buffer): unknown;
}

/**
 * An error that occurs when encoding or decoding data.
 */
export class CodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodecError";
  }
}

/**
 * An error that occurs when encoding data.
 */
export class EncodingError extends CodecError {
  constructor(message: string) {
    super(message);
    this.name = "EncodingError";
  }
}

/**
 * An error that occurs when decoding data.
 */
export class DecodingError extends CodecError {
  constructor(message: string) {
    super(message);
    this.name = "DecodingError";
  }
}

/**
 * A codec that encodes and decodes JavaScript objects to and from JSON.
 */
export class JsonCodec implements Codec {
  #textEncoder = new TextEncoder();
  #textDecoder = new TextDecoder();

  encode(value: unknown): Buffer {
    let json: string;
    try {
      json = JSON.stringify(value);
    } catch (e) {
      if (e instanceof TypeError) throw new EncodingError(e.message);
      throw e;
    }
    return Buffer.from(this.#textEncoder.encode(json));
  }

  decode(encoded: Buffer): unknown {
    const json = this.#textDecoder.decode(encoded);
    try {
      return JSON.parse(json);
    } catch (e) {
      if (e instanceof SyntaxError) throw new DecodingError(e.message);
      throw e;
    }
  }
}
