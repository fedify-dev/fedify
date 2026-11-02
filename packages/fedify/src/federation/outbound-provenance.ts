import { withContext } from "@logtape/logtape";
import type { Context } from "./context.ts";
import type {
  OutboundInboxRequest,
  OutboundLocalContext,
  OutboundProvenance,
} from "./outbound-report.ts";

// An own symbol property survives context spreads without adding public API.
export const outboundProvenance = Symbol("outboundProvenance");
export const emptyProvenance: OutboundProvenance = Object.freeze({});

export function getOutboundProvenance(context: object): OutboundProvenance {
  return (context as { [outboundProvenance]?: OutboundProvenance })[
    outboundProvenance
  ] ?? emptyProvenance;
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

export function withOutboundSource<T>(context: object, operation: () => T): T {
  const source = getOutboundProvenance(context);
  // Explicit absence masks unrelated ambient source labels as well.
  return withContext(sourceLogContext(source), operation);
}

/** Restore only explicit source facts; never infer them from queue/trace IDs. */
export function restoreProvenance(value: unknown): OutboundProvenance {
  if (value === undefined) return emptyProvenance;
  const record = (v: unknown): v is Record<string, unknown> =>
    v != null && typeof v === "object" && !Array.isArray(v);
  const invalid = () => new TypeError("Invalid provenance in queue metadata.");
  if (!record(value)) throw invalid();
  if (
    value.originatingRequestId !== undefined &&
    typeof value.originatingRequestId !== "string"
  ) throw invalid();
  let inboxRequest: OutboundInboxRequest | undefined;
  if (value.inboxRequest !== undefined) {
    const source = value.inboxRequest;
    if (
      !record(source) || typeof source.inboxRequestId !== "string" ||
      source.inboxRequestId.length < 1 ||
      typeof source.requestId !== "string" || !record(source.context)
    ) throw invalid();
    const facts = source.context;
    if (
      typeof facts.origin !== "string" || typeof facts.host !== "string" ||
      typeof facts.hostname !== "string" ||
      typeof facts.canonicalOrigin !== "string"
    ) throw invalid();
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
    ...(inboxRequest == null ? {} : { inboxRequest }),
    ...(value.originatingRequestId === undefined
      ? {}
      : { originatingRequestId: value.originatingRequestId }),
  });
}

/** Omit absent provenance on legacy and independent producers. */
export function serializeProvenance(
  value: OutboundProvenance | undefined,
): { readonly provenance?: OutboundProvenance } {
  const provenance = restoreProvenance(value);
  return provenance.inboxRequest == null &&
      provenance.originatingRequestId == null
    ? {}
    : { provenance };
}

export function sourceLogContext(source: OutboundProvenance) {
  return {
    sourceInboxRequestId: source.inboxRequest?.inboxRequestId,
    sourceRequestId: source.inboxRequest?.requestId ??
      source.originatingRequestId,
  };
}
