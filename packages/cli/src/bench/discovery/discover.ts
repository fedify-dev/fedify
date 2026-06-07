/**
 * Recipient discovery: resolving a handle or actor URI to the inbox URL a real
 * peer would deliver to.
 *
 * Discovery mirrors how a remote server finds an inbox: WebFinger on a handle
 * yields the actor URI, then the actor document yields its personal `inbox` and
 * its shared inbox endpoint.  `lookupObject()` performs the WebFinger step for
 * `acct:` identifiers automatically.
 * @since 2.3.0
 * @module
 */

import { isActor, lookupObject } from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { convertUrlIfHandle } from "../../webfinger/lib.ts";

/** The inbox mode an inbox scenario targets. */
export type InboxKind = "shared" | "personal";

/** A discovered recipient's inbox URLs. */
export interface DiscoveredInbox {
  readonly actorUri: URL;
  readonly personalInbox: URL;
  readonly sharedInbox: URL | null;
}

/** The loaders and network policy passed to the object resolver. */
export interface DiscoverLoaders {
  readonly documentLoader?: DocumentLoader;
  readonly contextLoader?: DocumentLoader;
  /**
   * Whether WebFinger and document fetches may target private addresses; set
   * for loopback/private benchmark targets.
   */
  readonly allowPrivateAddress?: boolean;
}

/** Options controlling discovery. */
export interface DiscoverOptions extends DiscoverLoaders {
  /** An overridable object resolver, for testing.  Defaults to `lookupObject`. */
  readonly lookup?: (
    identifier: URL,
    loaders: DiscoverLoaders,
  ) => Promise<unknown>;
}

/** An error raised when a recipient cannot be discovered. */
export class DiscoveryError extends Error {}

/**
 * Discovers a recipient's inbox URLs from a handle or actor URI.
 * @param recipient A handle (`acct:alice@host` or `@alice@host`) or actor URI.
 * @param options Document/context loaders (use a private-address-allowing
 *                loader for loopback targets).
 * @returns The actor URI and its personal and shared inbox URLs.
 * @throws {DiscoveryError} If the recipient does not resolve to an actor with
 *         an inbox.
 */
export async function discoverInbox(
  recipient: string,
  options: DiscoverOptions = {},
): Promise<DiscoveredInbox> {
  const identifier = convertUrlIfHandle(recipient);
  const { lookup = lookupObject, allowPrivateAddress } = options;
  // When private addresses are allowed but no loaders are supplied, build
  // private-address-allowing loaders so loopback discovery actually fetches.
  const documentLoader = options.documentLoader ??
    (allowPrivateAddress
      ? await getDocumentLoader({ allowPrivateAddress: true })
      : undefined);
  const contextLoader = options.contextLoader ??
    (allowPrivateAddress
      ? await getContextLoader({ allowPrivateAddress: true })
      : undefined);
  let object: unknown;
  try {
    object = await lookup(identifier, {
      documentLoader,
      contextLoader,
      allowPrivateAddress,
    });
  } catch (error) {
    throw new DiscoveryError(
      `Failed to resolve recipient ${recipient}: ${error}`,
    );
  }
  if (!isActor(object)) {
    throw new DiscoveryError(
      `Recipient ${recipient} did not resolve to an actor.`,
    );
  }
  if (object.inboxId == null) {
    throw new DiscoveryError(`Actor ${recipient} has no inbox.`);
  }
  return {
    actorUri: object.id ?? identifier,
    personalInbox: object.inboxId,
    sharedInbox: object.endpoints?.sharedInbox ?? null,
  };
}

/**
 * Chooses the inbox URL to deliver to for a scenario's `inbox` mode.
 *
 * `"shared"` (the default) prefers the shared inbox and falls back to the
 * personal one; `"personal"` uses the personal inbox; any other value is an
 * explicit inbox URL that skips discovery selection.
 * @param discovered The discovered inbox URLs.
 * @param mode The scenario's `inbox` value.
 * @returns The inbox URL to deliver to.
 */
export function selectInbox(
  discovered: DiscoveredInbox,
  mode: string | undefined,
): URL {
  if (mode != null && mode !== "shared" && mode !== "personal") {
    return new URL(mode);
  }
  if (mode === "personal") return discovered.personalInbox;
  return discovered.sharedInbox ?? discovered.personalInbox;
}
