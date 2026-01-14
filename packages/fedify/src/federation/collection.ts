import { encodeHex } from "byte-encodings/hex";

/**
 * A page of items.
 */
export interface PageItems<TItem> {
  readonly prevCursor?: string | null;
  readonly nextCursor?: string | null;
  readonly items: readonly TItem[];
}

/**
 * Calculates the [partial follower collection digest][1].
 *
 * [1]: https://w3id.org/fep/8fcf#partial-follower-collection-digest
 * @param uris The URIs to calculate the digest.  Duplicate URIs are ignored.
 * @returns The digest.
 */
export async function digest(
  uris: Iterable<string | URL>,
): Promise<Uint8Array> {
  const processed = new Set<string>();
  const encoder = new TextEncoder();
  const result = new Uint8Array(32);
  for (const uri of uris) {
    const u = uri instanceof URL ? uri.href : uri;
    if (processed.has(u)) continue;
    processed.add(u);
    const encoded = encoder.encode(u);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoded),
    );
    for (let i = 0; i < 32; i++) {
      result[i] ^= digest[i];
    }
  }
  return result;
}

/**
 * Builds [`Collection-Synchronization`][1] header content.
 *
 * [1]: https://w3id.org/fep/8fcf#the-collection-synchronization-http-header
 *
 * @param collectionId The sender's followers collection URI.
 * @param actorIds The actor URIs to digest.
 * @returns The header content.
 */
export async function buildCollectionSynchronizationHeader(
  collectionId: string | URL,
  actorIds: Iterable<string | URL>,
): Promise<string> {
  const [anyActorId] = actorIds;
  const baseUrl = new URL(anyActorId);
  const url = new URL(collectionId);
  url.searchParams.set("base-url", `${baseUrl.origin}/`);
  const hash = encodeHex(await digest(actorIds));
  return `collectionId="${collectionId}", url="${url}", digest="${hash}"`;
}
