import type { CodecFactory } from "./types.d.ts";

const decode = (
  string: string,
  alphabet: string,
  bitsPerChar: number,
): Uint8Array => {
  // Build the character lookup table:
  const codes: Record<string, number> = {};
  for (let i = 0; i < alphabet.length; ++i) {
    codes[alphabet[i]] = i;
  }

  // Count the padding bytes:
  let end = string.length;
  while (string[end - 1] === "=") {
    --end;
  }

  // Allocate the output:
  const out = new Uint8Array((end * bitsPerChar / 8) | 0);

  // Parse the data:
  let bits = 0; // Number of bits currently in the buffer
  let buffer = 0; // Bits waiting to be written out, MSB first
  let written = 0; // Next byte to write
  for (let i = 0; i < end; ++i) {
    // Read one character from the string:
    const value = codes[string[i]];
    if (value === undefined) {
      throw new SyntaxError("Invalid character " + string[i]);
    }

    // Append the bits to the buffer:
    buffer = (buffer << bitsPerChar) | value;
    bits += bitsPerChar;

    // Write out some bits if the buffer has a byte's worth:
    if (bits >= 8) {
      bits -= 8;
      out[written++] = 0xff & (buffer >> bits);
    }
  }

  // Verify that we have received just enough bits:
  if (bits >= bitsPerChar || 0xff & (buffer << (8 - bits))) {
    throw new SyntaxError("Unexpected end of data");
  }

  return out;
};

const encode = (
  data: Uint8Array,
  alphabet: string,
  bitsPerChar: number,
): string => {
  const pad = alphabet[alphabet.length - 1] === "=";
  const mask = (1 << bitsPerChar) - 1;
  let out = "";

  let bits = 0; // Number of bits currently in the buffer
  let buffer = 0; // Bits waiting to be written out, MSB first
  for (let i = 0; i < data.length; ++i) {
    // Slurp data into the buffer:
    buffer = (buffer << 8) | data[i];
    bits += 8;

    // Write out as much as we can:
    while (bits > bitsPerChar) {
      bits -= bitsPerChar;
      out += alphabet[mask & (buffer >> bits)];
    }
  }

  // Partial character:
  if (bits) {
    out += alphabet[mask & (buffer << (bitsPerChar - bits))];
  }

  // Add padding characters until we hit a byte boundary:
  if (pad) {
    while ((out.length * bitsPerChar) & 7) {
      out += "=";
    }
  }

  return out;
};

/**
 * RFC4648 Factory
 */
export const rfc4648 = (bitsPerChar: number): CodecFactory => (alphabet) => {
  return {
    encode(input: Uint8Array): string {
      return encode(input, alphabet, bitsPerChar);
    },
    decode(input: string): Uint8Array {
      return decode(input, alphabet, bitsPerChar);
    },
  };
};
