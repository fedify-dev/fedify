const textDecoder = new TextDecoder();
export const decodeText = (bytes: DataView | Uint8Array): string =>
  textDecoder.decode(bytes);

const textEncoder = new TextEncoder();
export const encodeText = (text: string): Uint8Array =>
  textEncoder.encode(text);

export function concat(
  arrs: Array<ArrayLike<number>>,
  length: number,
): Uint8Array {
  const output = new Uint8Array(length);
  let offset = 0;

  for (const arr of arrs) {
    output.set(arr, offset);
    offset += arr.length;
  }

  return output;
}
