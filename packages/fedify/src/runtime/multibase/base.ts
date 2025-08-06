import { encodeText } from "./util.ts";
import type { BaseCode, BaseName, Codec, CodecFactory } from "./types.d.ts";

/**
 * Class to encode/decode in the supported Bases
 */
export class Base {
  public codeBuf: Uint8Array;
  codec: Codec;

  constructor(
    public name: BaseName,
    private code: BaseCode,
    factory: CodecFactory,
    private alphabet: string,
  ) {
    this.codeBuf = encodeText(this.code);
    this.alphabet = alphabet;
    this.codec = factory(alphabet);
  }

  encode(buf: Uint8Array): string {
    return this.codec.encode(buf);
  }

  decode(string: string): Uint8Array {
    for (const char of string) {
      if (this.alphabet && this.alphabet.indexOf(char) < 0) {
        throw new Error(`invalid character '${char}' in '${string}'`);
      }
    }
    return this.codec.decode(string);
  }
}
