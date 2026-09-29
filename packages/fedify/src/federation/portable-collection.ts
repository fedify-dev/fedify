import { type Actor, isActor } from "@fedify/vocab";
import { isGatewayUrl, toCompatibleEf61Id } from "@fedify/vocab-runtime";
import {
  getCanonicalPortableId,
  getPortableDid,
  isPortableId,
  isPortableUri,
} from "../sig/portable-key-id.ts";

/**
 * The query parameters of a gateway request for a portable collection that
 * do not select a view of the collection: the page cursor, and FEP-ef61
 * location hints (`@gateway`, and the legacy `gateways`).
 */
const NON_VIEW_PARAMETERS: ReadonlySet<string> = new Set([
  "cursor",
  "@gateway",
  "gateways",
]);

/**
 * The result of {@link resolvePortableCollectionOwner}.
 */
export type PortableCollectionOwnerResolution =
  | {
    readonly status: "accepted";
    /** The ID of the portable actor that owns the collection. */
    readonly ownerId: URL;
    /** The ID of the collection, without query and fragment. */
    readonly collectionId: URL;
  }
  | {
    readonly status: "rejected";
    readonly reason:
      | "notFound"
      | "notPortable"
      | "authorityMismatch"
      | "collectionMismatch";
  };

/**
 * Checks that a collection requested through the FEP-ef61 gateway endpoint
 * belongs to a portable actor under the requested DID, and determines
 * the collection's ID from the actor.
 *
 * Collection dispatchers return items, not documents with IDs, so unlike
 * object dispatchers, there is nothing else to tell whether the requested
 * DID controls the collection.
 *
 * @param actor The actor that owns the collection according to
 *              the application, dispatched without the portable request,
 *              or `null` if there is none.
 * @param options The requested DID, and either the requested collection's
 *                canonical ID and the actor's property that has to refer to
 *                it (for the built-in collections of an actor), or
 *                the requested collection's portable ID (for a custom
 *                collection, whose ID has the same form as the actor's).
 * @returns The resolution.
 */
export function resolvePortableCollectionOwner(
  actor: unknown,
  options:
    & { readonly authority: string }
    & (
      | {
        readonly canonicalId: string;
        readonly property: (actor: Actor) => URL | null;
      }
      | { readonly portableId: URL }
    ),
): PortableCollectionOwnerResolution {
  if (!isActor(actor)) return { status: "rejected", reason: "notFound" };
  // The actor may be identified by a compatible identifier instead of an ap:
  // URI, as FEP-ef61 allows:
  const ownerId = actor.id;
  const did = ownerId == null || !isPortableId(ownerId)
    ? null
    : getPortableDid(ownerId);
  if (ownerId == null || did == null) {
    return { status: "rejected", reason: "notPortable" };
  }
  if (did !== options.authority) {
    return { status: "rejected", reason: "authorityMismatch" };
  }
  if ("portableId" in options) {
    return {
      status: "accepted",
      ownerId,
      collectionId: getCustomCollectionId(ownerId, actor, options.portableId),
    };
  }
  const property = options.property(actor);
  if (
    property == null ||
    getCanonicalPortableId(property) !== options.canonicalId
  ) {
    return { status: "rejected", reason: "collectionMismatch" };
  }
  const collectionId = new URL(property);
  collectionId.search = "";
  collectionId.hash = "";
  return { status: "accepted", ownerId, collectionId };
}

/**
 * Gets the ID of a custom portable collection in the same form as its owner's
 * ID: a portable ID if the owner has one, or otherwise a compatible identifier
 * on the owner's first gateway, as FEP-ef61 requires of publishers.
 */
function getCustomCollectionId(
  ownerId: URL,
  owner: Actor,
  portableId: URL,
): URL {
  if (isPortableUri(ownerId)) return portableId;
  const gateway = owner.gateways[0];
  if (gateway == null || !isGatewayUrl(gateway)) return portableId;
  try {
    return toCompatibleEf61Id(portableId, gateway);
  } catch (error) {
    if (error instanceof TypeError) return portableId;
    throw error;
  }
}

/**
 * Builds the URI that the pages of a portable collection are relative to:
 * the collection's ID with the query parameters of the requested view, e.g.,
 * a filter, but without the page cursor and location hints.
 * @param collectionId The ID of the collection.
 * @param requestUrl The URL of the gateway request.
 * @returns The view URI.
 */
export function buildPortableCollectionView(
  collectionId: URL,
  requestUrl: URL,
): URL {
  const view = new URL(collectionId);
  for (const [name, value] of requestUrl.searchParams) {
    if (!NON_VIEW_PARAMETERS.has(name)) view.searchParams.append(name, value);
  }
  return view;
}
