const INVALID_MULTICODEC_PREFIX = "Invalid multicodec prefix.";

export interface MulticodecPrefix {
  code: number;
  prefixLength: number;
}

export function getMulticodecPrefix(
  data: Uint8Array,
): MulticodecPrefix {
  if (data.length < 1) throw new TypeError(INVALID_MULTICODEC_PREFIX);
  let code = 0;
  let shift = 0;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    code += (byte & 0x7f) * 2 ** shift;
    if (code > Number.MAX_SAFE_INTEGER) {
      throw new TypeError(INVALID_MULTICODEC_PREFIX);
    }
    if ((byte & 0x80) === 0) {
      return { code, prefixLength: i + 1 };
    }
    shift += 7;
    if (shift >= 53) throw new TypeError(INVALID_MULTICODEC_PREFIX);
  }
  throw new TypeError(INVALID_MULTICODEC_PREFIX);
}

export function removeMulticodecPrefix(data: Uint8Array): Uint8Array {
  const { prefixLength } = getMulticodecPrefix(data);
  return data.slice(prefixLength);
}

export function addMulticodecPrefix(
  code: number,
  payload: Uint8Array,
): Uint8Array {
  if (!Number.isSafeInteger(code) || code < 0) {
    throw new TypeError("Invalid multicodec code.");
  }
  const prefix: number[] = [];
  let value = code;
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 0x80);
    if (value > 0) byte |= 0x80;
    prefix.push(byte);
  } while (value > 0);
  const prefixed = new Uint8Array(prefix.length + payload.length);
  prefixed.set(prefix);
  prefixed.set(payload, prefix.length);
  return prefixed;
}
