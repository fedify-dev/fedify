import { type Actor, type Object, PUBLIC_COLLECTION } from "@fedify/vocab";
import { getCanonicalPortableId } from "../sig/portable-key-id.ts";

const AS_NAMESPACE = "https://www.w3.org/ns/activitystreams#";

/**
 * The addressing properties that determine the audience of an object.
 */
const ADDRESSING_PROPERTIES = [
  "to",
  "cc",
  "bto",
  "bcc",
  "audience",
] as const;

/**
 * The IDs that Fedify treats as the public collection.  Besides the full IRI,
 * the compact forms `as:Public` and `Public` are reserved as public for
 * compatibility with documents whose compact forms survive JSON-LD expansion,
 * e.g., bare `Public`, which expands to a relative IRI.
 */
const PUBLIC_IDS: ReadonlySet<string> = new Set([
  PUBLIC_COLLECTION.href,
  "as:Public",
  "Public",
]);

/**
 * Checks whether an expanded JSON-LD node is addressed to the public
 * collection, i.e., any of its `to`, `cc`, `bto`, `bcc`, and `audience` has
 * the public collection.  Only the node itself is checked, not the nodes
 * embedded in it.
 * @param node The expanded JSON-LD node.
 * @returns `true` if the node is publicly addressed.
 * @internal
 */
export function isPubliclyAddressedNode(
  node: Record<string, unknown>,
): boolean {
  for (const property of ADDRESSING_PROPERTIES) {
    const values = node[AS_NAMESPACE + property];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (
        typeof value === "object" && value != null && "@id" in value &&
        typeof value["@id"] === "string" && PUBLIC_IDS.has(value["@id"])
      ) {
        return true;
      }
    }
  }
  return false;
}

function getAudienceIds(object: Object): URL[] {
  return [
    ...object.toIds,
    ...object.ccIds,
    ...object.btoIds,
    ...object.bccIds,
    ...object.audienceIds,
  ];
}

/**
 * Checks whether two actor IDs refer to the same actor.  [FEP-ef61] portable
 * IDs are compared by their canonical forms, so an `ap:` URI, an `ap+ef61:`
 * URI, and a compatible identifier on any gateway are the same actor if they
 * have the same canonical portable ID.  Other IDs are compared as they are.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 */
function isSameActorId(a: URL, b: URL): boolean {
  const canonicalA = getCanonicalPortableId(a);
  const canonicalB = getCanonicalPortableId(b);
  if (canonicalA != null || canonicalB != null) {
    return canonicalA === canonicalB;
  }
  return a.href === b.href;
}

/**
 * Options for {@link isInAudience}.
 * @internal
 */
export interface IsInAudienceOptions {
  /**
   * Checks whether the actor is a member of an addressee that is not
   * the actor itself, e.g., a followers collection.
   */
  isMember?: (addressee: URL, actor: Actor) => boolean | Promise<boolean>;
}

/**
 * Checks whether an actor belongs to the audience of an object: the object is
 * publicly addressed, the actor is one of its addressees, or the actor is
 * a member of one of them according to `isMember()`.
 * @param object The object whose audience is checked.
 * @param actor The actor to check, or `null` if there is no actor.  No actor
 *              belongs to the audience of an object that is not public.
 * @param options Options for checking the audience.
 * @returns `true` if the actor belongs to the audience of the object.
 * @internal
 */
export async function isInAudience(
  object: Object,
  actor: Actor | null,
  options: IsInAudienceOptions = {},
): Promise<boolean> {
  const addressees = getAudienceIds(object);
  if (addressees.some((id) => PUBLIC_IDS.has(id.href))) return true;
  const actorId = actor?.id;
  if (actor == null || actorId == null) return false;
  const others: URL[] = [];
  for (const addressee of addressees) {
    if (isSameActorId(addressee, actorId)) return true;
    others.push(addressee);
  }
  if (options.isMember == null) return false;
  for (const addressee of others) {
    if (await options.isMember(addressee, actor)) return true;
  }
  return false;
}
