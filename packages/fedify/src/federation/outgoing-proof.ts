import type { Activity } from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import { isCompatibleEf61Iri } from "@fedify/vocab-runtime/internal/portable-dereference";
import { getLogger } from "@logtape/logtape";
import type { TracerProvider } from "@opentelemetry/api";
import {
  containsCompoundPortableObject,
  findUnsupportedCompoundProofShape,
} from "../sig/compound-proof.ts";
import {
  getPortableDid,
  isCompatibleKeyId,
  isPortableId,
} from "../sig/portable-key-id.ts";
import { signObject } from "../sig/proof.ts";

/**
 * A key that could create an Object Integrity Proof for an outgoing activity.
 * @internal
 */
export interface ProofSigningCandidate {
  /** The verification method ID the proof will name. */
  readonly verificationMethod: URL;
  /** The private key.  Keys other than Ed25519 are ignored. */
  readonly privateKey: CryptoKey;
}

/** @internal */
export interface SignOutgoingActivityOptions {
  readonly contextLoader: DocumentLoader;
  readonly tracerProvider?: TracerProvider;
  /**
   * Whether an activity that already carries a proof gets one more proof per
   * key when it is outside the map-local compound-proof profile.  Inside the
   * profile, an existing proof is always kept as is.
   */
  readonly appendToExistingProofs: boolean;
}

/** @internal */
export interface SignOutgoingActivityResult {
  readonly activity: Activity;
  /** Whether the resulting activity carries at least one proof. */
  readonly hasProof: boolean;
  /** Whether this call created a proof. */
  readonly proofCreated: boolean;
}

function formatKeyIds(candidates: readonly ProofSigningCandidate[]): string {
  return candidates.map((c) => c.verificationMethod.href).join(", ");
}

/**
 * Rejects an activity of a portable actor whose ID cannot be authenticated by
 * the actor's DID: FEP-ef61 requires the activity to be a portable object
 * signed by that DID, so its ID has to be a portable ID, i.e., an `ap:` or
 * `ap+ef61:` URI or a compatible identifier, with the same DID.  A portable
 * actor is one whose ID is such an ID as well.
 * @throws {TypeError} If the activity is performed by a portable actor, but
 *                     its ID is not a portable ID of the actor's DID, its
 *                     portable actors do not share a DID, or the ID of one of
 *                     them is a malformed compatible identifier.
 * @internal
 */
export function assertPortableActorActivity(activity: Activity): void {
  const portableActors = activity.actorIds.filter((id) => isPortableId(id));
  if (portableActors.length < 1) return;
  const dids = portableActors.map((actorId) => {
    const did = getPortableDid(actorId);
    if (did == null) {
      throw new TypeError(
        `The activity ${activity.id?.href} is performed by the actor ` +
          `${actorId.href}, whose ID is a malformed FEP-ef61 portable ID.  ` +
          `A compatible identifier must have a valid DID and an object ` +
          `path, and must not have credentials or @gateway location hints.`,
      );
    }
    return did;
  });
  const did = dids[0];
  if (dids.some((d) => d !== did)) {
    throw new TypeError(
      `The activity ${activity.id?.href} has portable actors with different ` +
        `DIDs (${portableActors.map((a) => a.href).join(", ")}); ` +
        `a portable activity is signed by a single DID.`,
    );
  }
  if (
    activity.id == null || !isPortableId(activity.id) ||
    getPortableDid(activity.id) !== did
  ) {
    throw new TypeError(
      `The activity ${activity.id?.href} is performed by the portable actor ` +
        `${portableActors[0].href}, so its ID has to be an ap: or ap+ef61: ` +
        `URI, or an FEP-ef61 compatible identifier, with the same DID ` +
        `(${did}), as FEP-ef61 requires it to carry an Object Integrity ` +
        `Proof made by that DID.`,
    );
  }
  // Receivers compare DIDs, not gateways, so this is not an error, but
  // FEP-ef61 requires publishers to build compatible identifiers with
  // the actor's first gateway, which the actor and the activity then share:
  if (!isCompatibleEf61Iri(activity.id)) return;
  const mismatched = portableActors.find((actorId) =>
    isCompatibleEf61Iri(actorId) && actorId.origin !== activity.id?.origin
  );
  if (mismatched == null) return;
  getLogger(["fedify", "federation", "outbox"]).warn(
    "The activity {activityId} and its actor {actorId} are identified by " +
      "FEP-ef61 compatible identifiers on different gateways.  FEP-ef61 " +
      "requires publishers to use the first gateway in the actor's gateways " +
      "when constructing compatible identifiers.",
    { activityId: activity.id.href, actorId: mismatched.href },
  );
}

/**
 * Creates the Object Integrity Proofs Fedify attaches to an outgoing activity.
 *
 * Keys whose IDs are FEP-ef61 compatible identifiers are gateway keys, which
 * never sign proofs.  A portable activity, i.e., one with an `ap:` or
 * `ap+ef61:` ID or a compatible identifier, that carries no proof is signed only by the one Ed25519 key
 * whose verification method is a DID URL for its DID, even if it is the only
 * key; if no key or more than one key qualifies, this function throws.
 *
 * Outside the map-local compound-proof profile, i.e., when the activity
 * embeds no portable object, every Ed25519 key signs the activity, as it
 * always has.  Inside the profile, which accepts exactly one direct proof per
 * map, Fedify creates at most one proof:
 *
 *  -  An activity that already carries a proof is kept as is.
 *  -  A single Ed25519 key signs a non-portable activity.
 *  -  With several Ed25519 keys, a non-portable activity is ambiguous, and
 *     this function throws.
 *
 * @throws {TypeError} If a single proof key cannot be chosen, or the activity
 *                     is performed by a portable actor but is not a portable
 *                     activity of the same DID.
 * @internal
 */
export async function signOutgoingActivity(
  activity: Activity,
  candidates: readonly ProofSigningCandidate[],
  options: SignOutgoingActivityOptions,
): Promise<SignOutgoingActivityResult> {
  const { contextLoader, tracerProvider } = options;
  assertPortableActorActivity(activity);
  const sign = async (
    selected: readonly ProofSigningCandidate[],
  ): Promise<SignOutgoingActivityResult> => {
    for (const { verificationMethod, privateKey } of selected) {
      activity = await signObject(activity, privateKey, verificationMethod, {
        contextLoader,
        tracerProvider,
      });
    }
    return { activity, hasProof: true, proofCreated: true };
  };
  let hasProof = false;
  for await (const _ of activity.getProofs({ contextLoader })) {
    hasProof = true;
    break;
  }
  const keys = candidates.filter((c) =>
    c.privateKey.algorithm.name === "Ed25519" &&
    // Gateway keys only sign HTTP requests; a proof made with one would
    // claim that the gateway authored the activity:
    !isCompatibleKeyId(c.verificationMethod)
  );
  if (!hasProof && activity.id != null && isPortableId(activity.id)) {
    // The single-key shortcut below does not apply: FEP-ef61 accepts only
    // a proof made by the activity's own DID.
    return await sign(selectPortableActivityKey(activity, activity.id, keys));
  }
  if (keys.length < 1 || hasProof && !options.appendToExistingProofs) {
    return { activity, hasProof, proofCreated: false };
  }
  // A single key produces a single proof whatever the document contains, so
  // the activity need not be serialized to find out.
  if (keys.length < 2 && !hasProof) return await sign(keys);
  const compound = containsCompoundPortableObject(
    await activity.toJsonLd({ format: "compact", contextLoader }),
  );
  if (!compound) return await sign(keys);
  const logger = getLogger(["fedify", "federation", "outbox"]);
  const activityId = activity.id?.href;
  if (hasProof) {
    logger.debug(
      "The activity {activityId} embeds portable objects and already carries " +
        "a proof, so no further proof is added; the map-local compound-proof " +
        "profile accepts exactly one direct proof per map.",
      { activityId },
    );
    return { activity, hasProof, proofCreated: false };
  }
  // An unsigned portable activity was handled above, so the activity is not
  // portable itself, but embeds portable objects:
  throw new TypeError(
    `Cannot choose an Object Integrity Proof key for the activity ` +
      `${activityId}: it embeds portable objects, so it falls under the ` +
      `map-local compound-proof profile, which accepts exactly one direct ` +
      `proof per map, but ${keys.length} Ed25519 keys were supplied ` +
      `(${formatKeyIds(keys)}).  Send it with explicit sender keys that ` +
      `contain exactly one Ed25519 key (RSA keys for HTTP Signatures may ` +
      `stay), or sign it with signObject() before sending it.`,
  );
}

/**
 * Chooses the one Ed25519 key that can sign a portable activity: the key
 * whose verification method is a DID URL for the activity's DID.
 * @throws {TypeError} If no key or more than one key qualifies.
 */
function selectPortableActivityKey(
  activity: Activity,
  activityId: URL,
  keys: readonly ProofSigningCandidate[],
): readonly ProofSigningCandidate[] {
  // The DID of a compatible identifier is not its web origin, so the DIDs
  // are compared rather than the FEP-fe34 origins of the IDs:
  const activityDid = getPortableDid(activityId);
  if (activityDid == null) {
    throw new TypeError(
      `Cannot sign the portable activity ${activityId.href}, as its ID is ` +
        `a malformed FEP-ef61 portable ID.  A compatible identifier must ` +
        `have a valid DID and an object path, and must not have credentials ` +
        `or @gateway location hints.`,
    );
  }
  const eligible = keys.filter((c) =>
    c.verificationMethod.protocol === "did:" &&
    getPortableDid(c.verificationMethod) === activityDid
  );
  if (eligible.length !== 1) {
    throw new TypeError(
      `Cannot choose an Object Integrity Proof key for the portable activity ` +
        `${activityId.href}: ` +
        (eligible.length < 1
          ? `none of its ${keys.length} Ed25519 keys (${formatKeyIds(keys)}) `
          : `${eligible.length} of its Ed25519 keys ` +
            `(${formatKeyIds(eligible)}) `) +
        `${eligible.length < 1 ? "is" : "are"} a DID URL verification ` +
        `method for ${activityDid}.  FEP-ef61 requires a portable activity's ` +
        `proof to be made by its DID, and the map-local compound-proof ` +
        `profile accepts exactly one direct proof per map.  Gateway keys, ` +
        `whose IDs are compatible identifiers, never sign proofs.  Supply ` +
        `exactly one Ed25519 key whose key ID is a DID URL for ` +
        `${activityDid}, or sign the activity with signObject() before ` +
        `sending it.`,
    );
  }
  getLogger(["fedify", "federation", "outbox"]).debug(
    "The portable activity {activityId} is signed only by {keyId}, the one " +
      "Ed25519 key whose verification method matches its DID.",
    {
      activityId: activity.id?.href,
      keyId: eligible[0].verificationMethod.href,
    },
  );
  return eligible;
}

/**
 * Rejects an outgoing activity whose proofs Fedify's own inbox would reject
 * as unsupported: a document with portable objects in which some map carries
 * a proof set or another value that is not a single proof map.
 *
 * @param jsonLd The compact JSON-LD document about to be delivered.
 * @param activityId The activity ID, for the error message.
 * @throws {TypeError} If the document has an unsupported proof shape.
 * @internal
 */
export function assertSupportedCompoundProofShape(
  jsonLd: unknown,
  activityId: string | undefined,
): void {
  if (!containsCompoundPortableObject(jsonLd)) return;
  const path = findUnsupportedCompoundProofShape(jsonLd);
  if (path == null) return;
  throw new TypeError(
    `Cannot send the activity ${activityId}: it embeds portable objects, ` +
      `but its proof at the JSON Pointer ${JSON.stringify(path)} is not a ` +
      `single proof map.  The map-local compound-proof profile accepts ` +
      `exactly one direct proof per map, so Fedify inboxes would reject the ` +
      `activity.  Sign each object with exactly one key.`,
  );
}
