import type { Multikey } from "@fedify/vocab";
import { verifyMapLocalProof, type VerifyProofOptions } from "./proof.ts";

/** A JSON value retained in a compound-proof snapshot. */
export type CompoundProofJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CompoundProofJsonValue[]
  | CompoundProofJsonObject;

/** A JSON map retained in a compound-proof snapshot. */
export interface CompoundProofJsonObject {
  readonly [key: string]: CompoundProofJsonValue;
}

/** Resource limits applied while discovering compound secured documents. */
export interface CompoundProofDiscoveryLimits {
  readonly maxDepth: number;
  readonly maxMaps: number;
  readonly maxProofs: number;
  readonly maxBytes: number;
}

/** A secured JSON map discovered in a compound document. */
export interface CompoundProofDocument {
  /** RFC 6901 JSON Pointer to the map.  The root map has an empty path. */
  readonly path: string;
  /** The direct literal `id` or `@id`, when it is a string. */
  readonly id?: string;
  /** The map's nesting depth, counting the root as zero. */
  readonly depth: number;
  /** The complete secured map from the immutable snapshot. */
  readonly securedDocument: CompoundProofJsonObject;
  /** The map's one direct literal proof. */
  readonly proof: CompoundProofJsonObject;
}

/** Why compound-proof discovery could not produce an atomic result. */
export type CompoundProofDiscoveryFailureReason =
  | {
    readonly type: "invalidJsonTree";
    readonly path: string;
  }
  | {
    readonly type: "unsupportedProofShape";
    readonly path: string;
  }
  | {
    readonly type: "limitExceeded";
    readonly limit: "depth" | "maps" | "proofs" | "bytes";
    readonly maximum: number;
    readonly actual: number;
    readonly path: string;
  };

/** The atomic result of bounded compound-proof discovery. */
export type CompoundProofDiscoveryResult =
  | {
    readonly status: "ok";
    /** The frozen copy from which every candidate was obtained. */
    readonly snapshot: CompoundProofJsonObject;
    /** Secured maps ordered deepest-first, then by JSON Pointer. */
    readonly documents: readonly CompoundProofDocument[];
    readonly statistics: {
      readonly byteLength: number;
      readonly mapCount: number;
      readonly proofCount: number;
      readonly maxDepth: number;
    };
  }
  | {
    readonly status: "unsupported";
    readonly reason: CompoundProofDiscoveryFailureReason;
  };

/** Why a discovered map-local proof did not verify. */
export type CompoundProofVerificationFailureReason =
  | {
    /** A nested secured map does not carry its own JSON-LD context. */
    readonly type: "missingContext";
  }
  | {
    /** The direct proof is malformed, unsupported, or invalid. */
    readonly type: "invalidProof";
  };

/** The verification result for one discovered secured map. */
export type CompoundProofDocumentVerification =
  & {
    readonly path: string;
    readonly id?: string;
    readonly depth: number;
  }
  & (
    | {
      readonly verified: true;
      readonly key: Multikey;
    }
    | {
      readonly verified: false;
      readonly reason: CompoundProofVerificationFailureReason;
    }
  );

/** The atomic result of bounded map-local proof verification. */
export type CompoundProofVerificationResult =
  | {
    readonly status: "ok";
    /** Whether at least one direct proof was discovered and all verified. */
    readonly verified: boolean;
    /** The frozen copy used for every verification input. */
    readonly snapshot: CompoundProofJsonObject;
    /** Per-map results in deepest-first discovery order. */
    readonly documents: readonly CompoundProofDocumentVerification[];
    readonly statistics: {
      readonly byteLength: number;
      readonly mapCount: number;
      readonly proofCount: number;
      readonly maxDepth: number;
    };
  }
  | {
    readonly status: "unsupported";
    readonly reason: CompoundProofDiscoveryFailureReason;
  };

interface PendingValue {
  readonly value: unknown;
  readonly path: string;
  readonly depth: number;
  readonly insideProof: boolean;
}

interface DiscoveryStatistics {
  byteLength: number;
  mapCount: number;
  proofCount: number;
  maxDepth: number;
}

const textEncoder = new TextEncoder();

function isJsonMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function isCompoundProofJsonObject(
  value: CompoundProofJsonValue,
): value is CompoundProofJsonObject {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function hasOnlyDataProperties(value: object): boolean {
  try {
    return Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => "value" in descriptor && descriptor.enumerable,
    );
  } catch {
    return false;
  }
}

function hasOnlyJsonArrayProperties(value: unknown[]): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1) return false;
    for (const key of keys) {
      if (key === "length") continue;
      if (typeof key !== "string") return false;
      const index = Number(key);
      if (
        !Number.isInteger(index) || index < 0 || index >= value.length ||
        String(index) !== key
      ) {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor == null || !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(path: string, segment: string): string {
  return `${path}/${escapeJsonPointerSegment(segment)}`;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function encodedLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function validateLimits(limits: CompoundProofDiscoveryLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer.`);
    }
  }
}

function limitExceeded(
  limit: "depth" | "maps" | "proofs" | "bytes",
  maximum: number,
  actual: number,
  path: string,
): CompoundProofDiscoveryResult {
  return {
    status: "unsupported",
    reason: { type: "limitExceeded", limit, maximum, actual, path },
  };
}

function addBytes(
  statistics: DiscoveryStatistics,
  bytes: number,
  limits: CompoundProofDiscoveryLimits,
  path: string,
): CompoundProofDiscoveryResult | undefined {
  statistics.byteLength += bytes;
  if (statistics.byteLength > limits.maxBytes) {
    return limitExceeded(
      "bytes",
      limits.maxBytes,
      statistics.byteLength,
      path,
    );
  }
}

function inspectJsonTree(
  root: unknown,
  limits: CompoundProofDiscoveryLimits,
): DiscoveryStatistics | CompoundProofDiscoveryResult {
  if (!isJsonMap(root)) {
    return {
      status: "unsupported",
      reason: { type: "invalidJsonTree", path: "" },
    };
  }
  const statistics: DiscoveryStatistics = {
    byteLength: 0,
    mapCount: 0,
    proofCount: 0,
    maxDepth: 0,
  };
  const seen = new Set<object>();
  const pending: PendingValue[] = [{
    value: root,
    path: "",
    depth: 0,
    insideProof: false,
  }];

  while (pending.length > 0) {
    const current = pending.pop()!;
    statistics.maxDepth = Math.max(statistics.maxDepth, current.depth);
    if (current.depth > limits.maxDepth) {
      return limitExceeded(
        "depth",
        limits.maxDepth,
        current.depth,
        current.path,
      );
    }
    const value = current.value;
    if (value === null) {
      const failure = addBytes(statistics, 4, limits, current.path);
      if (failure != null) return failure;
    } else if (typeof value === "boolean") {
      const failure = addBytes(
        statistics,
        value ? 4 : 5,
        limits,
        current.path,
      );
      if (failure != null) return failure;
    } else if (typeof value === "string") {
      const failure = addBytes(
        statistics,
        encodedLength(JSON.stringify(value)),
        limits,
        current.path,
      );
      if (failure != null) return failure;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return {
          status: "unsupported",
          reason: { type: "invalidJsonTree", path: current.path },
        };
      }
      const failure = addBytes(
        statistics,
        encodedLength(JSON.stringify(value)),
        limits,
        current.path,
      );
      if (failure != null) return failure;
    } else if (Array.isArray(value)) {
      if (seen.has(value) || !hasOnlyJsonArrayProperties(value)) {
        return {
          status: "unsupported",
          reason: { type: "invalidJsonTree", path: current.path },
        };
      }
      seen.add(value);
      const failure = addBytes(
        statistics,
        2 + Math.max(0, value.length - 1),
        limits,
        current.path,
      );
      if (failure != null) return failure;
      for (let index = value.length - 1; index >= 0; index--) {
        pending.push({
          value: value[index],
          path: childPath(current.path, String(index)),
          depth: current.depth + 1,
          insideProof: current.insideProof,
        });
      }
    } else if (isJsonMap(value)) {
      const prototype = Object.getPrototypeOf(value);
      if (
        seen.has(value) ||
        !hasOnlyDataProperties(value) ||
        (prototype !== Object.prototype && prototype !== null)
      ) {
        return {
          status: "unsupported",
          reason: { type: "invalidJsonTree", path: current.path },
        };
      }
      seen.add(value);
      statistics.mapCount++;
      if (statistics.mapCount > limits.maxMaps) {
        return limitExceeded(
          "maps",
          limits.maxMaps,
          statistics.mapCount,
          current.path,
        );
      }
      const entries = Object.entries(value).sort(([left], [right]) =>
        comparePaths(left, right)
      );
      let objectBytes = 2 + Math.max(0, entries.length - 1);
      for (const [key] of entries) {
        objectBytes += encodedLength(JSON.stringify(key)) + 1;
      }
      const failure = addBytes(
        statistics,
        objectBytes,
        limits,
        current.path,
      );
      if (failure != null) return failure;

      const hasDirectProof = !current.insideProof &&
        Object.hasOwn(value, "proof");
      if (hasDirectProof) {
        statistics.proofCount++;
        if (statistics.proofCount > limits.maxProofs) {
          return limitExceeded(
            "proofs",
            limits.maxProofs,
            statistics.proofCount,
            childPath(current.path, "proof"),
          );
        }
        if (!isJsonMap(value.proof)) {
          return {
            status: "unsupported",
            reason: {
              type: "unsupportedProofShape",
              path: childPath(current.path, "proof"),
            },
          };
        }
      }

      for (let index = entries.length - 1; index >= 0; index--) {
        const [key, child] = entries[index];
        pending.push({
          value: child,
          path: childPath(current.path, key),
          depth: current.depth + 1,
          insideProof: current.insideProof ||
            (hasDirectProof && key === "proof"),
        });
      }
    } else {
      return {
        status: "unsupported",
        reason: { type: "invalidJsonTree", path: current.path },
      };
    }
  }

  return statistics;
}

function freezeJsonTree(root: CompoundProofJsonObject): void {
  const pending: CompoundProofJsonValue[] = [root];
  while (pending.length > 0) {
    const value = pending.pop()!;
    if (typeof value !== "object" || value == null) continue;
    if (Array.isArray(value)) {
      for (const child of value) pending.push(child);
    } else {
      for (const child of Object.values(value)) pending.push(child);
    }
    Object.freeze(value);
  }
}

function collectDocuments(
  snapshot: CompoundProofJsonObject,
): CompoundProofDocument[] {
  const documents: CompoundProofDocument[] = [];
  const pending: Array<{
    value: CompoundProofJsonValue;
    path: string;
    depth: number;
  }> = [{ value: snapshot, path: "", depth: 0 }];

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index--) {
        pending.push({
          value: current.value[index],
          path: childPath(current.path, String(index)),
          depth: current.depth + 1,
        });
      }
      continue;
    }
    if (!isCompoundProofJsonObject(current.value)) continue;
    const document = current.value;
    if (Object.hasOwn(document, "proof")) {
      const proof = document.proof as CompoundProofJsonObject;
      const id = typeof document.id === "string"
        ? document.id
        : typeof document["@id"] === "string"
        ? document["@id"]
        : undefined;
      documents.push(Object.freeze({
        path: current.path,
        id,
        depth: current.depth,
        securedDocument: document,
        proof,
      }));
    }
    const entries = Object.entries(document).sort(([left], [right]) =>
      comparePaths(left, right)
    );
    for (let index = entries.length - 1; index >= 0; index--) {
      const [key, value] = entries[index];
      if (key === "proof") continue;
      pending.push({
        value,
        path: childPath(current.path, key),
        depth: current.depth + 1,
      });
    }
  }

  documents.sort((left, right) =>
    right.depth - left.depth || comparePaths(left.path, right.path)
  );
  return documents;
}

/**
 * Discovers direct literal proof-bearing maps in an immutable JSON snapshot.
 *
 * Discovery is bounded and atomic.  Unsupported proof shapes, non-JSON input,
 * or a resource-limit failure return no partial candidate list.  Proof
 * configuration subtrees are validated and counted as JSON, but are not
 * themselves searched for secured documents.
 */
export function discoverCompoundProofDocuments(
  json: unknown,
  limits: CompoundProofDiscoveryLimits,
): CompoundProofDiscoveryResult {
  validateLimits(limits);
  let inspected: DiscoveryStatistics | CompoundProofDiscoveryResult;
  try {
    inspected = inspectJsonTree(json, limits);
  } catch {
    return {
      status: "unsupported",
      reason: { type: "invalidJsonTree", path: "" },
    };
  }
  if ("status" in inspected) return inspected;

  let snapshot: CompoundProofJsonObject;
  try {
    snapshot = structuredClone(json) as CompoundProofJsonObject;
  } catch {
    return {
      status: "unsupported",
      reason: { type: "invalidJsonTree", path: "" },
    };
  }
  freezeJsonTree(snapshot);
  return {
    status: "ok",
    snapshot,
    documents: Object.freeze(collectDocuments(snapshot)),
    statistics: Object.freeze({ ...inspected }),
  };
}

/**
 * Verifies every direct literal proof found in one immutable JSON snapshot.
 *
 * Each current map is verified independently.  Only its literal `proof`
 * member is removed from its JCS input, so descendant proofs and proof aliases
 * remain unchanged.  This is the lower-level compound-document mechanism; it
 * does not apply portable-object policy or authenticate an inbox activity.
 *
 * @internal
 */
export async function verifyCompoundProofDocuments(
  json: unknown,
  limits: CompoundProofDiscoveryLimits,
  options: VerifyProofOptions = {},
): Promise<CompoundProofVerificationResult> {
  const discovered = discoverCompoundProofDocuments(json, limits);
  if (discovered.status !== "ok") return discovered;

  const documents = await Promise.all(
    discovered.documents.map(async (document) => {
      const metadata = {
        path: document.path,
        ...(document.id == null ? {} : { id: document.id }),
        depth: document.depth,
      };
      if (
        document.depth > 0 &&
        !Object.hasOwn(document.securedDocument, "@context")
      ) {
        return Object.freeze({
          ...metadata,
          verified: false as const,
          reason: { type: "missingContext" as const },
        });
      }
      const key = await verifyMapLocalProof(
        document.securedDocument,
        options,
      );
      return key == null
        ? Object.freeze({
          ...metadata,
          verified: false as const,
          reason: { type: "invalidProof" as const },
        })
        : Object.freeze({ ...metadata, verified: true as const, key });
    }),
  );
  return {
    status: "ok",
    verified: documents.length > 0 &&
      documents.every((document) => document.verified),
    snapshot: discovered.snapshot,
    documents: Object.freeze(documents),
    statistics: discovered.statistics,
  };
}
