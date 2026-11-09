import type { Context } from "./context.ts";
import type {
  OutboundInboxRequest,
  OutboundLocalContext,
  OutboundProvenance,
} from "./outbound-report.ts";

// An own symbol property survives context spreads without adding public API.
export const outboundProvenance: unique symbol = Symbol("outboundProvenance");
export const emptyProvenance: OutboundProvenance = Object.freeze({});

export function getOutboundProvenance(context: object): OutboundProvenance {
  return (
    (context as { [outboundProvenance]?: OutboundProvenance })[
      outboundProvenance
    ] ?? emptyProvenance
  );
}

export function snapshotLocalContext(
  context: Pick<
    Context<unknown>,
    "origin" | "host" | "hostname" | "canonicalOrigin"
  >,
): OutboundLocalContext {
  return Object.freeze({
    origin: context.origin,
    host: context.host,
    hostname: context.hostname,
    canonicalOrigin: context.canonicalOrigin,
  });
}

export function createInboxRequestSource(
  request: Request,
  requestId: string,
  canonicalOrigin?: string,
): OutboundInboxRequest {
  const url = new URL(request.url);
  return Object.freeze({
    inboxRequestId: crypto.randomUUID(),
    requestId,
    context: snapshotLocalContext({
      origin: url.origin,
      host: url.host,
      hostname: url.hostname,
      canonicalOrigin: canonicalOrigin ?? url.origin,
    }),
  });
}

/** The same exact-string budget applies to public input and queued metadata. */
export function validateDispatchId(
  value: unknown,
): asserts value is string | undefined {
  if (value === undefined) return;
  if (typeof value !== "string") {
    throw new TypeError("dispatchId must be a string.");
  }
  if (
    value.length > 1024 ||
    new TextEncoder().encode(value).byteLength > 1024
  ) {
    throw new RangeError("dispatchId must not exceed 1,024 UTF-8 bytes.");
  }
}

/** A new public invocation keeps its HTTP source, with its own dispatch ID. */
export function invocationProvenance(
  context: object,
  dispatchId: unknown,
): OutboundProvenance {
  validateDispatchId(dispatchId);
  const { dispatchId: _previous, ...source } = getOutboundProvenance(context);
  return Object.freeze({
    ...source,
    ...(dispatchId === undefined ? {} : { dispatchId }),
  });
}

/** Restore only explicit source facts; never infer them from queue/trace IDs. */
export function restoreProvenance(value: unknown): OutboundProvenance {
  if (value === undefined) return emptyProvenance;
  const record = (v: unknown): v is Record<string, unknown> =>
    v != null && typeof v === "object" && !Array.isArray(v);
  const invalid = () => new TypeError("Invalid provenance in queue metadata.");
  if (!record(value)) throw invalid();
  validateDispatchId(value.dispatchId);
  if (
    value.originatingRequestId !== undefined &&
    typeof value.originatingRequestId !== "string"
  )
    throw invalid();
  let inboxRequest: OutboundInboxRequest | undefined;
  if (value.inboxRequest !== undefined) {
    const source = value.inboxRequest;
    if (
      !record(source) ||
      typeof source.inboxRequestId !== "string" ||
      source.inboxRequestId.length < 1 ||
      typeof source.requestId !== "string" ||
      !record(source.context)
    )
      throw invalid();
    const facts = source.context;
    if (
      typeof facts.origin !== "string" ||
      typeof facts.host !== "string" ||
      typeof facts.hostname !== "string" ||
      typeof facts.canonicalOrigin !== "string"
    )
      throw invalid();
    inboxRequest = Object.freeze({
      inboxRequestId: source.inboxRequestId,
      requestId: source.requestId,
      context: Object.freeze({
        origin: facts.origin,
        host: facts.host,
        hostname: facts.hostname,
        canonicalOrigin: facts.canonicalOrigin,
      }),
    });
  }
  return Object.freeze({
    ...(value.dispatchId === undefined ? {} : { dispatchId: value.dispatchId }),
    ...(inboxRequest == null ? {} : { inboxRequest }),
    ...(value.originatingRequestId === undefined
      ? {}
      : { originatingRequestId: value.originatingRequestId }),
  });
}

/** Omit absent provenance on legacy and independent producers. */
export function serializeProvenance(value: OutboundProvenance | undefined): {
  readonly provenance?: OutboundProvenance;
} {
  const provenance = restoreProvenance(value);
  return provenance.dispatchId === undefined &&
    provenance.inboxRequest == null &&
    provenance.originatingRequestId == null
    ? {}
    : { provenance };
}

export function sourceLogContext(source: OutboundProvenance): {
  dispatchId: string | undefined;
  sourceInboxRequestId: string | undefined;
  sourceRequestId: string | undefined;
} {
  return {
    dispatchId: source.dispatchId,
    sourceInboxRequestId: source.inboxRequest?.inboxRequestId,
    sourceRequestId:
      source.inboxRequest?.requestId ?? source.originatingRequestId,
  };
}
