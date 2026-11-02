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
  return withContext({
    sourceInboxRequestId: source.inboxRequest?.inboxRequestId,
    sourceRequestId: source.inboxRequest?.requestId ??
      source.originatingRequestId,
  }, operation);
}
