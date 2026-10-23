import type { PinGrant } from "../pin-grant.ts";
import type { ResolvedAddress } from "../url.ts";

/**
 * Connects requests only to the addresses a {@link PinGrant} stands for.
 * Pinners are created by factories and never exported from any entry point.
 */
export interface ConnectionPinner {
  /**
   * Whether this pinner can pin requests to the given URL.  This is decided
   * per protocol.
   */
  supports(url: URL): boolean;

  /**
   * Sends the request to one of the addresses of the grant.  The grant is
   * redeemed for every request, and every address is checked again right
   * before connecting.
   * @param grant The grant for the request's origin.
   * @param request The request to send.  Its redirect mode is ignored;
   *                redirects are never followed.
   * @param signal An optional signal to abort the request.
   * @returns The response.
   */
  fetch(
    grant: PinGrant,
    request: Request,
    signal?: AbortSignal,
  ): Promise<Response>;

  /**
   * Releases the resources held for the grant.  Called once when the session
   * that owns the grant is closed.
   */
  release(grant: PinGrant): void | Promise<void>;
}

/**
 * Options for the pinner factories.
 */
export interface ConnectionPinnerOptions {
  /**
   * Checks an address right before connecting to it.  The production pinner
   * rejects non-public addresses here.
   * @throws {UrlError} If the address must not be connected to.
   */
  readonly verifyAddress: (address: ResolvedAddress) => void;
}
