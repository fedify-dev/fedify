import type {
  CompoundPortableObjectFailureReason,
  CompoundProofDiscoveryFailureReason,
} from "./compound-proof.ts";
import { CryptographicKey, type Multikey } from "@fedify/vocab";
import type { HttpMessageSignaturesSpec } from "./http.ts";
import type { FetchKeyErrorResult } from "./key.ts";
import type { VerifyPortableObjectProofFailureReason } from "./proof.ts";

/**
 * A snapshot of a key actually used to check a signature.
 * @since 2.4.0
 */
export type InboxVerificationKey =
  | {
    readonly type: "cryptographicKey";
    readonly id: URL | null;
    readonly ownerId: URL | null;
    readonly publicKey: CryptoKey;
  }
  | {
    readonly type: "multikey";
    readonly id: URL | null;
    readonly controllerId: URL | null;
    readonly publicKey: CryptoKey;
  };

/**
 * Why a cryptographic check failed.
 * @since 2.4.0
 */
export type InboxSignatureFailureReason =
  | { readonly type: "invalidSignature" }
  | {
    readonly type: "keyFetchError";
    readonly keyId: URL;
    readonly result: FetchKeyErrorResult;
  };

/**
 * The signature or proof being checked.
 * @since 2.4.0
 */
export type InboxSignatureIdentity =
  | {
    readonly mechanism: "http";
    readonly spec: HttpMessageSignaturesSpec;
    readonly label: string | null;
  }
  | { readonly mechanism: "linkedData" }
  | {
    readonly mechanism: "objectIntegrity";
    readonly proofId: string | null;
    /** Index within this evaluation, not a global proof identifier. */
    readonly proofIndex: number | null;
  };

/**
 * Evidence from one signature/proof, including cached-key retries.
 * @since 2.4.0
 */
export type InboxSignatureCheck =
  & InboxSignatureIdentity
  & {
    /** The declaration as received, including invalid IRIs. */
    readonly declaredKeyId: string | null;
    /** Keys actually tried, in use order; refresh details are not a retry API. */
    readonly triedKeys: readonly InboxVerificationKey[];
  }
  & (
    | { readonly status: "verified"; readonly key: InboxVerificationKey }
    | {
      readonly status: "rejected";
      readonly reason: InboxSignatureFailureReason;
    }
    | { readonly status: "error"; readonly error: unknown }
  );

/**
 * A bounded proof-policy diagnostic.
 * @since 2.4.0
 */
export type InboxProofPolicyFailureReason =
  | VerifyPortableObjectProofFailureReason
  | CompoundPortableObjectFailureReason
  | CompoundProofDiscoveryFailureReason
  | {
    readonly type: "invalidObjectId" | "invalidDocument" | "subjectMismatch";
  };

/**
 * Why a complete verification evaluation was rejected.
 * @since 2.4.0
 */
export type InboxVerificationFailureReason =
  | { readonly type: "noSignature" }
  | { readonly type: "signatureVerificationFailed" }
  | {
    readonly type: "uncoveredAttribution";
    readonly attributionIds: readonly URL[];
  }
  | { readonly type: "missingOwner" }
  | {
    readonly type: "proofPolicy";
    readonly reason: InboxProofPolicyFailureReason;
  };

/**
 * A logical verification evaluation, separate from inbox authentication.
 * @since 2.4.0
 */
export type InboxVerificationAttempt =
  & {
    readonly mechanism: "http" | "linkedData" | "objectIntegrity";
    readonly subject: {
      readonly id: URL | null;
      /** RFC 6901 pointer; empty for the root, null when unavailable. */
      readonly pointer: string | null;
    };
    readonly checks: readonly InboxSignatureCheck[];
  }
  & (
    | {
      readonly status: "verified";
      /** Direct references to successful members of checks. */
      readonly signatures: readonly Extract<
        InboxSignatureCheck,
        { status: "verified" }
      >[];
    }
    | {
      readonly status: "rejected";
      readonly reason: InboxVerificationFailureReason;
    }
    | { readonly status: "error"; readonly error: unknown }
  );

// Internal observation follows options, including recursive retries.  It never
// runs application code inside a verifier or uses ambient/global request state.
export const verificationObservation: unique symbol = Symbol(
  "verificationObservation",
);
export interface VerificationObservationOptions {
  [verificationObservation]?: VerificationObservation;
}
export interface VerificationObservation {
  readonly attempts: InboxVerificationAttempt[];
  readonly parsedObject?: (object: unknown) => void;
  readonly subject?: { id: URL | null; pointer: string | null };
  readonly attempt?: AttemptBuilder;
  readonly check?: CheckBuilder;
}
export interface AttemptBuilder {
  checks: InboxSignatureCheck[];
  reason?: InboxVerificationFailureReason;
}
export interface CheckBuilder {
  identity: InboxSignatureIdentity;
  declaredKeyId: string | null;
  triedKeys: InboxVerificationKey[];
  reason?: InboxSignatureFailureReason;
}

export function snapshotKey(
  key: CryptographicKey | Multikey,
): InboxVerificationKey {
  if (key.publicKey == null) {
    throw new TypeError("Verification key has no public key.");
  }
  const id = key.id == null ? null : new URL(key.id.href);
  return key instanceof CryptographicKey
    ? {
      type: "cryptographicKey",
      id,
      ownerId: key.ownerId == null ? null : new URL(key.ownerId.href),
      publicKey: key.publicKey,
    }
    : {
      type: "multikey",
      id,
      controllerId: key.controllerId == null
        ? null
        : new URL(key.controllerId.href),
      publicKey: key.publicKey,
    };
}

export function triedKey(
  options: VerificationObservationOptions,
  key: CryptographicKey | Multikey,
): void {
  const check = options[verificationObservation]?.check;
  if (check != null) check.triedKeys.push(snapshotKey(key));
}

export async function observeCheck<T extends CryptographicKey | Multikey>(
  options: VerificationObservationOptions,
  identity: InboxSignatureIdentity,
  declaredKeyId: string | null,
  operation: (observation: VerificationObservation) => Promise<T | null>,
): Promise<T | null> {
  const observation = options[verificationObservation];
  if (observation?.attempt == null) {
    return await operation(observation ?? { attempts: [] });
  }
  const check: CheckBuilder = { identity, declaredKeyId, triedKeys: [] };
  const base = { ...identity, declaredKeyId, triedKeys: check.triedKeys };
  try {
    const key = await operation({ ...observation, check });
    observation.attempt.checks.push(
      key == null
        ? {
          ...base,
          status: "rejected",
          reason: check.reason ?? { type: "invalidSignature" },
        }
        : {
          ...base,
          status: "verified",
          key: check.triedKeys.at(-1) ?? snapshotKey(key),
        },
    );
    return key;
  } catch (error) {
    observation.attempt.checks.push({ ...base, status: "error", error });
    throw error;
  }
}

export async function observeAttempt<T>(
  options: VerificationObservationOptions,
  mechanism: InboxVerificationAttempt["mechanism"],
  operation: (observation: VerificationObservation) => Promise<T>,
  isVerified: (value: T) => boolean,
): Promise<T> {
  const observation = options[verificationObservation];
  if (observation == null) return await operation({ attempts: [] });
  const attempt: AttemptBuilder = { checks: [] };
  const base = {
    mechanism,
    subject: observation.subject == null ? { id: null, pointer: "" } : {
      id: observation.subject.id == null
        ? null
        : new URL(observation.subject.id.href),
      pointer: observation.subject.pointer,
    },
    checks: attempt.checks,
  };
  try {
    const value = await operation({
      ...observation,
      subject: base.subject,
      attempt,
      check: undefined,
    });
    observation.attempts.push(
      isVerified(value)
        ? {
          ...base,
          status: "verified",
          signatures: attempt.checks.filter((
            check,
          ): check is Extract<InboxSignatureCheck, { status: "verified" }> =>
            check.status === "verified"
          ),
        }
        : {
          ...base,
          status: "rejected",
          reason: attempt.reason ?? { type: "signatureVerificationFailed" },
        },
    );
    return value;
  } catch (error) {
    observation.attempts.push({ ...base, status: "error", error });
    throw error;
  }
}
