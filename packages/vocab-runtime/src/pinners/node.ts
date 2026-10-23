import { isIP } from "node:net";
import type * as Undici from "undici";
import {
  type PinGrant,
  type PinGrantRecord,
  redeemPinGrant,
} from "../pin-grant.ts";
import { type ResolvedAddress, UrlError } from "../url.ts";
import type { ConnectionPinner, ConnectionPinnerOptions } from "./types.ts";

/**
 * Options for {@link createNodePinner}.
 */
export interface NodePinnerOptions extends ConnectionPinnerOptions {
  /**
   * The npm `undici` module, whose `Agent` is passed to the global `fetch()`
   * as the `dispatcher`.
   */
  readonly undici: Pick<typeof Undici, "Agent">;
}

type LookupCallback = (
  error: Error | null,
  address: string | ResolvedAddress[],
  family?: number,
) => void;

/**
 * Creates a pinner for Node.js.  Every request is sent through the global
 * `fetch()` with an undici `Agent` as the `dispatcher`.  The agent's
 * `connect.lookup` answers only with the addresses of live grants for
 * the hostname, checking each of them again right before connecting, and
 * fails when there are none, so a connection can never be made to an address
 * that was not validated.
 *
 * The agent is shared by the requests of all grants, so keep-alive
 * connections are reused.  A pooled connection was made to an address of
 * a grant that was valid when it was connected, so reusing it from another
 * session of the same origin still reaches a validated address.  Response
 * bodies have to be consumed or cancelled for their connections to return to
 * the pool, which sessions do when they are closed.
 *
 * Since the dispatcher is passed explicitly, neither proxy environment
 * variables nor the global dispatcher (e.g., `NODE_USE_ENV_PROXY=1`) apply.
 * @param options The pinner options.
 * @returns The pinner.
 */
export function createNodePinner(
  { verifyAddress, undici }: NodePinnerOptions,
): ConnectionPinner {
  const grants = new Map<string, Map<PinGrant, PinGrantRecord>>();

  function lookup(
    hostname: string,
    options: { all?: boolean; family?: number | string },
    callback: LookupCallback,
  ): void {
    let addresses: ResolvedAddress[];
    try {
      addresses = getGrantedAddresses(hostname, options.family);
    } catch (error) {
      callback(error as Error, []);
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  }

  function getGrantedAddresses(
    hostname: string,
    family: number | string | undefined,
  ): ResolvedAddress[] {
    const addresses = new Map<string, ResolvedAddress>();
    for (const [grant, record] of grants.get(hostname) ?? []) {
      try {
        redeemPinGrant(grant, new URL(record.origin));
      } catch {
        continue; // Revoked grants no longer count.
      }
      for (const address of record.addresses) {
        addresses.set(address.address, address);
      }
    }
    const familyNumber = family === "IPv4"
      ? 4
      : family === "IPv6"
      ? 6
      : typeof family === "number"
      ? family
      : 0;
    const result = [...addresses.values()].filter((address) =>
      familyNumber === 0 || address.family === familyNumber
    );
    if (result.length < 1) {
      throw new UrlError(`No validated address to connect to: ${hostname}`);
    }
    // Check every address again right before connecting:
    for (const address of result) verifyAddress(address);
    return result;
  }

  const agent = new undici.Agent({ connect: { lookup } });

  return {
    supports(url: URL): boolean {
      return url.protocol === "http:" || url.protocol === "https:";
    },

    async fetch(
      grant: PinGrant,
      request: Request,
      signal?: AbortSignal,
    ): Promise<Response> {
      const record = redeemPinGrant(grant, new URL(request.url));
      // Connections to IP literals do not go through the lookup:
      if (isIP(record.hostname) !== 0) {
        for (const address of record.addresses) verifyAddress(address);
      }
      let registered = grants.get(record.hostname);
      if (registered == null) {
        registered = new Map();
        grants.set(record.hostname, registered);
      }
      registered.set(grant, record);
      return await fetch(request, {
        redirect: "manual",
        // A signal in the options replaces the request's own signal, so both
        // are combined:
        signal: signal == null || signal === request.signal
          ? request.signal
          : AbortSignal.any([signal, request.signal]),
        dispatcher: agent,
      } as RequestInit);
    },

    release(grant: PinGrant): void {
      for (const [hostname, registered] of grants) {
        if (!registered.delete(grant)) continue;
        if (registered.size < 1) grants.delete(hostname);
        break;
      }
    },
  };
}
