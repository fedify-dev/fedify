declare global {
  var keyPairsStore: Map<string, Array<CryptoKeyPair>>;
  var relationStore: Map<string, string>;
}

export const keyPairsStore: Map<
  string,
  Array<CryptoKeyPair>
> = globalThis.keyPairsStore ?? new Map();
export const relationStore: Map<string, string> =
  globalThis.relationStore ?? new Map();

// this is just a hack to demo nextjs
// never do this in production, use safe and secure storage
globalThis.keyPairsStore = keyPairsStore;
globalThis.relationStore = relationStore;
