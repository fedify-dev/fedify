import type { Recipient } from "@fedify/vocab";
import {
  canonicalizePortableUri,
  getFe34Origin,
  isGatewayUrl,
  toCompatibleEf61Id,
} from "@fedify/vocab-runtime";
import { getPortableGatewayCandidates } from "@fedify/vocab-runtime/internal/portable-dereference";
import { getLogger } from "@logtape/logtape";

/**
 * The maximum number of gateways that an activity to a portable inbox is
 * delivered through, one after another until one accepts it.  Gateways come
 * from possibly untrusted documents, so they are bounded to keep a single
 * delivery from fanning out to many servers.
 */
export const MAX_DELIVERY_GATEWAYS = 5;

/**
 * Where to deliver an activity addressed to an [FEP-ef61] portable inbox.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 */
export interface PortableDeliveryTarget {
  /** The canonical form of the portable inbox. */
  readonly portableInbox: string;
  /**
   * The compatible identifiers of the portable inbox on the gateways to
   * deliver through, in order of preference.  It is never empty.
   */
  readonly inboxes: readonly URL[];
}

/**
 * Resolves a portable inbox, i.e., an `ap:` or `ap+ef61:` URI, to
 * the compatible identifiers of the inbox on the recipient's gateways.
 *
 * The gateways are taken from the recipient's `gateways`, or, if it has no
 * valid gateway, from the `@gateway` location hints of the inbox URI.  Both
 * come from the recipient object, so they are as trustworthy as its inbox.
 * Gateways whose origins are in `excludeBaseUris` are skipped.
 * @param recipient The recipient that owns the inbox.
 * @param inbox The portable inbox.
 * @param excludeBaseUris The base URIs whose origins are not delivered to.
 * @returns The delivery target, or `null` if the inbox is malformed, or no
 *          gateway is left to deliver through.
 */
export function resolvePortableDeliveryTarget(
  recipient: Recipient,
  inbox: URL,
  excludeBaseUris?: readonly URL[],
): PortableDeliveryTarget | null {
  const logger = getLogger(["fedify", "federation", "outbox"]);
  let portableInbox: string;
  try {
    portableInbox = canonicalizePortableUri(inbox.href);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    logger.warn(
      "Skipping the recipient {recipient}, as its portable inbox {inbox} " +
        "is malformed.",
      { recipient: recipient.id?.href, inbox: inbox.href, error },
    );
    return null;
  }
  let gateways = (recipient.gateways ?? []).filter(isGatewayUrl);
  if (gateways.length < 1) {
    // A portable inbox URI has a path, so it is always a valid argument:
    gateways = getPortableGatewayCandidates(inbox);
  }
  if (gateways.length < 1) {
    logger.warn(
      "Skipping the recipient {recipient}, as it has no gateway to deliver " +
        "to its portable inbox {inbox} through.",
      { recipient: recipient.id?.href, inbox: portableInbox },
    );
    return null;
  }
  const excludedOrigins = new Set(excludeBaseUris?.map((u) => u.origin));
  const seen = new Set<string>();
  const inboxes: URL[] = [];
  for (const gateway of gateways) {
    if (inboxes.length >= MAX_DELIVERY_GATEWAYS) break;
    if (seen.has(gateway.origin)) continue;
    seen.add(gateway.origin);
    if (excludedOrigins.has(gateway.origin)) continue;
    try {
      inboxes.push(toCompatibleEf61Id(inbox, gateway.origin));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      logger.warn(
        "Cannot deliver to the portable inbox {inbox} through the gateway " +
          "{gateway}, as the inbox cannot be represented as its compatible " +
          "identifier.",
        { inbox: portableInbox, gateway: gateway.origin, error },
      );
    }
  }
  if (inboxes.length < 1) {
    logger.debug(
      "Skipping the recipient {recipient}, as no gateway is left to deliver " +
        "to its portable inbox {inbox} through.",
      { recipient: recipient.id?.href, inbox: portableInbox },
    );
    return null;
  }
  return { portableInbox, inboxes };
}

/**
 * Merges two ordered lists of compatible inbox URLs, keeping the first URL
 * for each gateway origin and at most {@link MAX_DELIVERY_GATEWAYS} URLs.
 * @param a The preferred list.
 * @param b The other list.
 * @returns The merged list.
 */
export function mergeGatewayInboxes(
  a: readonly string[],
  b: readonly string[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const inbox of [...a, ...b]) {
    if (merged.length >= MAX_DELIVERY_GATEWAYS) break;
    const { origin } = new URL(inbox);
    if (seen.has(origin)) continue;
    seen.add(origin);
    merged.push(inbox);
  }
  return merged;
}

/**
 * Gets the part of a delivery's ordering key that tells its destination
 * apart: the DID of a portable inbox, so that deliveries to it stay in order
 * whichever gateway they go through, or the origin of any other inbox.
 * @param inbox The inbox URL.
 * @param portableInbox The canonical portable inbox, if the inbox is
 *                      the compatible identifier of one.
 * @returns The destination part of the ordering key.
 */
export function getOrderingDestination(
  inbox: string,
  portableInbox?: string,
): string {
  return portableInbox == null
    ? new URL(inbox).origin
    : getFe34Origin(portableInbox);
}
