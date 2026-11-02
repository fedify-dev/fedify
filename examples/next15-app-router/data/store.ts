/* eslint-disable @typescript-eslint/no-explicit-any */
// oxlint-disable typescript/no-explicit-any

export const keyPairsStore: Map<string, Array<CryptoKeyPair>> = (
  globalThis as any
).keyPairsStore ?? new Map();
export const relationStore: Map<string, string> =
  (globalThis as any).relationStore ?? new Map();

// this is just a hack to demo nextjs
// never do this in production, use safe and secure storage
(globalThis as any).keyPairsStore = keyPairsStore;
(globalThis as any).relationStore = relationStore;
