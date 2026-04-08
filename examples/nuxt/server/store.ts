import type { Person } from "@fedify/vocab";

export const keyPairsStore = new Map<string, CryptoKeyPair[]>();
export const relationStore = new Map<string, Person>();
