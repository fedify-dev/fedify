import type { Multikey } from "@fedify/vocab";
import { parseIri, preloadedContexts } from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { preloadedOnlyDocumentLoader } from "../compat/preloaded-context-loader.ts";
import { getNormalizationContextLoader } from "./ld.ts";
import {
  getCanonicalPortableId,
  getRawCanonicalPortableId,
  isPortableId,
} from "./portable-key-id.ts";
import {
  classifyFep2277CoreType,
  verifyMapLocalProof,
  type VerifyPortableObjectProofFailureReason,
  type VerifyPortableObjectProofOptions,
  verifyPortableObjectProofPolicy,
  type VerifyProofOptions,
} from "./proof.ts";

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

/** A portable JSON map found in the immutable compound snapshot. */
export interface CompoundPortableObject {
  readonly path: string;
  readonly id: string;
  readonly depth: number;
  readonly document: CompoundProofJsonObject;
  /**
   * Where the map sits if it may be a key embedded in a portable actor, i.e.,
   * it is the value, or an element of the value, of a `publicKey` or
   * `assertionMethod` member of another portable map.
   */
  readonly keyOf?: {
    readonly path: string;
    readonly member: KeyMember;
  };
}

type KeyMember = "publicKey" | "assertionMethod";

/** Why one portable map did not pass compound proof policy. */
export type CompoundPortableObjectFailureReason =
  | CompoundProofVerificationFailureReason
  | VerifyPortableObjectProofFailureReason
  | {
    /** The portable map could not be interpreted by the policy layer. */
    readonly type: "invalidPortableObject";
  };

/** The portable proof-policy result for one map. */
export type CompoundPortableObjectVerification =
  & {
    readonly path: string;
    readonly id: string;
    readonly depth: number;
  }
  & (
    | {
      readonly verified: true;
      readonly keys: readonly Multikey[];
    }
    | {
      readonly verified: false;
      readonly reason: CompoundPortableObjectFailureReason;
    }
  );

/** The atomic compound result after portable-object policy is applied. */
export type CompoundPortableObjectProofResult =
  | {
    readonly status: "ok";
    readonly verified: boolean;
    readonly snapshot: CompoundProofJsonObject;
    readonly proofs: readonly CompoundProofDocumentVerification[];
    readonly portableObjects: readonly CompoundPortableObjectVerification[];
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
  readonly insideContext: boolean;
}

interface DiscoveryStatistics {
  byteLength: number;
  mapCount: number;
  proofCount: number;
  maxDepth: number;
}

const textEncoder = new TextEncoder();

/**
 * Checks whether a literal `id` or `@id` value makes a map a portable object:
 * an `ap:` or `ap+ef61:` URI, or anything that looks like an FEP-ef61
 * compatible identifier, even a malformed one, which then fails the policy.
 */
function isPortableIdValue(value: unknown): value is string {
  return typeof value === "string" && isPortableId(value);
}

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
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor != null &&
        "value" in descriptor &&
        descriptor.enumerable;
    });
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
    insideContext: false,
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
          insideContext: current.insideContext,
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

      const hasDirectProof = !current.insideProof && !current.insideContext &&
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
          insideContext: current.insideContext || key === "@context",
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
      if (key === "proof" || key === "@context") continue;
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

function collectPortableObjects(
  snapshot: CompoundProofJsonObject,
): CompoundPortableObject[] {
  const objects: CompoundPortableObject[] = [];
  const pending: Array<{
    value: CompoundProofJsonValue;
    path: string;
    depth: number;
    keyOf?: CompoundPortableObject["keyOf"];
  }> = [{ value: snapshot, path: "", depth: 0 }];

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index--) {
        pending.push({
          value: current.value[index],
          path: childPath(current.path, String(index)),
          depth: current.depth + 1,
          // Only direct elements of a key member's array may be keys:
          keyOf: current.keyOf,
        });
      }
      continue;
    }
    if (!isCompoundProofJsonObject(current.value)) continue;
    const document = current.value;
    const id = [document.id, document["@id"]].find(isPortableIdValue);
    if (typeof id === "string") {
      objects.push(Object.freeze({
        path: current.path,
        id,
        depth: current.depth,
        document,
        ...(current.keyOf == null ? {} : { keyOf: current.keyOf }),
      }));
    }
    const entries = Object.entries(document).sort(([left], [right]) =>
      comparePaths(left, right)
    );
    for (let index = entries.length - 1; index >= 0; index--) {
      const [key, value] = entries[index];
      if (key === "proof" || key === "@context") continue;
      pending.push({
        value,
        path: childPath(current.path, key),
        depth: current.depth + 1,
        ...(
          typeof id === "string" &&
            (key === "publicKey" || key === "assertionMethod")
            ? { keyOf: { path: current.path, member: key } }
            : {}
        ),
      });
    }
  }

  objects.sort((left, right) =>
    right.depth - left.depth || comparePaths(left.path, right.path)
  );
  return objects;
}

/**
 * Determines whether a received JSON tree contains a portable object ID, i.e.,
 * an `ap:` or `ap+ef61:` URI or an FEP-ef61 compatible identifier, outside
 * a proof or context definition, without exceeding discovery limits.
 *
 * This is only an applicability check.  It does not authenticate the input;
 * callers must still use {@link verifyCompoundPortableObjectProofs} to obtain
 * an atomic result from an immutable snapshot.  `indeterminate` means the
 * applicability scan itself reached a limit, so a caller must not treat the
 * document as outside the compound profile.
 *
 * @internal
 */
export function inspectCompoundPortableObjectApplicability(
  json: unknown,
  limits: CompoundProofDiscoveryLimits,
): "present" | "absent" | "indeterminate" {
  validateLimits(limits);
  let byteLength = 0;
  let mapCount = 0;
  const pending: Array<{
    iterator: Iterator<unknown>;
    depth: number;
  }> = [{ iterator: [json].values(), depth: 0 }];

  const addByteLength = (length: number): boolean => {
    byteLength += length;
    return byteLength <= limits.maxBytes;
  };
  while (pending.length > 0) {
    const frame = pending[pending.length - 1];
    const next = frame.iterator.next();
    if (next.done) {
      pending.pop();
      if (byteLength > limits.maxBytes) return "indeterminate";
      continue;
    }
    const value = next.value;
    if (frame.depth > limits.maxDepth) return "indeterminate";
    if (value === null) {
      if (!addByteLength(4)) return "indeterminate";
    } else if (typeof value === "boolean") {
      if (!addByteLength(value ? 4 : 5)) return "indeterminate";
    } else if (typeof value === "string" || typeof value === "number") {
      if (!addByteLength(encodedLength(JSON.stringify(value)))) {
        return "indeterminate";
      }
    } else if (Array.isArray(value)) {
      if (!addByteLength(2 + Math.max(0, value.length - 1))) {
        return "indeterminate";
      }
      pending.push({ iterator: value.values(), depth: frame.depth + 1 });
    } else if (isJsonMap(value)) {
      mapCount++;
      if (mapCount > limits.maxMaps) return "indeterminate";
      if (
        [value.id, value["@id"]].some(isPortableIdValue)
      ) {
        return "present";
      }
      if (!addByteLength(2)) return "indeterminate";
      const children = function* (): Generator<unknown> {
        let first = true;
        for (const key in value) {
          if (!Object.hasOwn(value, key)) continue;
          if (key === "proof" || key === "@context") continue;
          if (!first && !addByteLength(1)) return;
          first = false;
          if (!addByteLength(encodedLength(JSON.stringify(key)) + 1)) return;
          yield value[key];
        }
      }();
      pending.push({ iterator: children, depth: frame.depth + 1 });
    }
    if (byteLength > limits.maxBytes) return "indeterminate";
  }
  return "absent";
}

/**
 * Walks every JSON map in a finite, already-materialized JSON tree, depth
 * first in insertion order, skipping the values of `proof` and `@context`
 * members.  A map reached a second time through a repeated reference is not
 * visited again, so a cyclic input terminates.  The walk stops as soon as
 * the visitor returns a value other than `undefined`.
 */
function findInJsonMaps<T>(
  json: unknown,
  visit: (map: Record<string, unknown>, path: string) => T | undefined,
): T | undefined {
  const seen = new Set<object>();
  const pending: Array<{ value: unknown; path: string }> = [
    { value: json, path: "" },
  ];
  while (pending.length > 0) {
    const { value, path } = pending.pop()!;
    if (typeof value !== "object" || value == null || seen.has(value)) {
      continue;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index--) {
        pending.push({
          value: value[index],
          path: childPath(path, String(index)),
        });
      }
      continue;
    }
    const map = value as Record<string, unknown>;
    const result = visit(map, path);
    if (result !== undefined) return result;
    const keys = Object.keys(map);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === "proof" || key === "@context") continue;
      pending.push({ value: map[key], path: childPath(path, key) });
    }
  }
  return undefined;
}

/**
 * Determines whether an outgoing JSON tree contains portable content that
 * requires producer-side proof-shape checks: a map, outside proof and context
 * values, whose direct `id` or `@id` is a portable ActivityPub URI or an
 * FEP-ef61 compatible identifier.
 *
 * This deliberately differs from
 * {@link inspectCompoundPortableObjectApplicability}: it applies no resource
 * limits, so a portable map or an unsupported proof beyond the inbox limits
 * is still found, and a large document without portable maps stays outside
 * the compound-proof profile.  The input must be a finite JSON tree that has
 * already been materialized, such as a compact JSON-LD document about to be
 * sent.
 *
 * @internal
 */
export function containsCompoundPortableObject(json: unknown): boolean {
  return findInJsonMaps(
    json,
    (map) => [map.id, map["@id"]].some(isPortableIdValue) ? true : undefined,
  ) ?? false;
}

/**
 * Finds the first direct `proof` member whose value the map-local
 * compound-proof profile does not accept, i.e., anything other than a single
 * JSON map: a proof set, `null`, or a scalar.  Like the inbox discovery, it
 * does not look inside proof or context values.
 *
 * The input must be a finite, already-materialized JSON tree; see
 * {@link containsCompoundPortableObject}.
 *
 * @returns The RFC 6901 JSON Pointer to the unsupported `proof` member, or
 *          `null` if every direct proof is a single JSON map.
 * @internal
 */
export function findUnsupportedCompoundProofShape(
  json: unknown,
): string | null {
  return findInJsonMaps(
    json,
    (map, path) =>
      Object.hasOwn(map, "proof") && !isJsonMap(map.proof)
        ? childPath(path, "proof")
        : undefined,
  ) ?? null;
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

  const documents = await verifyDiscoveredProofDocuments(discovered, options);
  return {
    status: "ok",
    verified: documents.length > 0 &&
      documents.every((document) => document.verified),
    snapshot: discovered.snapshot,
    documents,
    statistics: discovered.statistics,
  };
}

async function verifyDiscoveredProofDocuments(
  discovered: Extract<CompoundProofDiscoveryResult, { status: "ok" }>,
  options: VerifyProofOptions,
): Promise<readonly CompoundProofDocumentVerification[]> {
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
  return Object.freeze(documents);
}

/**
 * Applies FEP-ef61 portable-object policy to every portable map in a compound
 * snapshot without changing the map-local cryptographic inputs.
 *
 * @internal
 */
export async function verifyCompoundPortableObjectProofs(
  json: unknown,
  limits: CompoundProofDiscoveryLimits,
  options: VerifyProofOptions = {},
): Promise<CompoundPortableObjectProofResult> {
  const discovered = discoverCompoundProofDocuments(json, limits);
  if (discovered.status !== "ok") return discovered;

  const proofs = await verifyDiscoveredProofDocuments(discovered, options);
  const proofByPath = new Map(proofs.map((proof) => [proof.path, proof]));
  const verifyPortableObject = async (
    object: CompoundPortableObject,
  ): Promise<CompoundPortableObjectVerification> => {
    const metadata = {
      path: object.path,
      id: object.id,
      depth: object.depth,
    };
    if (
      object.depth > 0 && !Object.hasOwn(object.document, "@context")
    ) {
      return Object.freeze({
        ...metadata,
        verified: false as const,
        reason: { type: "missingContext" as const },
      });
    }
    const proof = proofByPath.get(object.path);
    const key = proof?.verified === true ? proof.key : null;
    try {
      const policy = await verifyPortableObjectProofPolicy(
        object.document,
        key,
        options,
      );
      return policy.verified
        ? Object.freeze({
          ...metadata,
          id: policy.objectId,
          verified: true as const,
          keys: policy.keys,
        })
        : Object.freeze({
          ...metadata,
          verified: false as const,
          reason: policy.reason,
        });
    } catch {
      return Object.freeze({
        ...metadata,
        verified: false as const,
        reason: { type: "invalidPortableObject" as const },
      });
    }
  };
  const collected = collectPortableObjects(discovered.snapshot);
  const objectByPath = new Map(
    collected.map((object) => [object.path, object]),
  );
  // Unsigned maps under the publicKey or assertionMethod of a portable map
  // may be the keys of a portable actor, e.g., its gateway keys, whose IDs
  // are compatible identifiers, or the keys of an FEP-ae97 client, whose IDs
  // are ap: URIs.  They are decided after their parents:
  const isKeyCandidate = (object: CompoundPortableObject) =>
    object.keyOf != null && !Object.hasOwn(object.document, "proof");
  const results = new Map<string, CompoundPortableObjectVerification>();
  for (
    const result of await Promise.all(
      collected.filter((object) => !isKeyCandidate(object)).map(
        verifyPortableObject,
      ),
    )
  ) {
    results.set(result.path, result);
  }
  let projections = 0;
  for (const object of collected) {
    if (!isKeyCandidate(object)) continue;
    const { path, member } = object.keyOf!;
    const parent = results.get(path);
    const parentObject = objectByPath.get(path);
    if (
      parent?.verified === true && parentObject != null &&
      projections++ < MAX_KEY_PROJECTIONS &&
      await isEmbeddedPortableKey(
        parentObject.document,
        member,
        object.document,
        parent.id,
      )
    ) {
      // The key is a part of its parent's document, which the parent's
      // proof covers:
      continue;
    }
    results.set(object.path, await verifyPortableObject(object));
  }
  const portableObjects = Object.freeze(
    collected.flatMap((object) => {
      const result = results.get(object.path);
      return result == null ? [] : [result];
    }),
  );
  return {
    status: "ok",
    verified: portableObjects.length > 0 &&
      proofs.every((proof) => proof.verified) &&
      portableObjects.every((object) => object.verified),
    snapshot: discovered.snapshot,
    proofs,
    portableObjects,
    statistics: discovered.statistics,
  };
}

/**
 * The maximum number of embedded keys per compound document that are checked
 * by {@link isEmbeddedPortableKey}, each of which expands a projection of its
 * parent.  Keys beyond it have to carry their own proofs.
 */
const MAX_KEY_PROJECTIONS = 64;

const SECURITY = "https://w3id.org/security#";
const KEY_TYPES: ReadonlySet<string> = new Set([
  `${SECURITY}Key`,
  `${SECURITY}Multikey`,
]);
const KEY_PROPERTIES: ReadonlySet<string> = new Set([
  "@id",
  "@type",
  `${SECURITY}owner`,
  `${SECURITY}controller`,
  `${SECURITY}publicKeyPem`,
  `${SECURITY}publicKeyMultibase`,
]);

/**
 * Tells whether an unsigned map embedded in a verified portable map is just
 * a key of the portable object the parent is, e.g., a gateway key of
 * a portable actor, which the parent's proof covers.
 *
 * The key's meaning depends on the contexts active where it sits, so it is
 * decided on a projection of the parent that keeps only what those contexts
 * depend on: the parent's `@context`, its types and ID, and the member that
 * holds the key.  That holds only if nothing else in the parent can change
 * them, so both documents may only use contexts that define no keyword
 * aliases and no scoped contexts; Fedify's preloaded contexts, the only
 * remote ones the compound policy loads, alias just `id` and `type`.
 *
 * The projection must expand to the parent's verified ID with the key as the
 * single value of `publicKey` or `assertionMethod`, and the key must be
 * nothing but a `CryptographicKey` or `Multikey` whose ID is the parent's
 * `ap:` or `ap+ef61:` URI, or its compatible identifier, plus a fragment,
 * and whose owner or controller, if any, is the parent.
 */
async function isEmbeddedPortableKey(
  parent: CompoundProofJsonObject,
  member: KeyMember,
  key: CompoundProofJsonObject,
  parentId: string,
): Promise<boolean> {
  const parentPortableId = getCanonicalPortableIdOf(parentId);
  if (parentPortableId == null) return false;
  if (
    !isSimpleContext(parent["@context"]) ||
    Object.hasOwn(key, "@context") && !isSimpleContext(key["@context"])
  ) {
    return false;
  }
  const literalIds = [key.id, key["@id"]].filter((id) => id !== undefined);
  if (
    literalIds.length < 1 ||
    literalIds.some((id) => id !== literalIds[0]) ||
    typeof literalIds[0] !== "string" ||
    !isKeyIdOf(literalIds[0], parentPortableId)
  ) {
    return false;
  }
  const projection: Record<string, unknown> = {};
  for (const property of ["@context", "type", "@type", "id", "@id"]) {
    if (Object.hasOwn(parent, property)) {
      projection[property] = parent[property];
    }
  }
  projection[member] = key;
  let expanded: unknown[];
  try {
    expanded = await jsonld.expand(structuredClone(projection), {
      documentLoader: getNormalizationContextLoader(
        preloadedOnlyDocumentLoader,
      ),
      keepFreeFloatingNodes: true,
    });
  } catch {
    return false;
  }
  if (expanded.length !== 1 || hasGraphKeyword(expanded)) return false;
  const node = expanded[0];
  if (
    !isJsonMap(node) || typeof node["@id"] !== "string" ||
    getCanonicalPortableIdOf(node["@id"]) !== parentPortableId
  ) {
    return false;
  }
  const properties = Object.keys(node).filter((property) =>
    property !== "@id" && property !== "@type"
  );
  if (
    properties.length !== 1 || properties[0] !== `${SECURITY}${member}`
  ) {
    return false;
  }
  const values = node[properties[0]];
  if (!Array.isArray(values) || values.length !== 1) return false;
  const expandedKey = values[0];
  if (
    !isJsonMap(expandedKey) || expandedKey["@id"] !== literalIds[0] ||
    Object.keys(expandedKey).some((property) => !KEY_PROPERTIES.has(property))
  ) {
    return false;
  }
  const types = expandedKey["@type"];
  if (
    types !== undefined &&
    (!Array.isArray(types) ||
      types.some((type) => typeof type !== "string" || !KEY_TYPES.has(type)))
  ) {
    return false;
  }
  const pem = expandedKey[`${SECURITY}publicKeyPem`];
  const multibase = expandedKey[`${SECURITY}publicKeyMultibase`];
  if (pem === undefined && multibase === undefined) return false;
  if (pem !== undefined && !isSingleStringValue(pem)) return false;
  if (
    multibase !== undefined &&
    !isSingleStringValue(multibase, `${SECURITY}multibase`)
  ) {
    return false;
  }
  for (const property of [`${SECURITY}owner`, `${SECURITY}controller`]) {
    const owners = expandedKey[property];
    if (owners === undefined) continue;
    if (
      !Array.isArray(owners) || owners.length !== 1 ||
      !isJsonMap(owners[0]) || Object.keys(owners[0]).length !== 1 ||
      typeof owners[0]["@id"] !== "string" ||
      getCanonicalPortableIdOf(owners[0]["@id"]) !== parentPortableId
    ) {
      return false;
    }
  }
  return true;
}

function getCanonicalPortableIdOf(id: string): string | null {
  try {
    return getCanonicalPortableId(parseIri(id));
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/**
 * Checks whether an ID is the given portable object's `ap:` or `ap+ef61:`
 * URI, or its compatible identifier, plus a non-empty fragment.  The ID is
 * compared as it is written, so an ID that URL parsing would turn into
 * the portable object's, e.g., through dot segments, is not one of its keys.
 */
function isKeyIdOf(id: string, portableId: string): boolean {
  const canonical = getRawCanonicalPortableId(id);
  if (canonical == null) return false;
  const hash = canonical.indexOf("#");
  return hash >= 0 && hash < canonical.length - 1 &&
    canonical.slice(0, hash) === portableId;
}

/**
 * Checks whether a `@context` value defines no keyword aliases and no scoped
 * contexts: only references to contexts and term definitions that map terms
 * to IRIs, optionally with an `@id` or `@vocab` type coercion or a datatype.
 */
function isSimpleContext(context: CompoundProofJsonValue | undefined): boolean {
  if (typeof context === "string") return true;
  if (Array.isArray(context)) return context.every(isSimpleContext);
  if (context === undefined || !isCompoundProofJsonObject(context)) {
    return false;
  }
  return Object.entries(context).every(([term, definition]) => {
    if (term.startsWith("@")) return false;
    if (typeof definition === "string") return !definition.startsWith("@");
    if (!isCompoundProofJsonObject(definition)) return false;
    const { "@id": id, "@type": type, ...rest } = definition;
    return Object.keys(rest).length < 1 &&
      typeof id === "string" && !id.startsWith("@") &&
      (type === undefined || type === "@id" || type === "@vocab" ||
        typeof type === "string" && !type.startsWith("@"));
  });
}

function hasGraphKeyword(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasGraphKeyword);
  if (!isJsonMap(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    key === "@graph" || key === "@included" || key === "@reverse" ||
    hasGraphKeyword(child)
  );
}

/**
 * Checks whether expanded values are a single plain string, optionally with
 * the given datatype.
 */
function isSingleStringValue(values: unknown, datatype?: string): boolean {
  if (!Array.isArray(values) || values.length !== 1) return false;
  const value = values[0];
  if (!isJsonMap(value) || typeof value["@value"] !== "string") return false;
  const keys = Object.keys(value);
  return keys.length === 1 ||
    datatype != null && keys.length === 2 && value["@type"] === datatype;
}

/**
 * The reason why {@link verifyServedPortableObjects} refused a document.
 * @internal
 */
export type ServedPortableObjectFailureReason =
  | VerifyPortableObjectProofFailureReason["type"]
  | "unsupportedProofShape"
  | "missingContext"
  | "unsupportedContext"
  | "hiddenPortableObject"
  | "invalidPortableObject";

/**
 * The result of {@link verifyServedPortableObjects}.
 * @internal
 */
export type ServedPortableObjectsResult =
  | { readonly verified: true }
  | {
    readonly verified: false;
    /** RFC 6901 JSON Pointer to the refused map. */
    readonly path: string;
    /** The portable ID of the refused map. */
    readonly id: string;
    readonly reason: ServedPortableObjectFailureReason;
  };

/**
 * FEP-2277 core types that FEP-ef61 does not require to carry proofs.
 */
const UNSECURED_CORE_TYPES: ReadonlySet<string> = new Set([
  "collection",
  "link",
  "verificationMethod",
  "publicKey",
]);

interface ServedPortableMap {
  readonly path: string;
  readonly id: string;
  readonly map: Record<string, unknown>;
  /** The `@context` values of the map and its ancestors, outermost first. */
  readonly contexts: readonly unknown[];
}

/**
 * Applies the FEP-ef61 proof policy, under the map-local compound-proof
 * profile, to every portable object embedded in a document that a gateway is
 * about to serve, e.g., the items of a portable collection page.  The root
 * map itself is not checked, as the caller built it.
 *
 * Each map below the root whose direct `id` or `@id` is a portable ID or
 * a compatible identifier is checked independently of the others:
 *
 *  -  A map with a direct `proof` is a separately secured document: the proof
 *     has to be a single map, the map has to carry its own `@context`, and
 *     the proof has to verify over the map exactly as it is served, with only
 *     its own proof removed, and be made with a key of the DID in the map's
 *     ID, as the map-local compound-proof profile requires.
 *  -  A map without a proof has to be a collection, a link, or a key, which
 *     FEP-ef61 does not require to be secured.  It is classified under its
 *     effective context, i.e., the `@context` values of its ancestors and
 *     itself, which therefore may only use the simple, preloaded contexts
 *     that the compound-proof policy accepts.
 *
 * Maps that merely refer to a portable object, i.e., have no member other
 * than `id` or `@id`, and maps with non-portable IDs, are neither checked nor
 * verified.  Every `@context` in the document, however, has to be simple, and
 * every portable object that the expanded document describes has to be
 * a map found this way, so that no context can hide a portable object from
 * this check, e.g., by aliasing `@id` or redefining `proof`.  The input must be a finite, already-materialized JSON tree, such
 * as the compact JSON-LD document that is about to be served.
 *
 * @param json The document to check.
 * @param options The options for verifying the proofs.  Proofs whose
 *                verification methods are not `did:key` DID URLs may make
 *                the document loader fetch DID documents.
 * @returns The result, which names the first refused map, if any.
 * @internal
 */
export async function verifyServedPortableObjects(
  json: unknown,
  options: VerifyPortableObjectProofOptions = {},
): Promise<ServedPortableObjectsResult> {
  // Checks exactly what is served, as a tree without shared references, so
  // that every map is counted as many times as it occurs:
  json = JSON.parse(JSON.stringify(json));
  const collected = collectServedPortableMaps(json);
  if (!("maps" in collected)) return collected;
  const maps = collected.maps;
  // The maps are found by their literal members, which a context can make
  // mean something else, e.g., by aliasing @id or redefining proof.  Since
  // expansion turns each map into exactly one node, the document may not
  // describe any portable object more times than the maps found for its ID:
  const discovered = new Map<string, number>();
  const ids = maps.map((candidate) => candidate.id);
  const rootId = isJsonMap(json)
    ? [json.id, json["@id"]].find(isPortableIdValue)
    : undefined;
  if (rootId != null) ids.push(rootId);
  for (const id of ids) discovered.set(id, (discovered.get(id) ?? 0) + 1);
  let hidden: string | undefined;
  try {
    // Subtrees whose contexts cannot be checked map by map are not searched
    // for portable maps, so any portable object they describe is found here:
    hidden = findHiddenPortableObject(
      await jsonld.expand(json, {
        documentLoader: preloadedOnlyDocumentLoader,
      }),
      discovered,
    );
  } catch {
    return { verified: false, path: "", id: "", reason: "unsupportedContext" };
  }
  if (hidden != null) {
    return {
      verified: false,
      path: "",
      id: hidden,
      reason: "hiddenPortableObject",
    };
  }
  for (const candidate of maps) {
    const reason = await checkServedPortableMap(candidate, options);
    if (reason != null) {
      return {
        verified: false,
        path: candidate.path,
        id: candidate.id,
        reason,
      };
    }
  }
  return { verified: true };
}

/**
 * Finds a portable object that an expanded JSON-LD document describes, i.e.,
 * a node with a portable `@id` and other members, more times than the given
 * numbers of maps found for its ID.
 */
function findHiddenPortableObject(
  expanded: unknown,
  discovered: ReadonlyMap<string, number>,
): string | undefined {
  const remaining = new Map(discovered);
  const pending: unknown[] = [expanded];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!isJsonMap(value)) continue;
    const id = value["@id"];
    if (
      isPortableIdValue(id) &&
      Object.keys(value).some((key) => key !== "@id")
    ) {
      const count = remaining.get(id) ?? 0;
      if (count < 1) return id;
      remaining.set(id, count - 1);
    }
    pending.push(...Object.values(value));
  }
  return undefined;
}

/**
 * Checks whether a context uses only preloaded remote contexts and simple
 * term definitions, so that the context in effect for a map can be told from
 * the contexts of its ancestors.
 */
function isCheckableContext(context: unknown): boolean {
  const values = Array.isArray(context) ? context : [context];
  return values.every((value) =>
    typeof value === "string"
      ? Object.hasOwn(preloadedContexts, value)
      : !Array.isArray(value) &&
        isSimpleContext(value as CompoundProofJsonValue)
  );
}

/**
 * Checks whether every remote context that a context refers to is preloaded,
 * so that all of its definitions are known.
 */
function hasOnlyPreloadedRemoteContexts(context: unknown): boolean {
  const values = Array.isArray(context) ? context : [context];
  return values.every((value) =>
    typeof value === "string"
      ? Object.hasOwn(preloadedContexts, value)
      : !Array.isArray(value)
  );
}

/**
 * Checks whether a map or any map below it, outside proof and context values,
 * has a portable `id` or `@id` and other members.
 */
function hasLiteralPortableObject(json: unknown): boolean {
  return findInJsonMaps(
    json,
    (map) =>
      [map.id, map["@id"]].some(isPortableIdValue) &&
        Object.keys(map).some((key) => key !== "id" && key !== "@id")
        ? true
        : undefined,
  ) ?? false;
}

function collectServedPortableMaps(
  json: unknown,
):
  | { maps: ServedPortableMap[] }
  | Extract<ServedPortableObjectsResult, { verified: false }> {
  const maps: ServedPortableMap[] = [];
  const seen = new Set<object>();
  const pending: Array<{
    value: unknown;
    path: string;
    depth: number;
    contexts: readonly unknown[];
  }> = [{ value: json, path: "", depth: 0, contexts: [] }];
  while (pending.length > 0) {
    const { value, path, depth, contexts } = pending.pop()!;
    if (typeof value !== "object" || value == null || seen.has(value)) {
      continue;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index--) {
        pending.push({
          value: value[index],
          path: childPath(path, String(index)),
          depth: depth + 1,
          contexts,
        });
      }
      continue;
    }
    const map = value as Record<string, unknown>;
    const hasContext = Object.hasOwn(map, "@context");
    if (hasContext && !isCheckableContext(map["@context"])) {
      // A context that aliases keywords, e.g., @id, or defines scoped
      // contexts can make the maps below mean something other than their
      // literal members say.  Such a map, e.g., a remote object that an item
      // embeds as it was received, is not searched for portable maps; any
      // portable object that it describes is found by expanding the whole
      // document, which needs all of its remote contexts to be preloaded.
      // A literal portable object in it, which software reading the JSON as
      // is would see, is not allowed either:
      if (
        hasOnlyPreloadedRemoteContexts(map["@context"]) &&
        !hasLiteralPortableObject(map)
      ) {
        continue;
      }
      const id = [map.id, map["@id"]].find((v) => typeof v === "string");
      return {
        verified: false,
        path,
        id: typeof id === "string" ? id : "",
        reason: "unsupportedContext",
      };
    }
    const mapContexts = hasContext ? [...contexts, map["@context"]] : contexts;
    const id = [map.id, map["@id"]].find(isPortableIdValue);
    if (
      depth > 0 && id != null &&
      Object.keys(map).some((key) => key !== "id" && key !== "@id")
    ) {
      maps.push({ path, id, map, contexts: mapContexts });
    }
    const keys = Object.keys(map);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === "proof" || key === "@context") continue;
      pending.push({
        value: map[key],
        path: childPath(path, key),
        depth: depth + 1,
        contexts: mapContexts,
      });
    }
  }
  maps.sort((left, right) => comparePaths(left.path, right.path));
  return { maps };
}

async function checkServedPortableMap(
  { map, contexts }: ServedPortableMap,
  options: VerifyPortableObjectProofOptions,
): Promise<ServedPortableObjectFailureReason | null> {
  if (Object.hasOwn(map, "proof")) {
    if (!isJsonMap(map.proof)) return "unsupportedProofShape";
    if (!Object.hasOwn(map, "@context")) return "missingContext";
    try {
      // The map-local verifier hashes the map exactly as it is served, only
      // without its own proof, so that its context cannot be swapped:
      const key = await verifyMapLocalProof(map, options);
      const policy = await verifyPortableObjectProofPolicy(map, key, options);
      return policy.verified ? null : policy.reason.type;
    } catch (error) {
      if (error instanceof TypeError) return "invalidPortableObject";
      throw error;
    }
  }
  // Only the map's own members are classified, under the context in effect
  // where it sits, which is exactly the chain of the enclosing contexts as
  // long as none of them defines keyword aliases or scoped contexts:
  const flattened = contexts.flatMap((context) =>
    Array.isArray(context) ? context : [context]
  );
  if (
    flattened.length < 1 ||
    !isSimpleContext(flattened as CompoundProofJsonValue[])
  ) {
    return "unsupportedContext";
  }
  let expanded: unknown[];
  try {
    expanded = await jsonld.expand(
      { ...map, "@context": flattened },
      { documentLoader: preloadedOnlyDocumentLoader },
    );
  } catch {
    return "unsupportedContext";
  }
  if (expanded.length !== 1 || !isJsonMap(expanded[0])) {
    return "invalidPortableObject";
  }
  const type = classifyFep2277CoreType(expanded[0]);
  return UNSECURED_CORE_TYPES.has(type) ? null : "missingProof";
}
