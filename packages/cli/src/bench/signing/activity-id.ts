/**
 * Unique activity-id minting.
 *
 * Inbox idempotency is always on in Fedify: a duplicate activity `id` is
 * short-circuited before the listener runs.  So the load generator must mint a
 * unique `id` per request, which is exactly what real traffic looks like; the
 * tool owns the id so an author cannot forget it.
 * @since 2.3.0
 * @module
 */

/** Mints unique activity ids. */
export interface ActivityIdMinter {
  /** Returns the next unique activity id URL. */
  next(): URL;
}

/**
 * Creates a minter that produces unique activity ids under a base URL.  Ids
 * combine a per-run random component with a monotonic counter, so they are
 * unique within a run and across runs.
 * @param base The base URL (typically the synthetic server's URL).
 * @returns A new minter.
 */
export function createActivityIdMinter(base: URL): ActivityIdMinter {
  const run = crypto.randomUUID();
  let counter = 0;
  return {
    next(): URL {
      return new URL(`/activities/${run}/${counter++}`, base);
    },
  };
}
