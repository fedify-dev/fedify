/**
 * Unforgeable capabilities that hand the addresses validated by
 * `openPublicFetch()` over to a connection pinner.
 *
 * This module is not exported from any entry point of the package.
 * @module
 */

import type { ResolvedAddress } from "./url.ts";

declare const brand: unique symbol;

/**
 * An opaque token that stands for a set of validated addresses of an origin.
 * Only objects returned by {@link issuePinGrant} are accepted by
 * {@link redeemPinGrant}; objects of the same shape are not.
 */
export type PinGrant = { readonly [brand]: never };

/**
 * What a {@link PinGrant} stands for.
 */
export interface PinGrantRecord {
  /** The origin (scheme, host, and port) the grant was issued for. */
  readonly origin: string;
  /** The hostname the grant was issued for, without IPv6 brackets. */
  readonly hostname: string;
  /** The validated addresses, in lookup order. */
  readonly addresses: readonly ResolvedAddress[];
}

interface GrantState {
  readonly record: PinGrantRecord;
  revoked: boolean;
}

const grants = new WeakMap<PinGrant, GrantState>();

/**
 * Issues a grant for the given URL's origin and addresses.  This does not
 * validate the addresses; callers validate them before issuing, and pinners
 * validate them again right before connecting.
 * @param url The URL whose origin the grant is bound to.
 * @param addresses The addresses to connect to.
 * @returns A new grant.
 */
export function issuePinGrant(
  url: URL,
  addresses: readonly ResolvedAddress[],
): PinGrant {
  const grant = Object.freeze(Object.create(null)) as PinGrant;
  let hostname = url.hostname;
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  const record: PinGrantRecord = Object.freeze({
    origin: url.origin,
    hostname,
    addresses: Object.freeze(
      addresses.map(({ address, family }) =>
        Object.freeze({ address, family })
      ),
    ),
  });
  grants.set(grant, { record, revoked: false });
  return grant;
}

/**
 * Checks that the given grant was issued by {@link issuePinGrant}, has not
 * been revoked, and was issued for the origin of the given URL.
 * @param grant The grant to redeem.
 * @param url The URL to connect to.
 * @returns What the grant stands for.
 * @throws {TypeError} If the grant cannot be used for the URL.
 */
export function redeemPinGrant(grant: PinGrant, url: URL): PinGrantRecord {
  const state = typeof grant === "object" && grant !== null
    ? grants.get(grant)
    : undefined;
  if (state == null) throw new TypeError("Invalid pin grant.");
  if (state.revoked) throw new TypeError("The pin grant has been revoked.");
  if (url.origin !== state.record.origin) {
    throw new TypeError(
      `The pin grant for ${state.record.origin} cannot be used for ` +
        `${url.origin}.`,
    );
  }
  return state.record;
}

/**
 * Revokes the given grant so that it can no longer be redeemed.
 * @param grant The grant to revoke.
 */
export function revokePinGrant(grant: PinGrant): void {
  const state = grants.get(grant);
  if (state != null) state.revoked = true;
}
