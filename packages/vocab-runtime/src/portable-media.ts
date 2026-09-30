import { MAX_BODY_SIZE, readBoundedBytes } from "./body.ts";
import {
  parseDigestMultibase,
  parseHashlink,
  verifyDigestMultibase,
} from "./digest.ts";
import { getUserAgent, type GetUserAgentOptions } from "./request.ts";
import { parseGatewayUrl, validatePublicUrl } from "./url.ts";

/** A link or document with an external resource and its integrity digest. */
export interface PortableMedia {
  readonly href?: URL | null;
  readonly url?: URL | {
    readonly href: URL | null;
    readonly digestMultibase?: string | null;
  } | null;
  readonly digestMultibase?: string | null;
}

/** Options for {@link fetchPortableMedia}. */
export interface FetchPortableMediaOptions {
  /** Ordered FEP-ef61 gateway origins used for `hl:` resources. */
  readonly gateways?: Iterable<string | URL>;
  /** Expected digest when the first argument is a URL or string. */
  readonly digestMultibase?: string;
  /** Maximum decoded response size in bytes.  Defaults to 16 MiB. */
  readonly maxBytes?: number;
  /** Whether private network addresses may be fetched.  Defaults to `false`. */
  readonly allowPrivateAddress?: boolean;
  /** The HTTP `User-Agent` value or its components. */
  readonly userAgent?: string | GetUserAgentOptions;
  /** Cancels the entire retrieval and all gateway attempts. */
  readonly signal?: AbortSignal;
  /** Overall timeout in milliseconds.  Defaults to 10 seconds; `null` disables it. */
  readonly timeout?: number | null;
  /** Timeout per gateway in milliseconds.  Defaults to 3 seconds. */
  readonly gatewayTimeout?: number | null;
}

function resolveTimeout(
  value: number | null | undefined,
  fallback: number,
): number | null {
  if (value === null) return null;
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result <= 0 || result > 2_147_483_647) {
    throw new RangeError(
      "A media timeout must be a positive finite number of milliseconds.",
    );
  }
  return Math.ceil(result);
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal | undefined,
  timeout: number | null,
): Promise<T> {
  parent?.throwIfAborted();
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", onParentAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeout != null) {
    timer = setTimeout(() =>
      controller.abort(
        new DOMException(
          `Media retrieval timed out after ${timeout} ms.`,
          "TimeoutError",
        ),
      ), timeout);
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    if (timer != null) clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
    if (onAbort != null) {
      controller.signal.removeEventListener("abort", onAbort);
    }
  }
}

function mediaTarget(media: string | URL | PortableMedia): {
  url: string;
  digestMultibase: string | null | undefined;
} {
  if (typeof media === "string" || media instanceof URL) {
    return { url: media.toString(), digestMultibase: undefined };
  }
  const target = media.href ?? media.url;
  const url = target instanceof URL
    ? target.href
    : target != null && typeof target === "object" && "href" in target
    ? target.href?.href
    : undefined;
  if (url == null) throw new TypeError("Portable media has no URL or href.");
  const linkDigest = target != null && !(target instanceof URL) &&
      typeof target === "object" && "digestMultibase" in target
    ? target.digestMultibase
    : undefined;
  if (media.digestMultibase != null && linkDigest != null) {
    const outer = parseDigestMultibase(media.digestMultibase).digest;
    const inner = parseDigestMultibase(linkDigest).digest;
    if (outer.some((byte, i) => byte !== inner[i])) {
      throw new TypeError("Media and linked resource digests disagree.");
    }
  }
  return { url, digestMultibase: media.digestMultibase ?? linkDigest };
}

async function fetchVerified(
  url: URL,
  digestMultibase: string,
  options: FetchPortableMediaOptions,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Response> {
  const visited = new Set<string>();
  for (let redirects = 0; redirects <= 20; redirects++) {
    signal.throwIfAborted();
    if (url.username !== "" || url.password !== "") {
      throw new TypeError("Media URLs must not contain credentials.");
    }
    if (!options.allowPrivateAddress) await validatePublicUrl(url.href);
    else if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("Media URLs must use HTTP(S).");
    }
    if (visited.has(url.href)) throw new TypeError("Media redirect loop.");
    visited.add(url.href);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "*/*",
        "User-Agent": typeof options.userAgent === "string"
          ? options.userAgent
          : getUserAgent(options.userAgent),
      },
      redirect: "manual",
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      void response.body?.cancel().catch(() => {});
      if (location == null || redirects === 20) {
        throw new TypeError("Invalid or excessive media redirects.");
      }
      url = new URL(location, url);
      continue;
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      throw new Error(`Media request failed with HTTP ${response.status}.`);
    }
    const bytes = await readBoundedBytes(response, maxBytes, url);
    signal.throwIfAborted();
    if (!await verifyDigestMultibase(bytes, digestMultibase)) {
      throw new Error("Portable media digest does not match.");
    }
    const headers = new Headers();
    const contentType = response.headers.get("Content-Type");
    if (contentType != null) headers.set("Content-Type", contentType);
    return new Response(bytes, { headers });
  }
  throw new TypeError("Too many media redirects.");
}

/**
 * Fetches a portable object's external media and returns it only after its
 * SHA-256 `digestMultibase` has been verified.  `hl:` resources are tried at
 * the supplied gateways in order.  The result contains verified body bytes;
 * its `Content-Type` is unverified metadata supplied by the server.
 *
 * @param media A Link, Image, Document, or URL with an external resource.
 * @param options Retrieval, integrity, and network policy options.
 * @returns A response containing only verified bytes.
 * @throws {TypeError} If the media reference or digest is invalid.
 * @throws {Error} If no source supplies a matching bounded resource.
 * @since 2.4.0
 */
export async function fetchPortableMedia(
  media: string | URL | PortableMedia,
  options: FetchPortableMediaOptions = {},
): Promise<Response> {
  const { url, digestMultibase: propertyDigest } = mediaTarget(media);
  const digestMultibase = propertyDigest ?? options.digestMultibase;
  if (digestMultibase == null) {
    throw new TypeError("Portable media requires digestMultibase.");
  }
  const expected = parseDigestMultibase(digestMultibase).digest;
  const maxBytes = options.maxBytes ?? MAX_BODY_SIZE;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError(
      "The media size limit must be a positive safe integer.",
    );
  }
  const timeout = resolveTimeout(options.timeout, 10_000);
  const gatewayTimeout = resolveTimeout(options.gatewayTimeout, 3_000);
  let targets: URL[];
  let hashlink = false;
  if (/^hl:/i.test(url)) {
    hashlink = true;
    const parsed = parseHashlink(url);
    const hashDigest = parseDigestMultibase(parsed.digestMultibase).digest;
    if (expected.some((byte, i) => byte !== hashDigest[i])) {
      throw new TypeError("Hashlink and digestMultibase disagree.");
    }
    const gateways = [
      ...new Set(
        [...options.gateways ?? []].map((gateway) =>
          parseGatewayUrl(gateway.toString()).origin
        ),
      ),
    ];
    if (gateways.length === 0) {
      throw new TypeError("Hashlink media requires at least one gateway.");
    }
    targets = gateways.map((gateway) =>
      new URL(`/.well-known/apgateway/${url}`, gateway)
    );
  } else {
    const target = new URL(url);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new TypeError("Portable media URLs must use HTTP(S) or hl:.");
    }
    targets = [target];
  }
  return await withTimeout(
    async (signal) => {
      let lastError: unknown;
      for (const target of targets) {
        signal.throwIfAborted();
        try {
          return await withTimeout(
            (attemptSignal) =>
              fetchVerified(
                target,
                digestMultibase,
                options,
                attemptSignal,
                maxBytes,
              ),
            signal,
            hashlink ? gatewayTimeout : null,
          );
        } catch (error) {
          signal.throwIfAborted();
          if (!hashlink) throw error;
          lastError = error;
        }
      }
      throw new Error("No gateway returned verified portable media.", {
        cause: lastError,
      });
    },
    options.signal,
    timeout,
  );
}
