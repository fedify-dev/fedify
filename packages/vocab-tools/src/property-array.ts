/** Emits module-private sparse property-array validation and copying helpers. */
export function generatePropertyArrayHelpers(): string {
  return `
interface VocabSparseArraySnapshot {
  length: number;
  indices: number[];
}

interface VocabArrayValidation {
  valid: boolean;
  sparse: boolean;
}

type VocabArrayCopy<T> = { ok: true; array: T[] } | { ok: false };

// Most fields have no trusted prefix. Keep that metadata on the existing Set
// so empty fields need neither another object nor another instance slot.
const vocabTrustPrefix: unique symbol = Symbol("vocabulary trust prefix");
type VocabTrustSet = Set<number> & { [vocabTrustPrefix]?: number };

function vocabSetTrustPrefix(trust: VocabTrustSet, prefix: number): void {
  if (prefix > 0) trust[vocabTrustPrefix] = prefix;
}

function vocabCopyTrustSet(
  trust: VocabTrustSet,
  destination: VocabTrustSet,
): VocabTrustSet {
  // clone() already constructed the destination. Reuse its empty Set only
  // when constructor defaults cannot contribute trust to the copied field.
  const copy: VocabTrustSet = trust !== destination && trust.size === 0 &&
      destination.size === 0 && destination[vocabTrustPrefix] == null
    ? destination : new Set(trust);
  const prefix = trust[vocabTrustPrefix];
  if (prefix != null && prefix > 0) copy[vocabTrustPrefix] = prefix;
  return copy;
}

// These thresholds select an optimization, not a limit on property arrays.
const vocabSparseArrayMinimumLength = 4096;
const vocabSparseArrayProbeCount = 8;
const vocabSparseArrayPresentProbeLimit = 4;
const vocabArrayPrototype = Array.prototype;
const vocabObjectPrototype = globalThis.Object.prototype;
const vocabArrayDescriptors = ["constructor", "every", "slice"].map(
  key => globalThis.Object.getOwnPropertyDescriptor(vocabArrayPrototype, key),
);
const vocabArraySpeciesDescriptor = globalThis.Object.getOwnPropertyDescriptor(
  Array, Symbol.species,
);

function vocabSameArrayDescriptor(
  actual: PropertyDescriptor | undefined,
  expected: PropertyDescriptor | undefined,
): boolean {
  return actual?.value === expected?.value && actual?.get === expected?.get &&
    actual?.set === expected?.set && actual?.writable === expected?.writable &&
    actual?.enumerable === expected?.enumerable &&
    actual?.configurable === expected?.configurable;
}

function vocabArrayIndex(key: string): number | undefined {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff &&
      String(index) === key
    ? index
    : undefined;
}

function vocabSparseArraySnapshot(
  array: unknown[],
): VocabSparseArraySnapshot | undefined {
  if (!Array.isArray(array)) return undefined;
  const length = array.length;
  // Small dense fields take no prototype or key-enumeration overhead.
  if (length < vocabSparseArrayMinimumLength) return undefined;
  if (!Number.isInteger(length) || length > 0xffffffff ||
      globalThis.Object.getPrototypeOf(array) !== vocabArrayPrototype ||
      globalThis.Object.getPrototypeOf(vocabArrayPrototype) !==
        vocabObjectPrototype ||
      globalThis.Object.getPrototypeOf(vocabObjectPrototype) !== null) {
    return undefined;
  }
  const methods = ["constructor", "every", "slice"];
  for (let i = 0; i < methods.length; i++) {
    const key = methods[i];
    if (globalThis.Object.hasOwn(array, key) ||
        !vocabSameArrayDescriptor(
          globalThis.Object.getOwnPropertyDescriptor(vocabArrayPrototype, key),
          vocabArrayDescriptors[i],
        )) return undefined;
  }
  if (!vocabSameArrayDescriptor(
    globalThis.Object.getOwnPropertyDescriptor(Array, Symbol.species),
    vocabArraySpeciesDescriptor,
  )) return undefined;

  // Descriptor probes do not invoke element getters. Plainly dense arrays
  // keep native iteration without enumerating all their keys.
  let present = 0;
  for (let i = 0; i < vocabSparseArrayProbeCount; i++) {
    const index = Math.floor(i * (length - 1) / (vocabSparseArrayProbeCount - 1));
    if (globalThis.Object.getOwnPropertyDescriptor(array, index) != null &&
        ++present >= vocabSparseArrayPresentProbeLimit) return undefined;
  }
  for (const prototype of [vocabArrayPrototype, vocabObjectPrototype]) {
    for (const key of globalThis.Object.getOwnPropertyNames(prototype)) {
      if (vocabArrayIndex(key) != null) return undefined;
    }
  }
  const indices: number[] = [];
  for (const key of globalThis.Object.getOwnPropertyNames(array)) {
    const index = vocabArrayIndex(key);
    if (index != null && index < length) indices.push(index);
  }
  if (indices.length >= length / 2) return undefined;
  for (const index of indices) {
    const descriptor = globalThis.Object.getOwnPropertyDescriptor(array, index);
    if (descriptor == null || !("value" in descriptor)) return undefined;
  }
  // Ordinary array keys already have canonical index order. This guard is
  // not a Proxy detector; reflection traps and errors remain observable.
  return { length, indices };
}

function vocabValidatePropertyArray<T>(
  array: T[],
  test: (value: T) => boolean,
): VocabArrayValidation {
  const snapshot = vocabSparseArraySnapshot(array);
  if (snapshot == null) return { valid: array.every(test), sparse: false };
  for (const index of snapshot.indices) {
    if (globalThis.Object.hasOwn(array, index) && !test(array[index])) {
      return { valid: false, sparse: true };
    }
  }
  return { valid: true, sparse: true };
}

function vocabDefineArrayEntry<T>(array: T[], index: number, value: T): void {
  globalThis.Object.defineProperty(array, index, {
    value, writable: true, enumerable: true, configurable: true,
  });
}

function vocabCopySparsePropertyArray<T>(
  array: T[],
  snapshot: VocabSparseArraySnapshot,
  test?: (value: T) => boolean,
): VocabArrayCopy<T> {
  const copy: T[] = [];
  // Seed dictionary storage before low indices or the final length can
  // allocate storage for every hole. The temporary entry stays private.
  if (snapshot.indices[snapshot.indices.length - 1] !== snapshot.length - 1) {
    globalThis.Object.defineProperty(copy, snapshot.length - 1, {
      value: undefined, writable: true, enumerable: true, configurable: true,
    });
    delete copy[snapshot.length - 1];
  }
  for (const index of snapshot.indices) {
    if (!globalThis.Object.hasOwn(array, index)) continue;
    const value = array[index];
    if (test != null && !test(value)) return { ok: false };
    vocabDefineArrayEntry(copy, index, value);
  }
  // A validation callback may have deleted the last snapshot entry.
  if (copy.length < snapshot.length) {
    globalThis.Object.defineProperty(copy, snapshot.length - 1, {
      value: undefined, writable: true, enumerable: true, configurable: true,
    });
    delete copy[snapshot.length - 1];
  }
  copy.length = snapshot.length;
  return { ok: true, array: copy };
}

function vocabCopyPropertyArray<T>(array: T[]): T[] {
  const snapshot = vocabSparseArraySnapshot(array);
  if (snapshot == null) return array.slice();
  const copied = vocabCopySparsePropertyArray(array, snapshot);
  // Without a predicate the private copy cannot fail validation.
  return (copied as { ok: true; array: T[] }).array;
}

function vocabCopyValidatedPropertyArray<T>(
  array: T[],
  test: (value: T) => boolean,
  previous: VocabArrayValidation,
): VocabArrayCopy<T> {
  const snapshot = vocabSparseArraySnapshot(array);
  if (snapshot != null) return vocabCopySparsePropertyArray(array, snapshot, test);
  // Sparse validation may have changed the next input's density, descriptors
  // or prototype. Validate that native-copy input before falling back.
  if (previous.sparse && !array.every(test)) return { ok: false };
  return { ok: true, array: array.slice() };
}
`;
}
