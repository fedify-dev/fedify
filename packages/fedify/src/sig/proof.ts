import {
  Activity,
  DataIntegrityProof,
  getTypeId,
  Multikey,
  type Object,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  formatIri,
  getDocumentLoader,
  getFe34Origin,
  haveSameFe34Origin,
  parseIri,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { getLogger } from "@logtape/logtape";
import {
  type MeterProvider,
  SpanStatusCode,
  trace,
  type TracerProvider,
} from "@opentelemetry/api";
import { encodeHex } from "byte-encodings/hex";
import serialize from "json-canon";
import metadata from "../../deno.json" with { type: "json" };
import { normalizeOutgoingActivityJsonLd } from "../compat/outgoing-jsonld.ts";
import { preloadedOnlyDocumentLoader } from "../compat/preloaded-context-loader.ts";
import {
  getDurationMs,
  getFederationMetrics,
  measureSignatureKeyFetch,
  type ObjectIntegrityProofMetricCryptosuite,
  type SignatureVerificationResult,
} from "../federation/metrics.ts";
import {
  fetchKey,
  type FetchKeyResult,
  type KeyCache,
  validateCryptoKey,
} from "./key.ts";
import { getNormalizationContextLoader } from "./ld.ts";

/**
 * Known Object Integrity Proof `cryptosuite` values, used to keep
 * `object_integrity_proofs.cryptosuite` on a bounded set of spec-defined
 * string values.  Fedify currently signs and verifies only
 * `eddsa-jcs-2022`; other values come in only from external proofs and are
 * dropped from the metric attribute to avoid attacker-controlled
 * cardinality.
 */
const OIP_KNOWN_CRYPTOSUITES = new Set<string>(
  ["eddsa-jcs-2022"] satisfies readonly ObjectIntegrityProofMetricCryptosuite[],
);

const logger = getLogger(["fedify", "sig", "proof"]);
const SECURITY_NAMESPACE = "https://w3id.org/security#";
const SECURITY_PROOF = `${SECURITY_NAMESPACE}proof`;
const SECURITY_PROOF_VALUE = `${SECURITY_NAMESPACE}proofValue`;
const DATA_INTEGRITY_PROOF = `${SECURITY_NAMESPACE}DataIntegrityProof`;
const SECURITY_VERIFICATION_METHOD = `${SECURITY_NAMESPACE}verificationMethod`;
const SECURITY_EXPIRATION = `${SECURITY_NAMESPACE}expiration`;
const SECURITY_DOMAIN = `${SECURITY_NAMESPACE}domain`;
const SECURITY_CHALLENGE = `${SECURITY_NAMESPACE}challenge`;
const SECURITY_NONCE = `${SECURITY_NAMESPACE}nonce`;
const SECURITY_PREVIOUS_PROOF = `${SECURITY_NAMESPACE}previousProof`;

/**
 * Checks if the given JSON-LD document has a DataIntegrityProof-like object,
 * without fully deserializing it into vocabulary classes.
 * @param jsonLd The JSON-LD document to check.
 * @returns `true` if the document has a proof-like object; `false` otherwise.
 * @since 2.2.0
 */
export function hasProofLike(jsonLd: unknown): boolean {
  if (typeof jsonLd !== "object" || jsonLd == null) return false;
  const record = jsonLd as Record<string, unknown>;
  const proof = record.proof ?? record["https://w3id.org/security#proof"];

  const getField = (
    source: Record<string, unknown>,
    compact: string,
    expanded: string,
  ): unknown => source[compact] ?? source[expanded];

  const isReference = (value: unknown): boolean => {
    if (typeof value === "string") return true;
    if (Array.isArray(value)) return value.some(isReference);
    return typeof value === "object" && value != null &&
      (("id" in value && typeof value.id === "string") ||
        ("@id" in value && typeof value["@id"] === "string") ||
        ("@value" in value && typeof value["@value"] === "string"));
  };

  const hasType = (value: unknown): boolean => {
    if (typeof value === "string") {
      return value === "DataIntegrityProof" ||
        value === "https://w3id.org/security#DataIntegrityProof";
    }
    if (Array.isArray(value)) return value.some(hasType);
    return false;
  };

  const isProofLike = (value: unknown): boolean => {
    if (typeof value !== "object" || value == null) return false;
    const proofRecord = value as Record<string, unknown>;
    return hasType(proofRecord.type ?? proofRecord["@type"]) &&
      isReference(getField(
        proofRecord,
        "verificationMethod",
        "https://w3id.org/security#verificationMethod",
      )) &&
      isReference(getField(
        proofRecord,
        "proofPurpose",
        "https://w3id.org/security#proofPurpose",
      )) &&
      isReference(getField(
        proofRecord,
        "proofValue",
        "https://w3id.org/security#proofValue",
      ));
  };

  return Array.isArray(proof) ? proof.some(isProofLike) : isProofLike(proof);
}

/**
 * Options for {@link createProof}.
 * @since 0.10.0
 */
export interface CreateProofOptions {
  /**
   * The context loader for loading remote JSON-LD contexts.
   */
  contextLoader?: DocumentLoader;

  /**
   * The JSON-LD context to use for serializing the object to sign.
   */
  context?:
    | string
    | Record<string, string>
    | (string | Record<string, string>)[];

  /**
   * The time when the proof was created.  If not specified, the current time
   * will be used.
   */
  created?: Temporal.Instant;
}

/**
 * Creates a proof for the given object.
 * @param object The object to create a proof for.
 * @param privateKey The private key to sign the proof with.
 * @param keyId The key ID to use in the proof. It will be used by the verifier.
 * @param options Additional options.  See also {@link CreateProofOptions}.
 * @returns The created proof.
 * @throws {TypeError} If the private key is invalid or unsupported.
 * @since 0.10.0
 */
export async function createProof(
  object: Object,
  privateKey: CryptoKey,
  keyId: URL,
  { contextLoader, context, created }: CreateProofOptions = {},
): Promise<DataIntegrityProof> {
  validateCryptoKey(privateKey, "private");
  if (privateKey.algorithm.name !== "Ed25519") {
    throw new TypeError("Unsupported algorithm: " + privateKey.algorithm.name);
  }
  const objectWithoutProofs = object.clone({ proofs: [] });
  let compactMsg = await objectWithoutProofs.toJsonLd({
    format: "compact",
    contextLoader,
    context,
  });
  compactMsg = await normalizeOutgoingActivityJsonLd(
    compactMsg,
    contextLoader,
  );
  const msgCanon = serialize(compactMsg);
  const encoder = new TextEncoder();
  const msgBytes = encoder.encode(msgCanon);
  const msgDigest = await crypto.subtle.digest("SHA-256", msgBytes);
  created ??= Temporal.Now.instant();
  const proofConfig = {
    // deno-lint-ignore no-explicit-any
    "@context": (compactMsg as any)["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: keyId.href,
    proofPurpose: "assertionMethod",
    created: created.toString(),
  };
  const proofCanon = serialize(proofConfig);
  const proofBytes = encoder.encode(proofCanon);
  const proofDigest = await crypto.subtle.digest("SHA-256", proofBytes);
  const digest = new Uint8Array(proofDigest.byteLength + msgDigest.byteLength);
  digest.set(new Uint8Array(proofDigest), 0);
  digest.set(new Uint8Array(msgDigest), proofDigest.byteLength);
  const sig = await crypto.subtle.sign("Ed25519", privateKey, digest);
  return new DataIntegrityProof({
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: keyId,
    proofPurpose: "assertionMethod",
    created: created ?? Temporal.Now.instant(),
    proofValue: new Uint8Array(sig),
  });
}

/**
 * Options for {@link signObject}.
 * @since 0.10.0
 */
export interface SignObjectOptions extends CreateProofOptions {
  /**
   * The document loader for loading remote JSON-LD documents.
   */
  documentLoader?: DocumentLoader;

  /**
   * The OpenTelemetry tracer provider.  If omitted, the global tracer provider
   * is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * Signs the given object with the private key and returns the signed object.
 * @param object The object to create a proof for.
 * @param privateKey The private key to sign the proof with.
 * @param keyId The key ID to use in the proof. It will be used by the verifier.
 * @param options Additional options.  See also {@link SignObjectOptions}.
 * @returns The signed object.
 * @throws {TypeError} If the private key is invalid or unsupported.
 * @since 0.10.0
 */
export async function signObject<T extends Object>(
  object: T,
  privateKey: CryptoKey,
  keyId: URL,
  options: SignObjectOptions = {},
): Promise<T> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return await tracer.startActiveSpan(
    "object_integrity_proofs.sign",
    {
      attributes: { "activitypub.object.type": getTypeId(object).href },
    },
    async (span) => {
      try {
        if (object.id != null) {
          span.setAttribute("activitypub.object.id", object.id.href);
        }
        const existingProofs: DataIntegrityProof[] = [];
        for await (const proof of object.getProofs(options)) {
          existingProofs.push(proof);
        }
        const proof = await createProof(object, privateKey, keyId, options);
        if (span.isRecording()) {
          if (proof.cryptosuite != null) {
            span.setAttribute(
              "object_integrity_proofs.cryptosuite",
              proof.cryptosuite,
            );
          }
          if (proof.verificationMethodId != null) {
            span.setAttribute(
              "object_integrity_proofs.key_id",
              proof.verificationMethodId.href,
            );
          }
          if (proof.proofValue != null) {
            span.setAttribute(
              "object_integrity_proofs.signature",
              encodeHex(proof.proofValue),
            );
          }
        }
        return object.clone({ proofs: [...existingProofs, proof] }) as T;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Options for {@link verifyProof}.
 * @since 0.10.0
 */
export interface VerifyProofOptions {
  /**
   * The security domain expected by the verifier.  When specified, it must
   * contain the same strings as the proof's `domain` option.
   * @since 2.4.0
   */
  domain?: string | readonly string[];

  /**
   * The challenge expected by the verifier.  When specified, it must exactly
   * match the proof's `challenge` option.
   * @since 2.4.0
   */
  challenge?: string;

  /**
   * The context loader for loading remote JSON-LD contexts.
   */
  contextLoader?: DocumentLoader;

  /**
   * The document loader for loading remote JSON-LD documents.
   */
  documentLoader?: DocumentLoader;

  /**
   * The key cache to use for caching public keys.
   * @since 0.12.0
   */
  keyCache?: KeyCache;

  /**
   * The OpenTelemetry tracer provider.  If omitted, the global tracer provider
   * is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;

  /**
   * The OpenTelemetry meter provider.  If omitted, the global meter provider
   * is used.
   * @since 2.3.0
   */
  meterProvider?: MeterProvider;
}

/**
 * Options for {@link verifyPortableObjectProof}.
 * @since 2.4.0
 */
export interface VerifyPortableObjectProofOptions extends VerifyProofOptions {
}

/**
 * The reason why {@link verifyPortableObjectProof} could not verify a portable
 * object proof.
 * @since 2.4.0
 */
export type VerifyPortableObjectProofFailureReason =
  | {
    /** The document does not have a portable `ap:` or `ap+ef61:` ID. */
    readonly type: "notPortableObject";
  }
  | {
    /**
     * The document is a portable collection without an Object Integrity
     * Proof.  Its trust policy is outside this verifier.
     */
    readonly type: "unsecuredCollection";
  }
  | {
    /** The portable document is a core type outside FEP-ef61 proof policy. */
    readonly type: "unsupportedObjectType";
    /** The FEP-2277 core type of the document. */
    readonly objectType: "verificationMethod" | "publicKey" | "link";
  }
  | {
    /** A portable actor, activity, or object has no proof. */
    readonly type: "missingProof";
  }
  | {
    /** The proof is malformed, unsupported, or cryptographically invalid. */
    readonly type: "invalidProof";
    /** The zero-based index of the invalid proof. */
    readonly proofIndex: number;
  }
  | {
    /** The proof's verification method is not a valid DID URL. */
    readonly type: "unsupportedVerificationMethod";
    /** The zero-based index of the proof. */
    readonly proofIndex: number;
    /** The unsupported verification method. */
    readonly verificationMethod: URL;
  }
  | {
    /** The verification method DID does not match the portable ID authority. */
    readonly type: "verificationMethodMismatch";
    /** The zero-based index of the proof. */
    readonly proofIndex: number;
    /** The portable object ID. */
    readonly objectId: URL;
    /** The mismatching verification method. */
    readonly verificationMethod: URL;
  };

/**
 * The detailed result of {@link verifyPortableObjectProof}.
 * @since 2.4.0
 */
export type VerifyPortableObjectProofResult =
  | {
    /** Whether every Object Integrity Proof was verified. */
    readonly verified: true;
    /** The public keys used by the verified proofs, in proof order. */
    readonly keys: readonly Multikey[];
  }
  | {
    /** Whether every Object Integrity Proof was verified. */
    readonly verified: false;
    /** Why portable proof verification did not succeed. */
    readonly reason: VerifyPortableObjectProofFailureReason;
  };

/**
 * Verifies the given proof for the object.
 * @param jsonLd The JSON-LD object to verify the proof for.  Its proof
 *               properties are excluded from the message, but matching proof
 *               occurrences are used to authenticate the received proof
 *               configuration.
 * @param proof The proof to verify.
 * @param options Additional options.  See also {@link VerifyProofOptions}.
 * @returns The public key that was used to sign the proof, or `null` if the
 *          proof is invalid.
 * @since 0.10.0
 * @since 2.4.0 Matching proof configurations are authenticated.
 */
export async function verifyProof(
  jsonLd: unknown,
  proof: DataIntegrityProof,
  options: VerifyProofOptions = {},
): Promise<Multikey | null> {
  return await verifyProofWithMessageDigestCache(jsonLd, proof, options);
}

/**
 * Verifies the one direct literal proof on a map-local secured document.
 *
 * Unlike {@link verifyProof}, this removes only the literal `proof` member
 * from the message digest.  JSON-LD aliases remain part of the signed input,
 * and the document's received `@context` is not replaced by the proof
 * configuration context.
 *
 * @internal
 */
export async function verifyMapLocalProof(
  jsonLd: unknown,
  options: VerifyProofOptions = {},
): Promise<Multikey | null> {
  if (
    !isJsonLdNode(jsonLd) || !globalThis.Object.hasOwn(jsonLd, "proof") ||
    !isJsonLdNode(jsonLd.proof)
  ) {
    return null;
  }
  const proofContextLoader = getNormalizationContextLoader(
    preloadedOnlyDocumentLoader,
  );
  try {
    const [candidate] = await parseRawProofCandidates(
      jsonLd,
      [jsonLd.proof],
      options,
      proofContextLoader,
    );
    if (candidate.proof == null) return null;
    return await verifyProofWithMessageDigestCache(
      jsonLd,
      candidate.proof,
      options,
      { proofContextLoader, proofPropertyMode: "literal" },
      candidate,
    );
  } catch {
    return null;
  }
}

async function verifyProofWithMessageDigestCache(
  jsonLd: unknown,
  proof: DataIntegrityProof,
  options: VerifyProofOptions,
  messageDigestCache: ProofMessageDigestCache = {},
  rawProofCandidate?: RawProofCandidate,
): Promise<Multikey | null> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(metadata.name, metadata.version);
  return await tracer.startActiveSpan(
    "object_integrity_proofs.verify",
    async (span) => {
      const start = performance.now();
      let verified = false;
      let threw = false;
      const cryptosuite: ObjectIntegrityProofMetricCryptosuite | undefined =
        proof.cryptosuite != null &&
          OIP_KNOWN_CRYPTOSUITES.has(proof.cryptosuite)
          ? proof.cryptosuite
          : undefined;
      if (span.isRecording()) {
        if (proof.cryptosuite != null) {
          span.setAttribute(
            "object_integrity_proofs.cryptosuite",
            proof.cryptosuite,
          );
        }
        if (proof.verificationMethodId != null) {
          span.setAttribute(
            "object_integrity_proofs.key_id",
            proof.verificationMethodId.href,
          );
        }
        if (proof.proofValue != null) {
          span.setAttribute(
            "object_integrity_proofs.signature",
            encodeHex(proof.proofValue),
          );
        }
      }
      try {
        const key = await verifyProofInternal(
          jsonLd,
          proof,
          options,
          messageDigestCache,
          rawProofCandidate,
        );
        if (key == null) span.setStatus({ code: SpanStatusCode.ERROR });
        else verified = true;
        return key;
      } catch (error) {
        threw = true;
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(error),
        });
        throw error;
      } finally {
        const classified: SignatureVerificationResult = threw
          ? "error"
          : verified
          ? "verified"
          : "rejected";
        getFederationMetrics(options.meterProvider)
          .recordSignatureVerificationDuration(
            getDurationMs(start),
            "object_integrity",
            classified,
            { cryptosuite },
          );
        span.end();
      }
    },
  );
}

interface ProofMessageDigests {
  readonly onWire: ArrayBuffer;
  readonly normalized: () => Promise<ArrayBuffer | null>;
}

interface ProofMessageDigestCache {
  values?: Map<string, Promise<ProofMessageDigests>>;
  proofContextLoader?: DocumentLoader;
  proofPropertyMode?: "jsonLd" | "literal";
}

function expandContextPropertyIri(
  activeContext: unknown,
  key: string,
): unknown {
  const termId = jsonld.getContextValue(activeContext, key, "@id");
  if (termId != null) return termId;
  const colon = key.indexOf(":");
  if (colon < 1) return key;
  const prefix = key.substring(0, colon);
  const suffix = key.substring(colon + 1);
  if (prefix === "_" || suffix.startsWith("//")) return key;
  const mapping = jsonld.getContextValue(activeContext, prefix);
  if (
    typeof mapping === "object" && mapping != null &&
    mapping._prefix === true &&
    typeof mapping["@id"] === "string"
  ) {
    return mapping["@id"] + suffix;
  }
  return key;
}

async function getJsonLdPropertyNames(
  jsonLd: Record<string, unknown>,
  propertyIri: string,
  defaults: readonly string[],
  documentLoader: DocumentLoader = preloadedOnlyDocumentLoader,
  inheritedContext?: unknown,
  rejectOnContextError = false,
): Promise<Set<string> | null> {
  const names = new Set(defaults);
  const context = jsonLd["@context"] ?? inheritedContext;
  if (context == null) return names;
  try {
    const options = { documentLoader };
    let activeContext = await jsonld.processContext(null, null, options);
    activeContext = await jsonld.processContext(
      activeContext,
      context,
      options,
    );
    const typeScopedContext = activeContext;
    for (const key of globalThis.Object.keys(jsonLd).sort()) {
      if (
        key !== "@type" &&
        expandContextPropertyIri(activeContext, key) !== "@type"
      ) {
        continue;
      }
      const value = jsonLd[key];
      const types = Array.isArray(value) ? value.slice().sort() : [value];
      for (const type of types) {
        if (typeof type !== "string") continue;
        const scopedContext = jsonld.getContextValue(
          typeScopedContext,
          type,
          "@context",
        );
        if (scopedContext != null) {
          activeContext = await jsonld.processContext(
            activeContext,
            scopedContext,
            options,
          );
        }
      }
    }
    for (const key of globalThis.Object.keys(jsonLd)) {
      if (expandContextPropertyIri(activeContext, key) === propertyIri) {
        names.add(key);
      }
    }
  } catch {
    if (rejectOnContextError) return null;
    // Unavailable contexts must not prevent the literal proof properties
    // from being removed without a network fetch.
  }
  return names;
}

async function getProofPropertyNames(
  jsonLd: Record<string, unknown>,
  documentLoader: DocumentLoader = preloadedOnlyDocumentLoader,
): Promise<Set<string>> {
  return await getJsonLdPropertyNames(
    jsonLd,
    SECURITY_PROOF,
    ["proof", SECURITY_PROOF],
    documentLoader,
  ) ?? new Set(["proof", SECURITY_PROOF]);
}

async function createProofMessageDigests(
  jsonLd: Record<string, unknown>,
  proofContextLoader?: DocumentLoader,
  context?: unknown,
  proofPropertyMode: "jsonLd" | "literal" = "jsonLd",
): Promise<ProofMessageDigests> {
  const msg = { ...jsonLd };
  if (proofPropertyMode === "literal") {
    delete msg.proof;
  } else {
    // `verifyProof()` promises to ignore existing proofs on the input;
    // strip every top-level property that the active JSON-LD context maps to
    // the security proof predicate so its bytes are not folded into the JCS
    // message digest.
    for (
      const property of await getProofPropertyNames(msg, proofContextLoader)
    ) {
      delete msg[property];
    }
  }
  if (proofPropertyMode === "jsonLd" && context != null) {
    msg["@context"] = structuredClone(context);
  }
  const encoder = new TextEncoder();
  const digest = async (value: unknown): Promise<ArrayBuffer> => {
    const bytes = encoder.encode(serialize(value));
    return await crypto.subtle.digest("SHA-256", bytes);
  };
  const onWire = await digest(msg);
  let normalizedPromise: Promise<ArrayBuffer | null> | undefined;
  return {
    onWire,
    normalized() {
      normalizedPromise ??= (async () => {
        // This fallback runs on inbound, attacker-controlled JSON-LD, so the
        // loader must not fetch custom `@context` URLs from the network.
        const normalized = await normalizeOutgoingActivityJsonLd(
          msg,
          preloadedOnlyDocumentLoader,
        );
        return normalized === msg ? null : await digest(normalized);
      })();
      return normalizedPromise;
    },
  };
}

interface ProofConfiguration {
  readonly value: Record<string, unknown>;
  readonly context: unknown;
}

function contextValues(context: unknown): unknown[] {
  return Array.isArray(context) ? context : [context];
}

function equalJsonValues(left: unknown, right: unknown): boolean {
  try {
    return serialize(left) === serialize(right);
  } catch {
    return false;
  }
}

function contextStartsWith(
  documentContext: unknown,
  proofContext: unknown,
): boolean {
  if (documentContext == null) return false;
  const documentValues = contextValues(documentContext);
  const proofValues = contextValues(proofContext);
  return proofValues.length <= documentValues.length &&
    proofValues.every((value, index) =>
      equalJsonValues(value, documentValues[index])
    );
}

function appendProofValues(values: unknown[], value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) appendProofValues(values, item);
  } else if (
    isJsonLdNode(value) && Array.isArray(value["@graph"])
  ) {
    for (const item of value["@graph"]) appendProofValues(values, item);
  } else {
    values.push(value);
  }
}

async function getRawProofValues(
  jsonLd: Record<string, unknown>,
  documentLoader: DocumentLoader,
): Promise<unknown[]> {
  const propertyNames = await getProofPropertyNames(jsonLd, documentLoader);
  const values: unknown[] = [];
  for (const [property, value] of globalThis.Object.entries(jsonLd)) {
    if (propertyNames.has(property)) appendProofValues(values, value);
  }
  return values;
}

function sameBytes(
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean {
  if (left == null || right == null) return left === right;
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function sameProof(
  left: DataIntegrityProof,
  right: DataIntegrityProof,
): boolean {
  return left.cryptosuite === right.cryptosuite &&
    left.verificationMethodId?.href === right.verificationMethodId?.href &&
    left.proofPurpose === right.proofPurpose &&
    sameBytes(left.proofValue, right.proofValue) &&
    left.created?.toString() === right.created?.toString();
}

interface RawProofCandidate {
  readonly value: unknown;
  readonly proof: DataIntegrityProof | null;
  readonly reference?: string;
}

function normalizeDocumentUrl(url: string): string {
  try {
    return formatIri(parseIri(url));
  } catch {
    return URL.canParse(url) ? new URL(url).href : url;
  }
}

function getRawProofReference(value: unknown): string | undefined {
  const node = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (typeof node === "string") return normalizeDocumentUrl(node);
  if (!isJsonLdNode(node)) return undefined;
  const id = node["@id"] ?? node.id;
  return typeof id === "string" ? normalizeDocumentUrl(id) : undefined;
}

async function parseRawProofCandidates(
  jsonLd: Record<string, unknown>,
  values: readonly unknown[],
  options: VerifyProofOptions,
  documentLoader: DocumentLoader,
): Promise<RawProofCandidate[]> {
  const candidates: RawProofCandidate[] = [];
  for (const value of values) {
    let parsed: DataIntegrityProof | null = null;
    if (isJsonLdNode(value)) {
      const proofJsonLd = value["@context"] == null &&
          jsonLd["@context"] != null
        ? { "@context": jsonLd["@context"], ...value }
        : value;
      try {
        parsed = await DataIntegrityProof.fromJsonLd(
          proofJsonLd,
          { ...options, contextLoader: documentLoader },
        );
      } catch {
        // Malformed sibling proofs cannot match a typed proof.
      }
    }
    candidates.push({
      value,
      proof: parsed,
      reference: getRawProofReference(value) ?? parsed?.id?.href,
    });
  }
  return candidates;
}

async function findRawProofCandidate(
  jsonLd: Record<string, unknown>,
  proof: DataIntegrityProof,
  options: VerifyProofOptions,
  documentLoader: DocumentLoader,
): Promise<RawProofCandidate | null | undefined> {
  const candidates = await parseRawProofCandidates(
    jsonLd,
    await getRawProofValues(jsonLd, documentLoader),
    options,
    documentLoader,
  );
  const matches: RawProofCandidate[] = [];
  for (const candidate of candidates) {
    if (
      candidate.proof != null &&
      sameProof(candidate.proof, proof)
    ) {
      matches.push(candidate);
    }
  }
  if (matches.length < 1) return undefined;
  const first = matches[0];
  // A standalone verifyProof() call cannot know which received occurrence
  // produced the lossy typed proof.  Compare the signed configurations after
  // inheriting the document context and removing proofValue so equivalent
  // JSON-LD representations remain interchangeable.
  const configurations = await Promise.all(
    matches.map((candidate) =>
      normalizeProofConfiguration(
        candidate.value,
        jsonLd["@context"],
        documentLoader,
      )
    ),
  );
  const firstConfiguration = configurations[0];
  return firstConfiguration != null &&
      configurations.every((configuration) =>
        configuration != null &&
        equalJsonValues(configuration.value, firstConfiguration.value)
      )
    ? first
    : null;
}

interface RawProofCandidatePool {
  readonly candidates: readonly RawProofCandidate[];
  readonly used: Set<number>;
}

function takeRawProofCandidate(
  pool: RawProofCandidatePool,
  proof: DataIntegrityProof,
): RawProofCandidate | undefined {
  for (let index = 0; index < pool.candidates.length; index++) {
    if (pool.used.has(index)) continue;
    const candidate = pool.candidates[index];
    if (
      candidate.proof != null &&
      sameProof(candidate.proof, proof)
    ) {
      pool.used.add(index);
      return candidate;
    }
  }
  return undefined;
}

const STANDARD_COMPACT_PROOF_PROPERTIES = new Set([
  "@context",
  "type",
  "cryptosuite",
  "verificationMethod",
  "proofPurpose",
  "proofValue",
  "created",
]);

const STANDARD_EXPANDED_PROOF_PROPERTIES = new Set([
  "@context",
  "@type",
  `${SECURITY_NAMESPACE}cryptosuite`,
  SECURITY_VERIFICATION_METHOD,
  `${SECURITY_NAMESPACE}proofPurpose`,
  `${SECURITY_NAMESPACE}proofValue`,
  "http://purl.org/dc/terms/created",
]);

function hasAdditionalProofOptions(value: unknown): boolean {
  const node = Array.isArray(value) && value.length === 1 ? value[0] : value;
  return isJsonLdNode(node) &&
    globalThis.Object.keys(node).some((property) =>
      !STANDARD_COMPACT_PROOF_PROPERTIES.has(property) &&
      !STANDARD_EXPANDED_PROOF_PROPERTIES.has(property)
    );
}

function isExpandedJsonLdNode(value: Record<string, unknown>): boolean {
  const properties = globalThis.Object.keys(value).filter((key) =>
    !key.startsWith("@")
  );
  return properties.length > 0 &&
    properties.every((property) => URL.canParse(property));
}

async function normalizeProofConfiguration(
  rawProof: unknown,
  documentContext: unknown,
  documentLoader: DocumentLoader,
): Promise<ProofConfiguration | null> {
  let node = Array.isArray(rawProof) && rawProof.length === 1
    ? rawProof[0]
    : rawProof;
  if (!isJsonLdNode(node)) return null;
  if (isExpandedJsonLdNode(node)) {
    if (documentContext == null) return null;
    node = await jsonld.compact(node, documentContext, {
      documentLoader,
    });
    if (!isJsonLdNode(node)) return null;
  } else {
    node = structuredClone(node);
  }

  const receivedContext = node["@context"];
  if (
    receivedContext != null &&
    !contextStartsWith(documentContext, receivedContext)
  ) {
    return null;
  }
  const context = receivedContext ?? documentContext;
  if (context != null) node["@context"] = structuredClone(context);

  const proofValueProperties = await getJsonLdPropertyNames(
    node,
    SECURITY_PROOF_VALUE,
    ["proofValue", SECURITY_PROOF_VALUE],
    documentLoader,
    context,
  ) ?? new Set(["proofValue", SECURITY_PROOF_VALUE]);
  for (const property of proofValueProperties) delete node[property];
  return { value: node, context };
}

async function createProofConfiguration(
  jsonLd: Record<string, unknown>,
  proof: DataIntegrityProof,
  options: VerifyProofOptions,
  documentLoader: DocumentLoader,
  rawProofCandidate?: RawProofCandidate,
): Promise<ProofConfiguration | null> {
  let rawProof: unknown;
  if (rawProofCandidate == null) {
    const match = await findRawProofCandidate(
      jsonLd,
      proof,
      options,
      documentLoader,
    );
    if (match === null) return null;
    rawProof = match?.value;
  } else {
    rawProof = rawProofCandidate.value;
  }
  if (rawProof == null) {
    const serializedProof = await proof.toJsonLd();
    if (hasAdditionalProofOptions(serializedProof)) {
      rawProof = serializedProof;
    }
  }
  if (rawProof != null) {
    return await normalizeProofConfiguration(
      rawProof,
      jsonLd["@context"],
      documentLoader,
    );
  }
  const context = jsonLd["@context"];
  return {
    value: {
      ...(context == null ? {} : { "@context": context }),
      type: "DataIntegrityProof",
      cryptosuite: proof.cryptosuite,
      verificationMethod: proof.verificationMethodId!.href,
      proofPurpose: proof.proofPurpose,
      created: proof.created!.toString(),
    },
    context,
  };
}

interface ProofOption {
  readonly present: boolean;
  readonly value?: unknown;
}

const KNOWN_PROOF_CONFIGURATION_PROPERTIES = new Set([
  "@context",
  "@id",
  "@type",
  "id",
  "type",
  "cryptosuite",
  `${SECURITY_NAMESPACE}cryptosuite`,
  "verificationMethod",
  SECURITY_VERIFICATION_METHOD,
  "proofPurpose",
  `${SECURITY_NAMESPACE}proofPurpose`,
  "created",
  "http://purl.org/dc/terms/created",
  "expires",
  SECURITY_EXPIRATION,
  "domain",
  SECURITY_DOMAIN,
  "challenge",
  SECURITY_CHALLENGE,
  "nonce",
  SECURITY_NONCE,
  "previousProof",
  SECURITY_PREVIOUS_PROOF,
]);

async function getProofOption(
  proofConfig: Record<string, unknown>,
  propertyIri: string,
  defaults: readonly string[],
  documentLoader: DocumentLoader,
): Promise<ProofOption | null> {
  let names = await getJsonLdPropertyNames(
    proofConfig,
    propertyIri,
    defaults,
    documentLoader,
    proofConfig["@context"],
    true,
  );
  if (names == null) {
    if (
      globalThis.Object.keys(proofConfig).some((property) =>
        !KNOWN_PROOF_CONFIGURATION_PROPERTIES.has(property)
      )
    ) {
      return null;
    }
    names = new Set(defaults);
  }
  const present = globalThis.Object.keys(proofConfig).filter((property) =>
    names.has(property)
  );
  if (present.length > 1) return null;
  return present.length < 1
    ? { present: false }
    : { present: true, value: proofConfig[present[0]] };
}

function parseStringSet(value: unknown): Set<string> | null {
  if (typeof value === "string") return new Set([value]);
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string")
  ) {
    return null;
  }
  return new Set(value);
}

function equalStringSets(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size &&
    [...left].every((value) => right.has(value));
}

async function hasValidProofOptions(
  proofConfig: Record<string, unknown>,
  options: VerifyProofOptions,
  documentLoader: DocumentLoader,
): Promise<boolean> {
  const expires = await getProofOption(
    proofConfig,
    SECURITY_EXPIRATION,
    ["expires", SECURITY_EXPIRATION],
    documentLoader,
  );
  if (expires == null) return false;
  if (expires.present) {
    if (typeof expires.value !== "string") return false;
    let expiration: Temporal.Instant;
    try {
      expiration = Temporal.Instant.from(expires.value);
    } catch {
      return false;
    }
    if (Temporal.Instant.compare(Temporal.Now.instant(), expiration) >= 0) {
      return false;
    }
  }

  const domain = await getProofOption(
    proofConfig,
    SECURITY_DOMAIN,
    ["domain", SECURITY_DOMAIN],
    documentLoader,
  );
  if (domain == null) return false;
  const proofDomains = domain.present ? parseStringSet(domain.value) : null;
  if (domain.present && proofDomains == null) return false;
  if (options.domain != null) {
    const expectedDomains = parseStringSet(options.domain);
    if (
      expectedDomains == null || proofDomains == null ||
      !equalStringSets(proofDomains, expectedDomains)
    ) {
      return false;
    }
  }

  const challenge = await getProofOption(
    proofConfig,
    SECURITY_CHALLENGE,
    ["challenge", SECURITY_CHALLENGE],
    documentLoader,
  );
  if (
    challenge == null ||
    challenge.present && typeof challenge.value !== "string" ||
    options.challenge != null &&
      (!challenge.present || challenge.value !== options.challenge)
  ) {
    return false;
  }

  const nonce = await getProofOption(
    proofConfig,
    SECURITY_NONCE,
    ["nonce", SECURITY_NONCE],
    documentLoader,
  );
  if (
    nonce == null ||
    nonce.present && typeof nonce.value !== "string"
  ) {
    return false;
  }

  const previousProof = await getProofOption(
    proofConfig,
    SECURITY_PREVIOUS_PROOF,
    ["previousProof", SECURITY_PREVIOUS_PROOF],
    documentLoader,
  );
  if (
    previousProof == null ||
    previousProof.present &&
      typeof previousProof.value !== "string" &&
      (!Array.isArray(previousProof.value) ||
        previousProof.value.some((item) => typeof item !== "string"))
  ) {
    return false;
  }
  return true;
}

async function verifyProofInternal(
  jsonLd: unknown,
  proof: DataIntegrityProof,
  options: VerifyProofOptions,
  messageDigestCache: ProofMessageDigestCache,
  rawProofCandidate?: RawProofCandidate,
): Promise<Multikey | null> {
  if (
    !isJsonLdNode(jsonLd) ||
    proof.cryptosuite !== "eddsa-jcs-2022" ||
    proof.verificationMethodId == null ||
    proof.proofPurpose !== "assertionMethod" ||
    proof.proofValue == null ||
    proof.created == null
  ) return null;
  const proofContextLoader = messageDigestCache.proofContextLoader ??
    preloadedOnlyDocumentLoader;
  const proofConfiguration = await createProofConfiguration(
    jsonLd,
    proof,
    options,
    proofContextLoader,
    rawProofCandidate,
  );
  if (
    proofConfiguration == null ||
    !await hasValidProofOptions(
      proofConfiguration.value,
      options,
      proofContextLoader,
    )
  ) {
    return null;
  }
  // Start the key fetch eagerly so it overlaps with the JCS
  // canonicalization and SHA-256 digest work below.  `measureSignatureKeyFetch`
  // is an async function whose body runs synchronously up to the first
  // `await`, so invoking it here actually begins the fetch immediately and
  // returns a Promise the caller can hold and await later.
  const publicKeyPromise = measureSignatureKeyFetch(
    options.meterProvider,
    "object_integrity",
    () => fetchKey(proof.verificationMethodId!, Multikey, options),
  );
  const encoder = new TextEncoder();
  const proofBytes = encoder.encode(serialize(proofConfiguration.value));
  const proofDigest = await crypto.subtle.digest("SHA-256", proofBytes);
  // Try the on-wire form first.  Only if that fails do we fall back to
  // Fedify's outgoing JSON-LD compatibility form so that signatures created
  // by `createProof` (which signs the normalized bytes) still verify when the
  // caller passes the default `toJsonLd({ format: "compact" })` output.
  //
  // This fallback must stay on normalizeOutgoingActivityJsonLd()'s
  // preloaded-only default loader: it runs on inbound, potentially adversarial
  // JSON-LD, and must not let attacker-supplied `@context` URLs steer
  // canonicalization into a network fetch through `options.contextLoader`.
  let fetchedKey: FetchKeyResult<Multikey> | null;
  try {
    fetchedKey = await publicKeyPromise;
  } catch (error) {
    logger.debug(
      "Failed to get the key (verificationMethod) for the proof:\n{proof}",
      { proof, keyId: proof.verificationMethodId.href, error },
    );
    return null;
  }
  const publicKey = fetchedKey.key;
  if (publicKey == null) {
    logger.debug(
      "Failed to get the key (verificationMethod) for the proof:\n{proof}",
      { proof, keyId: proof.verificationMethodId.href },
    );
    return null;
  }
  if (publicKey.publicKey.algorithm.name !== "Ed25519") {
    if (fetchedKey.cached) {
      logger.debug(
        "The cached key (verificationMethod) for the proof is not a valid " +
          "Ed25519 key:\n{keyId}; retrying with the freshly fetched key...",
        { proof, keyId: proof.verificationMethodId.href },
      );
      // Recurse into `verifyProofInternal()` (not `verifyProof()`) so the
      // retry reuses the outer `object_integrity_proofs.verify` span and
      // `activitypub.signature.verification.duration` measurement.
      return await verifyProofInternal(
        jsonLd,
        proof,
        {
          ...options,
          keyCache: {
            // Returning `undefined` signals "nothing cached" and forces
            // `fetchKey()` to refetch from the network; returning `null`
            // would instead be interpreted as a cached-unavailable result
            // and short-circuit the retry.
            get: () => Promise.resolve(undefined),
            set: async (keyId, key) => await options.keyCache?.set(keyId, key),
          },
        },
        messageDigestCache,
        rawProofCandidate,
      );
    }
    logger.debug(
      "The fetched key (verificationMethod) for the proof is not a valid " +
        "Ed25519 key:\n{keyId}",
      { proof, keyId: proof.verificationMethodId.href },
    );
    return null;
  }
  // SHA-256 always produces 32 bytes; `proofDigest` is constant across
  // candidates, so allocate the combined digest buffer once and only
  // rewrite the message-digest tail per iteration.
  const SHA256_LENGTH = 32;
  const digest = new Uint8Array(proofDigest.byteLength + SHA256_LENGTH);
  digest.set(new Uint8Array(proofDigest), 0);
  const proofValue = proof.proofValue;
  const verifyCandidate = async (msgDigest: ArrayBuffer): Promise<boolean> => {
    digest.set(new Uint8Array(msgDigest), proofDigest.byteLength);
    return await crypto.subtle.verify(
      "Ed25519",
      publicKey.publicKey,
      // `.slice()` narrows `Uint8Array<ArrayBufferLike>` (which can be
      // backed by a `SharedArrayBuffer`) to `Uint8Array<ArrayBuffer>`,
      // which is what `crypto.subtle.verify` expects.
      proofValue.slice(),
      digest,
    );
  };
  const messageDigestKey = serialize(proofConfiguration.context ?? null);
  const messageDigestValues = messageDigestCache.values ??= new Map();
  let messageDigestsPromise = messageDigestValues.get(messageDigestKey);
  if (messageDigestsPromise == null) {
    messageDigestsPromise = createProofMessageDigests(
      jsonLd,
      messageDigestCache.proofContextLoader,
      proofConfiguration.context,
      messageDigestCache.proofPropertyMode,
    );
    messageDigestValues.set(messageDigestKey, messageDigestsPromise);
  }
  const messageDigests = await messageDigestsPromise;
  if (await verifyCandidate(messageDigests.onWire)) return publicKey;
  if (messageDigestCache.proofPropertyMode !== "literal") {
    const normalizedDigest = await messageDigests.normalized();
    if (normalizedDigest != null && await verifyCandidate(normalizedDigest)) {
      return publicKey;
    }
  }
  if (fetchedKey.cached) {
    logger.debug(
      "Failed to verify the proof with the cached key {keyId}; retrying " +
        "with the freshly fetched key...",
      { keyId: proof.verificationMethodId.href, proof },
    );
    // Recurse into `verifyProofInternal()` (not `verifyProof()`) so the
    // retry reuses the outer `object_integrity_proofs.verify` span and
    // `activitypub.signature.verification.duration` measurement.
    return await verifyProofInternal(
      jsonLd,
      proof,
      {
        ...options,
        keyCache: {
          get: () => Promise.resolve(undefined),
          set: async (keyId, key) => await options.keyCache?.set(keyId, key),
        },
      },
      messageDigestCache,
      rawProofCandidate,
    );
  }
  logger.debug(
    "Failed to verify the proof with the fetched key {keyId}:\n{proof}",
    { keyId: proof.verificationMethodId.href, proof },
  );
  return null;
}

type Fep2277CoreType =
  | "actor"
  | "activity"
  | "collection"
  | "verificationMethod"
  | "publicKey"
  | "link"
  | "object";

const AS_NAMESPACE = "https://www.w3.org/ns/activitystreams#";
const FEP_2277_ACTOR_PROPERTIES = [
  "http://www.w3.org/ns/ldp#inbox",
  `${AS_NAMESPACE}outbox`,
] as const;
const FEP_2277_COLLECTION_PROPERTIES = [
  "items",
  "orderedItems",
  "totalItems",
  "partOf",
  "first",
  "last",
  "next",
  "prev",
  "current",
].map((property) => AS_NAMESPACE + property);
const PORTABLE_OBJECT_ID_PATTERN = /^ap(?:\+ef61)?:\/\//i;
const FUNCTIONAL_PROOF_PROPERTIES = [
  `${SECURITY_NAMESPACE}cryptosuite`,
  SECURITY_VERIFICATION_METHOD,
  `${SECURITY_NAMESPACE}proofPurpose`,
  `${SECURITY_NAMESPACE}proofValue`,
  "http://purl.org/dc/terms/created",
] as const;

function isJsonLdNode(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function hasValidPortableProofShape(proofValue: unknown): boolean {
  if (!isJsonLdNode(proofValue)) return false;
  let proofNode = proofValue;
  if ("@graph" in proofNode) {
    const graph = proofNode["@graph"];
    if (
      !Array.isArray(graph) || graph.length !== 1 ||
      !isJsonLdNode(graph[0])
    ) {
      return false;
    }
    proofNode = graph[0];
  }
  const types = proofNode["@type"];
  return Array.isArray(types) &&
    types.length === 1 &&
    types[0] === DATA_INTEGRITY_PROOF &&
    FUNCTIONAL_PROOF_PROPERTIES.every((property) => {
      const values = proofNode[property];
      return Array.isArray(values) &&
        values.length === 1 &&
        !(isJsonLdNode(values[0]) && "@list" in values[0]);
    });
}

function classifyFep2277CoreType(
  node: Record<string, unknown>,
): Fep2277CoreType {
  if (FEP_2277_ACTOR_PROPERTIES.every((property) => property in node)) {
    return "actor";
  }
  if (`${SECURITY_NAMESPACE}publicKeyMultibase` in node) {
    return "verificationMethod";
  }
  if (`${SECURITY_NAMESPACE}publicKeyPem` in node) return "publicKey";
  if (`${AS_NAMESPACE}href` in node) return "link";
  if (`${AS_NAMESPACE}actor` in node) return "activity";
  if (FEP_2277_COLLECTION_PROPERTIES.some((property) => property in node)) {
    return "collection";
  }
  return "object";
}

async function expandPortableObjectRoot(
  jsonLd: unknown,
  contextLoader: DocumentLoader | undefined,
): Promise<{
  root: Record<string, unknown>;
  proofContextLoader: DocumentLoader;
}> {
  if (!isJsonLdNode(jsonLd)) {
    throw new TypeError("Expected a single JSON-LD object.");
  }
  const loadedContexts = new Map<string, RemoteDocument>();
  const loader = getNormalizationContextLoader(contextLoader);
  const recordingLoader: DocumentLoader = async (url, options) => {
    const remoteDocument = await loader(url, options);
    const key = URL.canParse(url) ? new URL(url).href : url;
    loadedContexts.set(key, structuredClone(remoteDocument));
    return remoteDocument;
  };
  const expanded = await jsonld.expand(jsonLd, {
    documentLoader: recordingLoader,
    keepFreeFloatingNodes: true,
  });
  if (expanded.length !== 1 || !isJsonLdNode(expanded[0])) {
    throw new TypeError("Expected a single JSON-LD object.");
  }
  return {
    root: expanded[0],
    proofContextLoader: async (url, options) => {
      const key = URL.canParse(url) ? new URL(url).href : url;
      const remoteDocument = loadedContexts.get(key);
      if (remoteDocument != null) return structuredClone(remoteDocument);
      return await preloadedOnlyDocumentLoader(url, options);
    },
  };
}

/**
 * Verifies the FEP-ef61 Object Integrity Proof policy for a portable object.
 *
 * This applies the FEP-2277 core-type classification to the top-level JSON-LD
 * node.  Portable actors, activities, and objects require proofs.  A portable
 * collection without a proof is reported separately so a caller can apply a
 * gateway trust policy.  Embedded portable objects are not traversed.
 *
 * Every proof must use a DID URL whose DID matches the portable object's
 * authority, and every proof must pass {@link verifyProof}.
 *
 * @param jsonLd The JSON-LD document to verify.
 * @param options Additional options.  See also
 *                {@link VerifyPortableObjectProofOptions}.
 * @returns The detailed portable proof-policy result.
 * @throws {TypeError} If the input is not a single JSON-LD object or has a
 *                     malformed portable ID.
 * @since 2.4.0
 */
export async function verifyPortableObjectProof(
  jsonLd: unknown,
  options: VerifyPortableObjectProofOptions = {},
): Promise<VerifyPortableObjectProofResult> {
  if (
    isJsonLdNode(jsonLd) &&
    typeof jsonLd["@id"] === "string" &&
    !PORTABLE_OBJECT_ID_PATTERN.test(jsonLd["@id"])
  ) {
    return {
      verified: false,
      reason: { type: "notPortableObject" },
    };
  }
  const { root, proofContextLoader } = await expandPortableObjectRoot(
    jsonLd,
    options.contextLoader,
  );
  const id = root["@id"];
  if (
    typeof id !== "string" ||
    !PORTABLE_OBJECT_ID_PATTERN.test(id)
  ) {
    return {
      verified: false,
      reason: { type: "notPortableObject" },
    };
  }
  const objectId = parseIri(id);
  // parseIri() validates the portable ID; this additionally guarantees that
  // its authority is a valid cryptographic origin before any key work begins.
  getFe34Origin(objectId);

  const objectType = classifyFep2277CoreType(root);
  if (
    objectType === "verificationMethod" ||
    objectType === "publicKey" ||
    objectType === "link"
  ) {
    return {
      verified: false,
      reason: { type: "unsupportedObjectType", objectType },
    };
  }

  const proofValues = root[SECURITY_PROOF];
  if (
    proofValues == null || Array.isArray(proofValues) && proofValues.length < 1
  ) {
    return objectType === "collection"
      ? {
        verified: false,
        reason: { type: "unsecuredCollection" },
      }
      : {
        verified: false,
        reason: { type: "missingProof" },
      };
  }
  if (!Array.isArray(proofValues)) {
    return {
      verified: false,
      reason: { type: "invalidProof", proofIndex: 0 },
    };
  }
  const rawProofValues = isJsonLdNode(jsonLd)
    ? await getRawProofValues(jsonLd, proofContextLoader)
    : [];
  const proofs: DataIntegrityProof[] = [];
  for (let proofIndex = 0; proofIndex < proofValues.length; proofIndex++) {
    const proofValue = proofValues[proofIndex];
    if (!hasValidPortableProofShape(proofValue)) {
      return {
        verified: false,
        reason: { type: "invalidProof", proofIndex },
      };
    }
    let proof: DataIntegrityProof;
    try {
      proof = await DataIntegrityProof.fromJsonLd(
        proofValue,
        options,
      );
    } catch {
      return {
        verified: false,
        reason: { type: "invalidProof", proofIndex },
      };
    }
    proofs.push(proof);
  }

  // Validate the whole proof set before resolving any keys.  A later non-DID
  // or cross-authority proof therefore cannot cause unnecessary
  // attacker-controlled document fetches.
  for (let proofIndex = 0; proofIndex < proofs.length; proofIndex++) {
    const verificationMethod = proofs[proofIndex].verificationMethodId;
    if (verificationMethod == null) {
      return {
        verified: false,
        reason: { type: "invalidProof", proofIndex },
      };
    }
    if (verificationMethod.protocol !== "did:") {
      return {
        verified: false,
        reason: {
          type: "unsupportedVerificationMethod",
          proofIndex,
          verificationMethod,
        },
      };
    }
    try {
      getFe34Origin(verificationMethod);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return {
        verified: false,
        reason: {
          type: "unsupportedVerificationMethod",
          proofIndex,
          verificationMethod,
        },
      };
    }
    if (!haveSameFe34Origin(objectId, verificationMethod)) {
      return {
        verified: false,
        reason: {
          type: "verificationMethodMismatch",
          proofIndex,
          objectId,
          verificationMethod,
        },
      };
    }
  }

  const keys: Multikey[] = [];
  const rawProofCandidates = await parseRawProofCandidates(
    jsonLd as Record<string, unknown>,
    rawProofValues,
    options,
    proofContextLoader,
  );
  const rawProofCandidatePool: RawProofCandidatePool = {
    candidates: rawProofCandidates,
    used: new Set(),
  };
  const messageDigestCache: ProofMessageDigestCache = { proofContextLoader };
  for (let proofIndex = 0; proofIndex < proofs.length; proofIndex++) {
    const rawProofCandidate = takeRawProofCandidate(
      rawProofCandidatePool,
      proofs[proofIndex],
    );
    if (rawProofCandidate == null) {
      return {
        verified: false,
        reason: { type: "invalidProof", proofIndex },
      };
    }
    const key = await verifyProofWithMessageDigestCache(
      jsonLd,
      proofs[proofIndex],
      options,
      messageDigestCache,
      rawProofCandidate,
    );
    if (key == null) {
      return {
        verified: false,
        reason: { type: "invalidProof", proofIndex },
      };
    }
    keys.push(key);
  }
  return { verified: true, keys };
}

/**
 * Options for {@link verifyObject}.
 * @since 0.10.0
 */
export interface VerifyObjectOptions extends VerifyProofOptions {
}

/**
 * Verifies the given object.  It will verify all the proofs in the object,
 * and succeed only if all the proofs are valid and all attributions and
 * actors are authenticated by the proofs.
 * @template T The type of the object to verify.
 * @param cls The class of the object to verify.  It must be a subclass of
 *            the {@link Object}.
 * @param jsonLd The JSON-LD object to verify.  It's assumed that the object
 *               is a compacted JSON-LD representation of a `T` with `@context`.
 * @param options Additional options.  See also {@link VerifyObjectOptions}.
 * @returns The object if it's verified, or `null` if it's not.
 * @throws {TypeError} If the object is invalid or unsupported.
 * @since 0.10.0
 */
export async function verifyObject<T extends Object>(
  // deno-lint-ignore no-explicit-any
  cls: (new (...args: any[]) => T) & {
    fromJsonLd(jsonLd: unknown, options: VerifyObjectOptions): Promise<T>;
  },
  jsonLd: unknown,
  options: VerifyObjectOptions = {},
): Promise<T | null> {
  const logger = getLogger(["fedify", "sig", "proof"]);
  const object = await cls.fromJsonLd(jsonLd, options);
  const defaultDocumentLoader = getDocumentLoader();
  const proofContextLoader = options.contextLoader ?? defaultDocumentLoader;
  const attributions = new Set(object.attributionIds.map((uri) => uri.href));
  if (object instanceof Activity) {
    for (const uri of object.actorIds) attributions.add(uri.href);
  }
  const rawProofValues = isJsonLdNode(jsonLd)
    ? await getRawProofValues(
      jsonLd,
      proofContextLoader,
    )
    : [];
  const rawProofCandidates = isJsonLdNode(jsonLd)
    ? await parseRawProofCandidates(
      jsonLd,
      rawProofValues,
      options,
      proofContextLoader,
    )
    : [];
  const rawProofCandidatePool: RawProofCandidatePool = {
    candidates: rawProofCandidates,
    used: new Set(),
  };
  const baseDocumentLoader = options.documentLoader ?? defaultDocumentLoader;
  const hydratedCandidates = new Set<number>();
  const proofDocumentLoader: DocumentLoader = async (
    url,
    loaderOptions,
  ) => {
    const remoteDocument = await baseDocumentLoader(url, loaderOptions);
    const reference = normalizeDocumentUrl(url);
    const candidateIndex = rawProofCandidates.findIndex(
      (candidate, index) =>
        !hydratedCandidates.has(index) &&
        !rawProofCandidatePool.used.has(index) &&
        candidate.reference === reference,
    );
    if (candidateIndex >= 0) {
      hydratedCandidates.add(candidateIndex);
      let parsed: DataIntegrityProof | null = null;
      try {
        parsed = await DataIntegrityProof.fromJsonLd(
          remoteDocument.document,
          {
            documentLoader: baseDocumentLoader,
            contextLoader: proofContextLoader,
            tracerProvider: options.tracerProvider,
            baseUrl: parseIri(remoteDocument.documentUrl),
          },
        );
      } catch {
        // The vocabulary parser will report the same malformed remote proof.
      }
      rawProofCandidates[candidateIndex] = {
        value: structuredClone(remoteDocument.document),
        proof: parsed,
        reference,
      };
    }
    return remoteDocument;
  };
  for await (
    const proof of object.getProofs({
      ...options,
      documentLoader: proofDocumentLoader,
    })
  ) {
    const rawProofCandidate = takeRawProofCandidate(
      rawProofCandidatePool,
      proof,
    );
    if (rawProofCandidate == null) return null;
    const key = await verifyProofWithMessageDigestCache(
      jsonLd,
      proof,
      options,
      {
        proofContextLoader,
      },
      rawProofCandidate,
    );
    if (key === null) return null;
    if (proof.verificationMethodId == null) return null;
    if (key.controllerId == null) {
      logger.debug(
        "Key {keyId} does not have a controller.",
        { keyId: key.id?.href },
      );
      continue;
    }
    deleteAuthenticatedAttribution(
      attributions,
      key.controllerId,
      proof.verificationMethodId,
    );
  }
  if (attributions.size > 0) {
    logger.debug(
      "Some attributions are not authenticated by the proofs: {attributions}.",
      { attributions: [...attributions] },
    );
    return null;
  }
  return object;
}

function deleteAuthenticatedAttribution(
  attributions: Set<string>,
  controllerId: URL,
  verificationMethodId: URL,
): void {
  const controllerHasCryptographicOrigin = hasCryptographicOrigin(
    controllerId.href,
  );
  const verificationMethodMatchesController =
    controllerHasCryptographicOrigin &&
    hasCryptographicOrigin(verificationMethodId.href) &&
    haveSameFe34Origin(controllerId, verificationMethodId);
  if (
    !controllerHasCryptographicOrigin ||
    verificationMethodMatchesController
  ) {
    attributions.delete(controllerId.href);
  }
  if (
    !verificationMethodMatchesController
  ) return;
  for (const attribution of [...attributions]) {
    if (
      hasCryptographicOrigin(attribution) &&
      haveSameFe34Origin(controllerId, attribution)
    ) {
      attributions.delete(attribution);
    }
  }
}

function hasCryptographicOrigin(iri: string): boolean {
  return /^did:/i.test(iri) || /^ap(?:\+ef61)?:\/\//i.test(iri);
}
