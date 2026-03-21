import { CryptographicKey } from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import { getLogger } from "@logtape/logtape";
import {
  type Span,
  SpanStatusCode,
  trace,
  type TracerProvider,
} from "@opentelemetry/api";
import {
  ATTR_HTTP_REQUEST_HEADER,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_URL_FULL,
} from "@opentelemetry/semantic-conventions";
import { decodeBase64, encodeBase64 } from "byte-encodings/base64";
import { encodeHex } from "byte-encodings/hex";
import {
  decodeDict,
  type Dictionary,
  encodeItem,
  Item,
} from "structured-field-values";
import metadata from "../../deno.json" with { type: "json" };
import {
  type AcceptSignatureComponent,
  fulfillAcceptSignature,
  parseAcceptSignature,
  validateAcceptSignature,
} from "./accept.ts";
import {
  fetchKeyDetailed,
  type FetchKeyErrorResult,
  type KeyCache,
  validateCryptoKey,
} from "./key.ts";

/**
 * The standard to use for signing and verifying HTTP signatures.
 * @since 1.6.0
 */
export type HttpMessageSignaturesSpec =
  /**
   * The Signing HTTP Messages (draft-cavage-http-signatures-12) specification,
   * which is widely adopted and used in the fediverse (as of May 2025).
   */
  | "draft-cavage-http-signatures-12"
  /**
   * The HTTP Message Signatures (RFC 9421) specification, which is the
   * finalized standard but not widely adopted yet (as of May 2025).
   */
  | "rfc9421";

/**
 * Options for {@link signRequest}.
 * @since 1.3.0
 */
export interface SignRequestOptions {
  /**
   * The HTTP message signatures specification to use for signing.
   * @default `"draft-cavage-http-signatures-12"`
   * @since 1.6.0
   */
  spec?: HttpMessageSignaturesSpec;

  /**
   * The current time.  If not specified, the current time is used.  This is
   * useful for testing.
   * @since 1.6.0
   */
  currentTime?: Temporal.Instant;

  /**
   * The request body as ArrayBuffer. If provided, avoids cloning the request body.
   * @since 1.7.7
   */
  body?: ArrayBuffer | null;

  /**
   * The OpenTelemetry tracer provider.  If omitted, the global tracer provider
   * is used.
   */
  tracerProvider?: TracerProvider;

  /**
   * Options specific to the RFC 9421 signing path.  These options are
   * ignored when `spec` is `"draft-cavage-http-signatures-12"`.
   * @since 2.1.0
   */
  rfc9421?: Rfc9421SignRequestOptions;
}

/**
 * Options for customizing the RFC 9421 signature label, covered components,
 * and metadata parameters.  These are typically derived from an
 * `Accept-Signature` challenge.
 * @since 2.1.0
 */
export interface Rfc9421SignRequestOptions {
  /**
   * The label for the signature in `Signature-Input` and `Signature` headers.
   * @default `"sig1"`
   */
  label?: string;

  /**
   * The covered component identifiers.  When omitted, the default set
   * `["@method", "@target-uri", "@authority", "host", "date"]`
   * (plus `"content-digest"` when a body is present) is used.
   */
  components?: AcceptSignatureComponent[];

  /**
   * A nonce value to include in the signature parameters.
   */
  nonce?: string;

  /**
   * A tag value to include in the signature parameters.
   */
  tag?: string;

  /**
   * If `true`, an expiration timestamp is generated and included in the
   * signature parameters.  The expiration time defaults to one hour after
   * the signature creation time.
   */
  expires?: true;
}

/**
 * Signs a request using the given private key.
 * @param request The request to sign.
 * @param privateKey The private key to use for signing.
 * @param keyId The key ID to use for the signature.  It will be used by the
 *              verifier.
 * @returns The signed request.
 * @throws {TypeError} If the private key is invalid or unsupported.
 */
export async function signRequest(
  request: Request,
  privateKey: CryptoKey,
  keyId: URL,
  options: SignRequestOptions = {},
): Promise<Request> {
  validateCryptoKey(privateKey, "private");
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(
    metadata.name,
    metadata.version,
  );
  return await tracer.startActiveSpan(
    "http_signatures.sign",
    async (span) => {
      try {
        // Choose implementation based on spec option
        const spec = options.spec ?? "draft-cavage-http-signatures-12";
        let signed: Request;

        if (spec === "rfc9421") {
          // Pass through test options if provided
          signed = await signRequestRfc9421(
            request,
            privateKey,
            keyId,
            span,
            options.currentTime,
            options.body,
            options.rfc9421,
          );
        } else {
          // Default to draft-cavage
          signed = await signRequestDraft(
            request,
            privateKey,
            keyId,
            span,
            options.currentTime,
            options.body,
          );
        }

        if (span.isRecording()) {
          span.setAttribute(ATTR_HTTP_REQUEST_METHOD, signed.method);
          span.setAttribute(ATTR_URL_FULL, signed.url);
          for (const [name, value] of signed.headers) {
            span.setAttribute(ATTR_HTTP_REQUEST_HEADER(name), value);
          }
          span.setAttribute("http_signatures.key_id", keyId.href);
        }
        return signed;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

async function signRequestDraft(
  request: Request,
  privateKey: CryptoKey,
  keyId: URL,
  span: Span,
  currentTime?: Temporal.Instant,
  bodyBuffer?: ArrayBuffer | null,
): Promise<Request> {
  if (privateKey.algorithm.name !== "RSASSA-PKCS1-v1_5") {
    throw new TypeError("Unsupported algorithm: " + privateKey.algorithm.name);
  }
  const url = new URL(request.url);
  const body: ArrayBuffer | null = bodyBuffer !== undefined
    ? bodyBuffer
    : request.method !== "GET" && request.method !== "HEAD"
    ? await request.clone().arrayBuffer()
    : null;
  const headers = new Headers(request.headers);
  if (!headers.has("Host")) {
    headers.set("Host", url.host);
  }
  if (!headers.has("Digest") && body != null) {
    const digest = await crypto.subtle.digest("SHA-256", body);
    headers.set("Digest", `SHA-256=${encodeBase64(digest)}`);
    if (span.isRecording()) {
      span.setAttribute("http_signatures.digest.sha-256", encodeHex(digest));
    }
  }
  if (!headers.has("Date")) {
    headers.set(
      "Date",
      currentTime == null
        ? new Date().toUTCString()
        // FIXME: Do we have any better way to format Temporal.Instant to RFC 9421?
        : new Date(currentTime.toString()).toUTCString(),
    );
  }
  const serialized: [string, string][] = [
    ["(request-target)", `${request.method.toLowerCase()} ${url.pathname}`],
    ...headers,
  ];
  const headerNames: string[] = serialized.map(([name]) => name);
  const message = serialized
    .map(([name, value]) => `${name}: ${value.trim()}`).join("\n");
  // TODO: support other than RSASSA-PKCS1-v1_5:
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(message),
  );
  const sigHeader = `keyId="${keyId.href}",algorithm="rsa-sha256",headers="${
    headerNames.join(" ")
  }",signature="${encodeBase64(signature)}"`;
  headers.set("Signature", sigHeader);
  if (span.isRecording()) {
    span.setAttribute("http_signatures.algorithm", "rsa-sha256");
    span.setAttribute("http_signatures.signature", encodeHex(signature));
  }
  return new Request(request, {
    headers,
    body,
  });
}

export interface Rfc9421SignatureParameters {
  algorithm: string;
  keyId: URL;
  created: number;
  expires?: number;
  nonce?: string;
  tag?: string;
}

export function formatRfc9421SignatureParameters(
  params: Rfc9421SignatureParameters,
): string {
  return Array.from(iterRfc9421(params)).join(";");
}

function* iterRfc9421(params: Rfc9421SignatureParameters): Iterable<string> {
  yield `alg="${params.algorithm}"`;
  yield `keyid="${params.keyId.href}"`;
  yield `created=${params.created}`;
  if (params.expires != null) yield `expires=${params.expires}`;
  if (params.nonce != null) yield `nonce="${escapeSfString(params.nonce)}"`;
  if (params.tag != null) yield `tag="${escapeSfString(params.tag)}"`;
}

const escapeSfString = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function formatComponentId(component: AcceptSignatureComponent): string {
  return encodeItem(new Item(component.value, component.params));
}

/**
 * Creates a signature base for a request according to RFC 9421.
 * @param request The request to create a signature base for.
 * @param components The components to include in the signature base.
 * @param parameters The signature parameters to include in the signature base.
 * @returns The signature base as a string.
 */
export function createRfc9421SignatureBase(
  request: Request,
  components: AcceptSignatureComponent[],
  parameters: string,
): string {
  const url = new URL(request.url);
  // Build the base string
  return components.map((component) => {
    const id = formatComponentId(component);
    const derived = derivedComponents[component.value]?.(request, url);
    if (derived != null) return `${id}: ${derived}`;
    if (component.value.startsWith("@")) {
      throw new Error(`Unsupported derived component: ${component.value}`);
    }
    const header = request.headers.get(component.value);
    if (header == null) {
      throw new Error(`Missing header: ${component.value}`);
    }
    // Format the component as per RFC 9421 Section 2.1
    return `${id}: ${header}`;
  }).concat([
    `"@signature-params": (${
      components.map((c) => formatComponentId(c)).join(" ")
    });${parameters}`,
  ]).join("\n");
}

const derivedComponents: Record<
  string,
  (request: Request, url: URL) => string
> = {
  "@method": (request) => request.method.toUpperCase(),
  "@target-uri": (_, url) => url.href,
  "@authority": (_, url) => url.host,
  "@scheme": (_, url) => url.protocol.slice(0, -1),
  "@request-target": (request, url) =>
    `${request.method.toLowerCase()} ${url.pathname}${url.search}`,
  "@path": (_, url) => url.pathname,
  "@query": (_, { search }) =>
    search.startsWith("?") ? search.slice(1) : search,
  "@query-param": () => {
    throw new Error("@query-param requires a parameter name");
  },
  "@status": () => {
    throw new Error("@status is only valid for responses");
  },
};

/**
 * Formats a signature using rfc9421 format.
 * @param signature The raw signature bytes.
 * @param components The components that were signed.
 * @param parameters The signature parameters.
 * @returns The formatted signature string.
 */
export function formatRfc9421Signature(
  signature: ArrayBuffer | Uint8Array,
  components: AcceptSignatureComponent[],
  parameters: string,
  label = "sig1",
): [string, string] {
  const signatureInputValue = `${label}=(${
    components.map((c) => formatComponentId(c)).join(" ")
  });${parameters}`;
  const signatureValue = `${label}=:${encodeBase64(signature)}:`;
  return [signatureInputValue, signatureValue];
}

/**
 * Parse RFC 9421 Signature-Input header.
 * @param signatureInput The Signature-Input header value.
 * @returns Parsed signature input parameters.
 */
export function parseRfc9421SignatureInput(
  signatureInput: string,
): Record<
  string,
  {
    keyId: string;
    alg?: string;
    created: number;
    nonce?: string;
    tag?: string;
    components: AcceptSignatureComponent[];
    parameters: string;
  }
> {
  let dict: Dictionary;
  try {
    dict = decodeDict(signatureInput);
  } catch (error) {
    getLogger(["fedify", "sig", "http"]).debug(
      "Failed to parse Signature-Input header: {signatureInput}",
      { signatureInput, error },
    );
    return {};
  }
  const result: Record<
    string,
    {
      keyId: string;
      alg?: string;
      created: number;
      nonce?: string;
      tag?: string;
      components: AcceptSignatureComponent[];
      parameters: string;
    }
  > = {};
  for (const [label, item] of Object.entries(dict) as [string, Item][]) {
    if (
      !Array.isArray(item.value) ||
      typeof item.params.keyid !== "string" ||
      typeof item.params.created !== "number"
    ) continue;
    const components: AcceptSignatureComponent[] = item.value
      .filter((subitem: Item) => typeof subitem.value === "string")
      .map((subitem: Item) => ({
        value: subitem.value as string,
        params: subitem.params ?? {},
      }));
    const params = encodeItem(new Item(0, item.params));
    result[label] = {
      keyId: item.params.keyid,
      alg: item.params.alg,
      created: item.params.created,
      nonce: typeof item.params.nonce === "string"
        ? item.params.nonce
        : undefined,
      tag: typeof item.params.tag === "string" ? item.params.tag : undefined,
      components,
      parameters: params.slice(params.indexOf(";") + 1),
    };
  }
  return result;
}

/**
 * Parse RFC 9421 Signature header.
 * @param signature The Signature header value.
 * @returns Parsed signature values.
 */
export function parseRfc9421Signature(
  signature: string,
): Record<string, Uint8Array> {
  let dict: Dictionary;
  try {
    dict = decodeDict(signature);
  } catch (error) {
    getLogger(["fedify", "sig", "http"]).debug(
      "Failed to parse Signature header: {signature}",
      { signature, error },
    );
    return {};
  }

  const result: Record<string, Uint8Array> = {};
  for (const [key, value] of Object.entries(dict) as [string, Item][]) {
    if (value.value instanceof Uint8Array) {
      result[key] = value.value;
    }
  }
  return result;
}

async function signRequestRfc9421(
  request: Request,
  privateKey: CryptoKey,
  keyId: URL,
  span: Span,
  currentTime?: Temporal.Instant,
  bodyBuffer?: ArrayBuffer | null,
  rfc9421Options?: Rfc9421SignRequestOptions,
): Promise<Request> {
  if (privateKey.algorithm.name !== "RSASSA-PKCS1-v1_5") {
    throw new TypeError("Unsupported algorithm: " + privateKey.algorithm.name);
  }

  const url = new URL(request.url);
  const body: ArrayBuffer | null = bodyBuffer !== undefined
    ? bodyBuffer
    : request.method !== "GET" && request.method !== "HEAD"
    ? await request.clone().arrayBuffer()
    : null;

  const headers = new Headers(request.headers);
  if (!headers.has("Host")) {
    headers.set("Host", url.host);
  }

  if (!headers.has("Content-Digest") && body != null) {
    // RFC 9421 uses Content-Digest instead of Digest
    const digest = await crypto.subtle.digest("SHA-256", body);
    headers.set("Content-Digest", `sha-256=:${encodeBase64(digest)}:`);
    if (span.isRecording()) {
      span.setAttribute("http_signatures.digest.sha-256", encodeHex(digest));
    }
  }

  // Use provided timestamp or current time
  currentTime ??= Temporal.Now.instant();
  const created = (currentTime.epochMilliseconds / 1000) | 0; // Convert to seconds and truncate to integer

  if (!headers.has("Date")) {
    headers.set("Date", new Date(currentTime.toString()).toUTCString());
  }

  // Define components to include in the signature
  const label = rfc9421Options?.label ?? "sig1";
  const components: AcceptSignatureComponent[] = [
    ...(rfc9421Options?.components ?? [
      { value: "@method", params: {} },
      { value: "@target-uri", params: {} },
      { value: "@authority", params: {} },
      { value: "host", params: {} },
      { value: "date", params: {} },
    ]),
    ...(body != null ? [{ value: "content-digest", params: {} }] : []),
  ];

  // Generate the signature base using the headers
  const expires = rfc9421Options?.expires === true
    ? ((currentTime.epochMilliseconds / 1000) | 0) + 3600
    : undefined;
  const signatureParams = formatRfc9421SignatureParameters({
    algorithm: "rsa-v1_5-sha256",
    keyId,
    created,
    expires,
    nonce: rfc9421Options?.nonce,
    tag: rfc9421Options?.tag,
  });
  let signatureBase: string;
  try {
    signatureBase = createRfc9421SignatureBase(
      new Request(request.url, {
        method: request.method,
        headers,
      }),
      components,
      signatureParams,
    );
  } catch (error) {
    throw new TypeError(
      `Failed to create signature base: ${String(error)}; it is probably ` +
        `a bug in the implementation.  Please report it at Fedify's issue tracker.`,
    );
  }

  // Sign the signature base
  const signatureBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signatureBase),
  );

  // Format the signature according to RFC 9421
  const [signatureInput, signature] = formatRfc9421Signature(
    signatureBytes,
    components,
    signatureParams,
    label,
  );

  // Add (or append to) the signature headers.
  // Both Signature-Input and Signature are RFC 8941 Dictionary Structured
  // Fields, so multiple labeled members are comma-separated.  Appending
  // instead of overwriting lets callers accumulate signatures for different
  // labels by calling signRequest() sequentially on the same request.
  const existingInput = headers.get("Signature-Input");
  headers.set(
    "Signature-Input",
    existingInput != null
      ? `${existingInput}, ${signatureInput}`
      : signatureInput,
  );
  const existingSignature = headers.get("Signature");
  headers.set(
    "Signature",
    existingSignature != null
      ? `${existingSignature}, ${signature}`
      : signature,
  );

  if (span.isRecording()) {
    span.setAttribute("http_signatures.algorithm", "rsa-v1_5-sha256");
    span.setAttribute("http_signatures.signature", encodeHex(signatureBytes));
    span.setAttribute("http_signatures.created", created.toString());
  }

  return new Request(request, { headers, body });
}

const supportedHashAlgorithms: Record<string, string> = {
  "sha": "SHA-1",
  "sha-256": "SHA-256",
  "sha-512": "SHA-512",
};

/**
 * Options for {@link verifyRequest}.
 */
export interface VerifyRequestOptions {
  /**
   * The document loader to use for fetching the public key.
   */
  documentLoader?: DocumentLoader;

  /**
   * The context loader to use for JSON-LD context retrieval.
   */
  contextLoader?: DocumentLoader;

  /**
   * The time window to allow for the request date.  The actual time window is
   * twice the value of this option, with the current time as the center.
   * Or if it is `false`, no time check is performed.
   *
   * An hour by default.
   */
  timeWindow?: Temporal.Duration | Temporal.DurationLike | false;

  /**
   * The current time.  If not specified, the current time is used.  This is
   * useful for testing.
   */
  currentTime?: Temporal.Instant;

  /**
   * The key cache to use for caching public keys.
   * @since 0.12.0
   */
  keyCache?: KeyCache;

  /**
   * The HTTP message signatures specification to use for verifying.
   * @default `"draft-cavage-http-signatures-12"`
   * @since 1.6.0
   */
  spec?: HttpMessageSignaturesSpec;

  /**
   * The OpenTelemetry tracer provider.  If omitted, the global tracer provider
   * is used.
   * @since 1.3.0
   */
  tracerProvider?: TracerProvider;
}

/**
 * The reason why {@link verifyRequestDetailed} could not verify a request.
 * @since 2.1.0
 */
export type VerifyRequestFailureReason =
  | {
    readonly type: "keyFetchError";
    readonly keyId: URL;
    readonly result: FetchKeyErrorResult;
  }
  | {
    readonly type: "invalidSignature";
    readonly keyId?: URL;
  }
  | {
    readonly type: "noSignature";
  };

/**
 * The detailed result of {@link verifyRequestDetailed}.
 * @since 2.1.0
 */
export type VerifyRequestDetailedResult =
  | {
    readonly verified: true;
    readonly key: CryptographicKey;
    readonly signatureLabel?: string;
  }
  | {
    readonly verified: false;
    readonly reason: VerifyRequestFailureReason;
  };

function noSignatureResult(): VerifyRequestDetailedResult {
  return {
    verified: false,
    reason: { type: "noSignature" },
  };
}

function invalidSignatureResult(
  keyId: URL | null,
): VerifyRequestDetailedResult {
  return keyId == null
    ? {
      verified: false,
      reason: { type: "invalidSignature" },
    }
    : {
      verified: false,
      reason: { type: "invalidSignature", keyId },
    };
}

function keyFetchErrorResult(
  keyId: URL,
  result: FetchKeyErrorResult,
): VerifyRequestDetailedResult {
  return {
    verified: false,
    reason: { type: "keyFetchError", keyId, result },
  };
}

function parseKeyId(value: string | undefined): URL | null {
  if (value == null) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function getKeyFetchErrorName(error: Error): string {
  return error.name || error.constructor.name || "Error";
}

function recordVerificationResult(
  span: Span,
  result: VerifyRequestDetailedResult,
): void {
  span.setAttribute("http_signatures.verified", result.verified);
  if (result.verified === true) return;
  const reason = result.reason;
  span.setAttribute("http_signatures.failure_reason", reason.type);
  if ("keyId" in reason && reason.keyId != null) {
    span.setAttribute("http_signatures.key_id", reason.keyId.href);
  }
  if (reason.type !== "keyFetchError") return;
  if ("status" in reason.result) {
    span.setAttribute(
      "http_signatures.key_fetch_status",
      reason.result.status,
    );
  } else {
    span.setAttribute(
      "http_signatures.key_fetch_error",
      getKeyFetchErrorName(reason.result.error),
    );
  }
}

/**
 * Verifies the signature of a request.
 *
 * Note that this function consumes the request body, so it should not be used
 * if the request body is already consumed.  Consuming the request body after
 * calling this function is okay, since this function clones the request
 * under the hood.
 *
 * @param request The request to verify.
 * @param options Options for verifying the request.
 * @returns The public key of the verified signature, or `null` if the signature
 *          could not be verified.
 */
export async function verifyRequest(
  request: Request,
  options: VerifyRequestOptions = {},
): Promise<CryptographicKey | null> {
  const result = await verifyRequestDetailed(request, options);
  return result.verified ? result.key : null;
}

/**
 * Verifies the signature of a request and returns a structured failure reason
 * when verification does not succeed.
 *
 * @param request The request to verify.
 * @param options Options for verifying the request.
 * @returns The verified public key, or a structured verification failure.
 * @since 2.1.0
 */
export async function verifyRequestDetailed(
  request: Request,
  options: VerifyRequestOptions = {},
): Promise<VerifyRequestDetailedResult> {
  const tracerProvider = options.tracerProvider ?? trace.getTracerProvider();
  const tracer = tracerProvider.getTracer(
    metadata.name,
    metadata.version,
  );
  return await tracer.startActiveSpan(
    "http_signatures.verify",
    async (span) => {
      if (span.isRecording()) {
        span.setAttribute(ATTR_HTTP_REQUEST_METHOD, request.method);
        span.setAttribute(ATTR_URL_FULL, request.url);
        for (const [name, value] of request.headers) {
          span.setAttribute(ATTR_HTTP_REQUEST_HEADER(name), value);
        }
      }
      try {
        // Choose implementation based on spec option
        let spec = options.spec;
        if (spec == null) {
          spec = request.headers.has("Signature-Input")
            ? "rfc9421"
            : "draft-cavage-http-signatures-12";
        }

        let result: VerifyRequestDetailedResult;
        if (spec === "rfc9421") {
          result = await verifyRequestRfc9421(request, span, options);
        } else {
          result = await verifyRequestDraft(request, span, options);
        }

        recordVerificationResult(span, result);
        if (!result.verified) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

async function verifyRequestDraft(
  request: Request,
  span: Span,
  {
    documentLoader,
    contextLoader,
    timeWindow,
    currentTime,
    keyCache,
    tracerProvider,
  }: VerifyRequestOptions = {},
): Promise<VerifyRequestDetailedResult> {
  const logger = getLogger(["fedify", "sig", "http"]);
  if (request.bodyUsed) {
    logger.error(
      "Failed to verify; the request body is already consumed.",
      { url: request.url },
    );
    return noSignatureResult();
  } else if (request.body?.locked) {
    logger.error(
      "Failed to verify; the request body is locked.",
      { url: request.url },
    );
    return noSignatureResult();
  }
  const originalRequest = request;
  request = request.clone() as Request;
  const sigHeader = request.headers.get("Signature");
  if (sigHeader == null) {
    logger.debug(
      "Failed to verify; no Signature header found.",
      { headers: Object.fromEntries(request.headers.entries()) },
    );
    return noSignatureResult();
  }
  const sigValues = Object.fromEntries(
    sigHeader.split(",").map((pair) =>
      pair.match(/^\s*([A-Za-z]+)=(?:"([^"]*)"|(\d+))\s*$/)
    ).filter((m) => m != null).map((m) =>
      [m![1], m![2] ?? m![3]] as [string, string]
    ),
  );
  const parsedKeyId = parseKeyId(sigValues.keyId);
  const dateHeader = request.headers.get("Date");
  if (dateHeader == null) {
    logger.debug(
      "Failed to verify; no Date header found.",
      { headers: Object.fromEntries(request.headers.entries()) },
    );
    return invalidSignatureResult(parsedKeyId);
  }
  const digestHeader = request.headers.get("Digest");
  if (
    request.method !== "GET" && request.method !== "HEAD" &&
    digestHeader == null
  ) {
    logger.debug(
      "Failed to verify; no Digest header found.",
      { headers: Object.fromEntries(request.headers.entries()) },
    );
    return invalidSignatureResult(parsedKeyId);
  }
  let body: ArrayBuffer | null = null;
  if (digestHeader != null) {
    body = await request.arrayBuffer();
    const digests = digestHeader.split(",").map((pair) =>
      pair.includes("=") ? pair.split("=", 2) as [string, string] : [pair, ""]
    );
    let matched = false;
    for (let [algo, digestBase64] of digests) {
      algo = algo.trim().toLowerCase();
      if (!(algo in supportedHashAlgorithms)) continue;
      let digest: Uint8Array;
      try {
        digest = decodeBase64(digestBase64);
      } catch (error) {
        logger.debug("Failed to verify; invalid base64 encoding: {digest}.", {
          digest: digestBase64,
          error,
        });
        return invalidSignatureResult(parsedKeyId);
      }
      if (span.isRecording()) {
        span.setAttribute(`http_signatures.digest.${algo}`, encodeHex(digest));
      }
      const expectedDigest = await crypto.subtle.digest(
        supportedHashAlgorithms[algo],
        body,
      );
      if (!timingSafeEqual(digest, new Uint8Array(expectedDigest))) {
        logger.debug(
          "Failed to verify; digest mismatch ({algorithm}): " +
            "{digest} != {expectedDigest}.",
          {
            algorithm: algo,
            digest: digestBase64,
            expectedDigest: encodeBase64(expectedDigest),
          },
        );
        return invalidSignatureResult(parsedKeyId);
      }
      matched = true;
    }
    if (!matched) {
      logger.debug(
        "Failed to verify; no supported digest algorithm found.  " +
          "Supported: {supportedAlgorithms}; found: {algorithms}.",
        {
          supportedAlgorithms: Object.keys(supportedHashAlgorithms),
          algorithms: digests.map(([algo]) => algo),
        },
      );
      return invalidSignatureResult(parsedKeyId);
    }
  }
  const date = Temporal.Instant.from(new Date(dateHeader).toISOString());
  const now = currentTime ?? Temporal.Now.instant();
  if (timeWindow !== false) {
    const tw: Temporal.Duration | Temporal.DurationLike = timeWindow ??
      { hours: 1 };
    if (Temporal.Instant.compare(date, now.add(tw)) > 0) {
      logger.debug(
        "Failed to verify; Date is too far in the future.",
        { date: date.toString(), now: now.toString() },
      );
      return invalidSignatureResult(parsedKeyId);
    } else if (Temporal.Instant.compare(date, now.subtract(tw)) < 0) {
      logger.debug(
        "Failed to verify; Date is too far in the past.",
        { date: date.toString(), now: now.toString() },
      );
      return invalidSignatureResult(parsedKeyId);
    }
  }
  if (!("keyId" in sigValues)) {
    logger.debug(
      "Failed to verify; no keyId field found in the Signature header.",
      { signature: sigHeader },
    );
    return invalidSignatureResult(null);
  } else if (!("headers" in sigValues)) {
    logger.debug(
      "Failed to verify; no headers field found in the Signature header.",
      { signature: sigHeader },
    );
    return invalidSignatureResult(parsedKeyId);
  } else if (!("signature" in sigValues)) {
    logger.debug(
      "Failed to verify; no signature field found in the Signature header.",
      { signature: sigHeader },
    );
    return invalidSignatureResult(parsedKeyId);
  }
  if ("expires" in sigValues) {
    const expiresSeconds = parseInt(sigValues.expires);
    if (!Number.isInteger(expiresSeconds)) {
      logger.debug(
        "Failed to verify; invalid expires field in the Signature header: {expires}.",
        { expires: sigValues.expires, signature: sigHeader },
      );
      return invalidSignatureResult(parsedKeyId);
    }
    const expires = Temporal.Instant.fromEpochMilliseconds(
      expiresSeconds * 1000,
    );
    if (Temporal.Instant.compare(now, expires) > 0) {
      logger.debug(
        "Failed to verify; signature expired at {expires} (now: {now}).",
        {
          expires: expires.toString(),
          now: now.toString(),
          signature: sigHeader,
        },
      );
      return invalidSignatureResult(parsedKeyId);
    }
  }
  if ("created" in sigValues) {
    const createdSeconds = parseInt(sigValues.created);
    if (!Number.isInteger(createdSeconds)) {
      logger.debug(
        "Failed to verify; invalid created field in the Signature header: {created}.",
        { created: sigValues.created, signature: sigHeader },
      );
      return invalidSignatureResult(parsedKeyId);
    }
    if (timeWindow !== false) {
      const created = Temporal.Instant.fromEpochMilliseconds(
        createdSeconds * 1000,
      );
      const tw: Temporal.DurationLike = timeWindow ?? { minutes: 1 };
      if (Temporal.Instant.compare(created, now.add(tw)) > 0) {
        logger.debug(
          "Failed to verify; created is too far in the future.",
          { created: created.toString(), now: now.toString() },
        );
        return invalidSignatureResult(parsedKeyId);
      } else if (Temporal.Instant.compare(created, now.subtract(tw)) < 0) {
        logger.debug(
          "Failed to verify; created is too far in the past.",
          { created: created.toString(), now: now.toString() },
        );
        return invalidSignatureResult(parsedKeyId);
      }
    }
  }
  const { keyId, headers, signature } = sigValues;
  const keyIdUrl = parseKeyId(keyId);
  if (keyIdUrl == null) return invalidSignatureResult(null);
  span?.setAttribute("http_signatures.key_id", keyId);
  if ("algorithm" in sigValues) {
    span?.setAttribute("http_signatures.algorithm", sigValues.algorithm);
  }
  const { key, cached, fetchError } = await fetchKeyDetailed(
    keyIdUrl,
    CryptographicKey,
    {
      documentLoader,
      contextLoader,
      keyCache,
      tracerProvider,
    },
  );
  if (fetchError != null) {
    return keyFetchErrorResult(keyIdUrl, fetchError);
  }
  if (key == null) return invalidSignatureResult(keyIdUrl);
  const headerNames = headers.split(/\s+/g);
  if (
    !headerNames.includes("(request-target)") || !headerNames.includes("date")
  ) {
    logger.debug(
      "Failed to verify; required headers missing in the Signature header: " +
        "{headers}.",
      { headers },
    );
    return invalidSignatureResult(keyIdUrl);
  }
  if (body != null && !headerNames.includes("digest")) {
    logger.debug(
      "Failed to verify; required headers missing in the Signature header: " +
        "{headers}.",
      { headers },
    );
    return invalidSignatureResult(keyIdUrl);
  }
  const message = headerNames.map((name) =>
    `${name}: ` +
    (name === "(request-target)"
      ? `${request.method.toLowerCase()} ${new URL(request.url).pathname}`
      : name === "(created)"
      ? (sigValues.created ?? "")
      : name === "(expires)"
      ? (sigValues.expires ?? "")
      : name === "host"
      ? request.headers.get("host") ?? new URL(request.url).host
      : request.headers.get(name))
  ).join("\n");
  const sig = decodeBase64(signature);
  span?.setAttribute("http_signatures.signature", encodeHex(sig));
  // TODO: support other than RSASSA-PKCS1-v1_5:
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key.publicKey,
    sig,
    new TextEncoder().encode(message),
  );
  if (!verified) {
    if (cached) {
      logger.debug(
        "Failed to verify with the cached key {keyId}; signature {signature} " +
          "is invalid.  Retrying with the freshly fetched key...",
        { keyId, signature, message },
      );
      return await verifyRequestDetailed(
        originalRequest,
        {
          documentLoader,
          contextLoader,
          timeWindow,
          currentTime,
          keyCache: {
            get: () => Promise.resolve(undefined),
            set: async (keyId, key) => await keyCache?.set(keyId, key),
          },
        },
      );
    }
    logger.debug(
      "Failed to verify with the fetched key {keyId}; signature {signature} " +
        "is invalid.  Check if the key is correct or if the signed message " +
        "is correct.  The message to sign is:\n{message}",
      { keyId, signature, message },
    );
    return invalidSignatureResult(keyIdUrl);
  }
  return { verified: true, key };
}

/**
 * RFC 9421 map of algorithm identifiers to WebCrypto algorithms
 */
const rfc9421AlgorithmMap: Record<
  string,
  AlgorithmIdentifier | RsaPssParams | EcdsaParams
> = {
  "rsa-v1_5-sha256": { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  "rsa-v1_5-sha512": { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
  "rsa-pss-sha512": { name: "RSA-PSS", hash: "SHA-512" },
  "ecdsa-p256-sha256": { name: "ECDSA", hash: "SHA-256" },
  "ecdsa-p384-sha384": { name: "ECDSA", hash: "SHA-384" },
  "ed25519": { name: "Ed25519" },
};

/**
 * Verifies a Content-Digest header according to RFC 9421.
 * @param digestHeader The Content-Digest header value.
 * @param body The message body to verify against.
 * @returns Whether the digest is valid.
 */
async function verifyRfc9421ContentDigest(
  digestHeader: string,
  body: ArrayBuffer,
): Promise<boolean> {
  const digests = digestHeader.split(",").map((pair) => {
    pair = pair.trim();
    const pos = pair.indexOf("=");
    const algo = pos < 0 ? pair : pair.slice(0, pos);
    const value = pos < 0 ? "" : pair.slice(pos + 1);
    return { algo: algo.trim().toLowerCase(), value: value.trim() };
  });

  for (const { algo, value } of digests) {
    // Extract hash algorithm
    let hashAlgo: string;
    if (algo === "sha-256") {
      hashAlgo = "SHA-256";
    } else if (algo === "sha-512") {
      hashAlgo = "SHA-512";
    } else {
      // Unsupported algorithm
      continue;
    }

    // Process RFC 9421 format: sha-256=:base64value:
    const base64Match = value.match(/^:([^:]+):$/);
    if (!base64Match) continue;

    let digest: Uint8Array;
    try {
      digest = decodeBase64(base64Match[1]);
    } catch {
      // Invalid base64 encoding
      continue;
    }

    // Calculate and compare digests
    const calculatedDigest = await crypto.subtle.digest(hashAlgo, body);
    if (timingSafeEqual(digest, new Uint8Array(calculatedDigest))) {
      return true;
    }
  }

  return false;
}

async function verifyRequestRfc9421(
  request: Request,
  span: Span,
  {
    documentLoader,
    contextLoader,
    timeWindow,
    currentTime,
    keyCache,
    tracerProvider,
  }: VerifyRequestOptions = {},
): Promise<VerifyRequestDetailedResult> {
  const logger = getLogger(["fedify", "sig", "http"]);
  if (request.bodyUsed) {
    logger.error(
      "Failed to verify; the request body is already consumed.",
      { url: request.url },
    );
    return noSignatureResult();
  } else if (request.body?.locked) {
    logger.error(
      "Failed to verify; the request body is locked.",
      { url: request.url },
    );
    return noSignatureResult();
  }

  const originalRequest = request;
  request = request.clone() as Request;

  // Check for required headers
  const signatureInputHeader = request.headers.get("Signature-Input");
  if (!signatureInputHeader) {
    logger.debug(
      "Failed to verify; no Signature-Input header found.",
      { headers: Object.fromEntries(request.headers.entries()) },
    );
    return noSignatureResult();
  }

  const signatureHeader = request.headers.get("Signature");
  if (!signatureHeader) {
    logger.debug(
      "Failed to verify; no Signature header found.",
      { headers: Object.fromEntries(request.headers.entries()) },
    );
    return noSignatureResult();
  }

  // Parse the Signature-Input and Signature headers
  const signatureInputs = parseRfc9421SignatureInput(signatureInputHeader);
  logger.debug(
    "Parsed Signature-Input header: {signatureInputs}",
    { signatureInputs },
  );
  const signatures = parseRfc9421Signature(signatureHeader);

  // Check if we have at least one signature to verify
  const signatureNames = Object.keys(signatureInputs);
  if (signatureNames.length === 0) {
    logger.debug(
      "Failed to verify; no valid signatures found in Signature-Input header.",
      { header: signatureInputHeader },
    );
    return invalidSignatureResult(null);
  }

  let failure: VerifyRequestDetailedResult = noSignatureResult();

  for (const sigName of signatureNames) {
    // Skip if we don't have the signature bytes
    if (!signatures[sigName]) {
      failure = invalidSignatureResult(
        parseKeyId(signatureInputs[sigName]?.keyId),
      );
      continue;
    }

    const sigInput = signatureInputs[sigName];
    const sigBytes = signatures[sigName];
    const keyId = parseKeyId(sigInput.keyId);

    // Validate signature input parameters
    if (!sigInput.keyId) {
      logger.debug(
        "Failed to verify; missing keyId in signature {signatureName}.",
        { signatureName: sigName, signatureInput: signatureInputHeader },
      );
      failure = invalidSignatureResult(null);
      continue;
    }

    if (!sigInput.created) {
      logger.debug(
        "Failed to verify; missing created timestamp in signature {signatureName}.",
        { signatureName: sigName, signatureInput: signatureInputHeader },
      );
      failure = invalidSignatureResult(keyId);
      continue;
    }

    // Check timestamp validity
    const signatureCreated = Temporal.Instant.fromEpochMilliseconds(
      sigInput.created * 1000,
    );
    const now = currentTime ?? Temporal.Now.instant();

    if (timeWindow !== false) {
      const tw: Temporal.Duration | Temporal.DurationLike = timeWindow ??
        { hours: 1 };
      if (Temporal.Instant.compare(signatureCreated, now.add(tw)) > 0) {
        logger.debug(
          "Failed to verify; signature created time is too far in the future.",
          { created: signatureCreated.toString(), now: now.toString() },
        );
        failure = invalidSignatureResult(keyId);
        continue;
      } else if (
        Temporal.Instant.compare(signatureCreated, now.subtract(tw)) < 0
      ) {
        logger.debug(
          "Failed to verify; signature created time is too far in the past.",
          { created: signatureCreated.toString(), now: now.toString() },
        );
        failure = invalidSignatureResult(keyId);
        continue;
      }
    }

    // Verify Content-Digest if present and required
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      sigInput.components.some((c) => c.value === "content-digest")
    ) {
      const contentDigestHeader = request.headers.get("Content-Digest");
      if (!contentDigestHeader) {
        logger.debug(
          "Failed to verify; Content-Digest header required but not found.",
          { components: sigInput.components },
        );
        failure = invalidSignatureResult(keyId);
        continue;
      }

      const body = await request.arrayBuffer();
      const digestValid = await verifyRfc9421ContentDigest(
        contentDigestHeader,
        body,
      );

      if (!digestValid) {
        logger.debug(
          "Failed to verify; Content-Digest verification failed.",
          { contentDigest: contentDigestHeader },
        );
        failure = invalidSignatureResult(keyId);
        continue;
      }
    }

    // Fetch the public key
    span?.setAttribute("http_signatures.key_id", sigInput.keyId);
    span?.setAttribute("http_signatures.created", sigInput.created.toString());
    if (keyId == null) {
      failure = invalidSignatureResult(null);
      continue;
    }

    const { key, cached, fetchError } = await fetchKeyDetailed(
      keyId,
      CryptographicKey,
      {
        documentLoader,
        contextLoader,
        keyCache,
        tracerProvider,
      },
    );

    if (fetchError != null) {
      failure = keyFetchErrorResult(keyId, fetchError);
      continue;
    }
    if (!key) {
      logger.debug("Failed to fetch key: {keyId}", { keyId: sigInput.keyId });
      failure = invalidSignatureResult(keyId);
      continue;
    }

    // Map algorithm name to WebCrypto algorithm
    let alg = sigInput.alg?.toLowerCase();
    if (alg == null) {
      if (key.publicKey.algorithm.name === "RSASSA-PKCS1-v1_5") {
        alg = "hash" in key.publicKey.algorithm
          ? (key.publicKey.algorithm.hash === "SHA-512"
            ? "rsa-v1_5-sha512"
            : "rsa-v1_5-sha256")
          : "rsa-v1_5-sha256";
      } else if (key.publicKey.algorithm.name === "RSA-PSS") {
        alg = "rsa-pss-sha512";
      } else if (key.publicKey.algorithm.name === "ECDSA") {
        alg = "namedCurve" in key.publicKey.algorithm &&
            key.publicKey.algorithm.namedCurve === "P-256"
          ? "ecdsa-p256-sha256"
          : "ecdsa-p384-sha384";
      } else if (key.publicKey.algorithm.name === "Ed25519") {
        alg = "ed25519";
      }
    }
    if (alg) span?.setAttribute("http_signatures.algorithm", alg);
    const algorithm = alg && rfc9421AlgorithmMap[alg];
    if (!algorithm) {
      logger.debug(
        "Failed to verify; unsupported algorithm: {algorithm}",
        {
          algorithm: sigInput.alg,
          supported: Object.keys(rfc9421AlgorithmMap),
        },
      );
      failure = invalidSignatureResult(keyId);
      continue;
    }

    // Rebuild the signature base for verification
    let signatureBase: string;
    try {
      signatureBase = createRfc9421SignatureBase(
        request,
        sigInput.components,
        sigInput.parameters,
      );
    } catch (error) {
      logger.debug(
        "Failed to create signature base for verification: {error}",
        { error, signatureInput: sigInput },
      );
      failure = invalidSignatureResult(keyId);
      continue;
    }
    const signatureBaseBytes = new TextEncoder().encode(signatureBase);

    // Verify the signature
    span?.setAttribute("http_signatures.signature", encodeHex(sigBytes));

    try {
      const verified = await crypto.subtle.verify(
        algorithm,
        key.publicKey,
        sigBytes.slice(),
        signatureBaseBytes,
      );

      if (verified) {
        return { verified: true, key, signatureLabel: sigName };
      } else if (cached) {
        // If we used a cached key and verification failed, try fetching fresh key
        logger.debug(
          "Failed to verify with cached key {keyId}; retrying with fresh key...",
          { keyId: sigInput.keyId },
        );

        return await verifyRequestDetailed(
          originalRequest,
          {
            documentLoader,
            contextLoader,
            timeWindow,
            currentTime,
            keyCache: {
              get: () => Promise.resolve(undefined),
              set: async (keyId, key) => await keyCache?.set(keyId, key),
            },
            spec: "rfc9421",
          },
        );
      } else {
        logger.debug(
          "Failed to verify signature with fetched key {keyId}; signature invalid.",
          { keyId: sigInput.keyId, signatureBase },
        );
        failure = invalidSignatureResult(keyId);
      }
    } catch (error) {
      logger.debug(
        "Error during signature verification: {error}",
        { error, keyId: sigInput.keyId, algorithm: sigInput.alg },
      );
      failure = invalidSignatureResult(keyId);
    }
  }

  return failure;
}

/**
 * A spec determiner for HTTP Message Signatures.
 * It determines the spec to use for signing requests.
 * It is used for double-knocking
 * (see <https://swicg.github.io/activitypub-http-signature/#how-to-upgrade-supported-versions>).
 * @since 1.6.0
 */
export interface HttpMessageSignaturesSpecDeterminer {
  /**
   * Determines the spec to use for signing requests.
   * @param origin The origin of the URL to make the request to.
   * @returns The spec to use for signing requests.
   */
  determineSpec(
    origin: string,
  ): HttpMessageSignaturesSpec | Promise<HttpMessageSignaturesSpec>;

  /**
   * Remembers the successfully used spec for the given origin.
   * @param origin The origin of the URL that was requested.
   * @param spec The spec to remember.
   */
  rememberSpec(
    origin: string,
    spec: HttpMessageSignaturesSpec,
  ): void | Promise<void>;
}

/**
 * The options for double-knock requests.
 * @since 1.6.0
 */
export interface DoubleKnockOptions {
  /**
   * The spec determiner to use for signing requests with double-knocking.
   */
  specDeterminer?: HttpMessageSignaturesSpecDeterminer;

  /**
   * The logging function to use for logging the request.
   * @param request The request to log.
   */
  log?: (request: Request) => void;

  /**
   * The request body as ArrayBuffer. If provided, avoids cloning the request body.
   * @since 1.7.7
   */
  body?: ArrayBuffer | null;

  /**
   * The OpenTelemetry tracer provider.  If omitted, the global tracer provider
   * is used.
   */
  tracerProvider?: TracerProvider;

  /**
   * An `AbortSignal` for cancellation.
   * @since 1.8.0
   */
  signal?: AbortSignal;
}

/**
 * Helper function to create a new Request for redirect handling.
 * @param request The original request.
 * @param location The redirect location.
 * @param body The request body as ArrayBuffer or null.
 * @returns A new Request object for the redirect.
 */
function createRedirectRequest(
  request: Request,
  location: string,
  body: ArrayBuffer | null,
): Request {
  const url = new URL(location, request.url);
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body,
    redirect: "manual",
    signal: request.signal,
    mode: request.mode,
    credentials: request.credentials,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
    cache: request.cache,
  });
}

/**
 * Performs a double-knock request to the given URL.  For the details of
 * double-knocking, see
 * <https://swicg.github.io/activitypub-http-signature/#how-to-upgrade-supported-versions>.
 * @param request The request to send.
 * @param identity The identity to use for signing the request.
 * @param options The options for double-knock requests.
 * @returns The response to the request.
 * @since 1.6.0
 */
export async function doubleKnock(
  request: Request,
  identity: { keyId: URL; privateKey: CryptoKey },
  options: DoubleKnockOptions = {},
): Promise<Response> {
  const { specDeterminer, log, tracerProvider, signal } = options;
  const origin = new URL(request.url).origin;
  const firstTrySpec: HttpMessageSignaturesSpec = specDeterminer == null
    ? "rfc9421"
    : await specDeterminer.determineSpec(origin);

  // Get the request body once at the top level to avoid multiple clones
  const body = options.body !== undefined
    ? options.body
    : request.method !== "GET" && request.method !== "HEAD"
    ? await request.clone().arrayBuffer()
    : null;

  let signedRequest = await signRequest(
    request,
    identity.privateKey,
    identity.keyId,
    { spec: firstTrySpec, tracerProvider, body },
  );
  log?.(signedRequest);
  let response = await fetch(signedRequest, {
    // Since Bun has a bug that ignores the `Request.redirect` option,
    // to work around it we specify `redirect: "manual"` here too:
    // https://github.com/oven-sh/bun/issues/10754
    redirect: "manual",
    signal,
  });
  // Follow redirects manually to get the final URL:
  if (
    response.status >= 300 && response.status < 400 &&
    response.headers.has("Location")
  ) {
    const location = response.headers.get("Location")!;
    return doubleKnock(
      createRedirectRequest(request, location, body),
      identity,
      { ...options, body },
    );
  } else if (
    // FIXME: Temporary hotfix for Mastodon RFC 9421 implementation bug (as of 2025-06-19).
    // Some Mastodon servers (including mastodon.social) are running bleeding edge versions
    // with RFC 9421 support that have a bug causing 500 Internal Server Error when receiving
    // RFC 9421 signatures. This extends double-knocking to 5xx errors as a workaround,
    // allowing fallback to draft-cavage signatures. This should be reverted once Mastodon
    // fixes their RFC 9421 implementation and affected servers are updated.
    response.status === 400 || response.status === 401 || response.status > 401
  ) {
    const logger = getLogger(["fedify", "sig", "http"]);

    // RFC 9421 §5: If the response includes an Accept-Signature header,
    // attempt a challenge-driven retry before falling back to spec-swap.
    const acceptSigHeader = response.headers.get("Accept-Signature");
    if (acceptSigHeader != null) {
      const entries = validateAcceptSignature(
        parseAcceptSignature(acceptSigHeader),
      );
      const localKeyId = identity.keyId.href;
      const localAlg = "rsa-v1_5-sha256";
      // RFC 9421 §5: "The target message of an Accept-Signature field MUST
      // include all labeled signatures indicated in the Accept-Signature
      // field."  We therefore accumulate every compatible entry's signature
      // into challengeRequest before sending a single retry, rather than
      // stopping at the first success.
      let fulfilled = false;
      let challengeRequest: Request | undefined;
      for (const entry of entries) {
        const rfc9421 = fulfillAcceptSignature(entry, localKeyId, localAlg);
        if (rfc9421 == null) continue;
        logger.debug(
          "Received Accept-Signature challenge; accumulating " +
            "label {label} and components {components}.",
          { label: rfc9421.label, components: rfc9421.components },
        );
        try {
          // Pass the previously-signed request so that Signature-Input /
          // Signature headers are appended to rather than overwritten.
          challengeRequest = await signRequest(
            challengeRequest ?? request,
            identity.privateKey,
            identity.keyId,
            {
              spec: "rfc9421",
              tracerProvider,
              body,
              rfc9421,
            },
          );
          fulfilled = true;
        } catch (error) {
          logger.debug(
            "Failed to fulfill Accept-Signature challenge entry " +
              "{label}: {error}",
            { label: entry.label, error },
          );
        }
      }
      if (fulfilled && challengeRequest != null) {
        signedRequest = challengeRequest;
        log?.(signedRequest);
        response = await fetch(signedRequest, { redirect: "manual", signal });
        // Follow redirects manually:
        if (
          response.status >= 300 && response.status < 400 &&
          response.headers.has("Location")
        ) {
          const location = response.headers.get("Location")!;
          return doubleKnock(
            createRedirectRequest(request, location, body),
            identity,
            { ...options, body },
          );
        }
      }
      // If the challenge retry succeeded, remember spec and return
      if (fulfilled && response.status < 300) {
        await specDeterminer?.rememberSpec(origin, "rfc9421");
        return response;
      }
      if (
        fulfilled && response.status !== 400 && response.status !== 401
      ) {
        return response;
      }
      // Otherwise fall through to legacy spec-swap fallback
    }

    // Legacy double-knocking: swap between RFC 9421 and draft-cavage
    const spec = firstTrySpec === "draft-cavage-http-signatures-12"
      ? "rfc9421"
      : "draft-cavage-http-signatures-12";
    logger.debug(
      "Failed to verify with the spec {spec} ({status} {statusText}); retrying with spec {secondSpec}... (double-knocking)",
      {
        spec: firstTrySpec,
        secondSpec: spec,
        status: response.status,
        statusText: response.statusText,
      },
    );
    signedRequest = await signRequest(
      request,
      identity.privateKey,
      identity.keyId,
      { spec, tracerProvider, body },
    );
    log?.(signedRequest);
    response = await fetch(signedRequest, {
      // Since Bun has a bug that ignores the `Request.redirect` option,
      // to work around it we specify `redirect: "manual"` here too:
      // https://github.com/oven-sh/bun/issues/10754
      redirect: "manual",
      signal,
    });
    // Follow redirects manually to get the final URL:
    if (
      response.status >= 300 && response.status < 400 &&
      response.headers.has("Location")
    ) {
      const location = response.headers.get("Location")!;
      return doubleKnock(
        createRedirectRequest(request, location, body),
        identity,
        { ...options, body },
      );
    } else if (response.status !== 400 && response.status !== 401) {
      await specDeterminer?.rememberSpec(origin, spec);
    }
  } else {
    await specDeterminer?.rememberSpec(origin, firstTrySpec);
  }
  return response;
}

/**
 * Performs a timing-safe equality comparison between two `Uint8Array` values.
 *
 * This function is designed to take a constant amount of time to execute,
 * dependent only on the length of the longer of the two arrays,
 * regardless of where the first difference in bytes occurs. This helps
 * prevent timing attacks.
 *
 * @param a The first bytes.
 * @param b The second bytes.
 * @returns `true` if the arrays are of the same length and contain the same
 *          bytes, `false` otherwise.
 * @since 1.6.0
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const lenA = a.length;
  const lenB = b.length;
  const commonLength = Math.max(lenA, lenB);
  let result = 0;

  // Perform byte-wise XOR comparison for the length of the longer array.
  // If one array is shorter, its out-of-bounds "bytes" are treated as 0 for the comparison.
  // All byte differences are accumulated into the `result` using bitwise OR.
  for (let i = 0; i < commonLength; i++) {
    const byteA = i < lenA ? a[i] : 0;
    const byteB = i < lenB ? b[i] : 0;
    result |= byteA ^ byteB;
  }

  // Incorporate the length difference into the result.
  // If lengths are different, (lenA ^ lenB) will be non-zero, making `result` non-zero.
  // This ensures that arrays are only considered equal if both their contents
  // (up to their respective lengths) and their lengths are identical.
  result |= lenA ^ lenB;

  // `result` will be 0 if and only if all XORed byte pairs were 0 AND lengths were equal.
  return result === 0;
}

// cSpell: ignore keyid
