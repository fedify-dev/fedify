/**
 * The special public collection for [public addressing].  *Do not mutate this
 * object.*
 *
 * [public addressing]: https://www.w3.org/TR/activitypub/#public-addressing
 *
 * @since 0.7.0
 */
export const PUBLIC_COLLECTION: URL = new URL(
  "https://www.w3.org/ns/activitystreams#Public",
);
