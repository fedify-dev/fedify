// The Workers suite is deliberately bounded to tests validated on workerd.
export const expectedTestNames = [
  "ignored nested test steps return false",
  "ManualClockKvStore keeps an entry at its exact expiration instant",
  "ManualClockKvStore.list() applies the same boundary",
  "ManualClockKvStore.cas() applies the same boundary",
  "ManualClockKvStore.cas() without a TTL clears the expiration",
  "ManualClockKvStore withholds the TTL from the wrapped store",
  "ManualClockKvStore exposes cas() only when the wrapped store does",
  "ManualClockKvStore over a store without cas() keeps the open deduplication fallback",
  "vocab-runtime portable URI formats on Workers",
  "vocab-runtime compatible IDs on Workers",
  "vocab-runtime did:key on Workers",
  "vocab-runtime hashlink on Workers",
  "vocab-runtime gateway candidates on Workers",
  "lookupObject() with FEP-ef61 portable actors",
] as const;
