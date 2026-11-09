import type { Person } from "@fedify/vocab";

declare global {
  var keyPairsStore: Map<string, CryptoKeyPair[]>;
  var relationStore: Map<string, Person>;
}

export const keyPairsStore: Map<string, CryptoKeyPair[]> =
  globalThis.keyPairsStore ?? new Map();
export const relationStore: Map<string, Person> =
  globalThis.relationStore ?? new Map();

// This is just a hack for the demo.
// Never do this in production; use safe and secure storage.
globalThis.keyPairsStore = keyPairsStore;
globalThis.relationStore = relationStore;
