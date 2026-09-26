import type { Activity } from "@fedify/vocab";
import {
  type DocumentLoader,
  getFe34Origin,
  haveSameFe34Origin,
} from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import type { TracerProvider } from "@opentelemetry/api";
import {
  containsCompoundPortableObject,
  findUnsupportedCompoundProofShape,
} from "../sig/compound-proof.ts";
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

function isPortableUrl(url: URL): boolean {
  return url.protocol === "ap:" || url.protocol === "ap+ef61:";
}

function formatKeyIds(candidates: readonly ProofSigningCandidate[]): string {
  return candidates.map((c) => c.verificationMethod.href).join(", ");
}

/**
 * Creates the Object Integrity Proofs Fedify attaches to an outgoing activity.
 *
 * Outside the map-local compound-proof profile, i.e., when the activity
 * embeds no portable object, every Ed25519 key signs the activity, as it
 * always has.  Inside the profile, which accepts exactly one direct proof per
 * map, Fedify creates at most one proof:
 *
 *  -  An activity that already carries a proof is kept as is.
 *  -  A single Ed25519 key signs the activity.
 *  -  With several Ed25519 keys, a portable activity is signed by the one key
 *     whose verification method is a DID URL for the activity's DID, the only
 *     proof the FEP-ef61 policy can accept.  If no key or more than one key
 *     qualifies, or the activity is not portable itself, the choice is
 *     ambiguous and this function throws.
 *
 * @throws {TypeError} If a single proof key cannot be chosen.
 * @internal
 */
export async function signOutgoingActivity(
  activity: Activity,
  candidates: readonly ProofSigningCandidate[],
  options: SignOutgoingActivityOptions,
): Promise<SignOutgoingActivityResult> {
  const { contextLoader, tracerProvider } = options;
  let hasProof = false;
  for await (const _ of activity.getProofs({ contextLoader })) {
    hasProof = true;
    break;
  }
  const keys = candidates.filter((c) =>
    c.privateKey.algorithm.name === "Ed25519"
  );
  if (keys.length < 1 || hasProof && !options.appendToExistingProofs) {
    return { activity, hasProof, proofCreated: false };
  }
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
  if (activity.id == null || !isPortableUrl(activity.id)) {
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
  const activityDid = getFe34Origin(activity.id);
  const eligible = keys.filter((c) =>
    c.verificationMethod.protocol === "did:" &&
    haveSameFe34Origin(activity.id!, c.verificationMethod)
  );
  if (eligible.length !== 1) {
    throw new TypeError(
      `Cannot choose an Object Integrity Proof key for the portable activity ` +
        `${activityId}: ` +
        (eligible.length < 1
          ? `none of its ${keys.length} Ed25519 keys (${formatKeyIds(keys)}) `
          : `${eligible.length} of its Ed25519 keys ` +
            `(${formatKeyIds(eligible)}) `) +
        `${eligible.length < 1 ? "is" : "are"} a DID URL verification ` +
        `method for ${activityDid}.  The map-local compound-proof profile ` +
        `accepts exactly one direct proof per map, and FEP-ef61 requires ` +
        `that proof's verification method to be a DID URL for the ` +
        `activity's DID.  Supply exactly one Ed25519 key whose key ID is a ` +
        `DID URL for ${activityDid}, or sign the activity with signObject() ` +
        `before sending it.`,
    );
  }
  logger.debug(
    "The portable activity {activityId} is signed only by {keyId}, the one " +
      "Ed25519 key whose verification method matches its DID; the map-local " +
      "compound-proof profile accepts exactly one direct proof per map.",
    { activityId, keyId: eligible[0].verificationMethod.href },
  );
  return await sign(eligible);
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
