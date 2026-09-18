/**
 * The warning for a request whose authority cannot be used, and the budget
 * that keeps it from flooding the log.
 *
 * Internal to the package: this module is reachable through none of the
 * published subpaths.  The two constants are exported for the tests, which
 * have to spend exactly this budget.
 *
 * @module
 */
import type { HttpContext } from "@adonisjs/core/http";

/**
 * The host used when the request carries no usable authority.
 *
 * `FederationOptions.origin` covers the URLs Fedify *mints* — actor URIs,
 * activity IDs, collection URLs — so the placeholder never reaches a peer
 * through them, and only the path has to survive for routing.  It does not
 * cover verification: RFC 9421's `@authority`, `@target-uri` and `@scheme`
 * are derived from this URL, so a request signed over `@authority` fails to
 * verify while the placeholder stands in.  That is the cost of answering
 * instead of failing, and why the fallback is logged.
 */
export const PLACEHOLDER_HOST: string = "localhost";

/**
 * Unusable authorities already warned about in the current window.  Any
 * client can trigger the warning through `Host`, so each distinct value is
 * reported once and the set is capped, leaving neither it nor the log
 * unbounded.  The key is the whole value, since two hostile values can share
 * a 128-character prefix.
 */
const warnedAuthorities = new Set<string>();

/**
 * How many distinct values one window reports.
 */
export const WARNED_AUTHORITIES_LIMIT: number = 16;

/**
 * How long the cap holds before the budget starts over.
 *
 * Without a window the cap is spent for the life of the process, and the
 * values that spend it are the client's to choose: sixteen junk `Host`
 * headers would silence the warning for good, so a proxy misconfigured an
 * hour later—every request falling back to {@link PLACEHOLDER_HOST}, every
 * signature over `@authority` failing to verify—would never be reported.
 * Starting over bounds the log at {@link WARNED_AUTHORITIES_LIMIT} lines per
 * window instead of over all time, which is what the log has to be protected
 * from, and leaves a standing misconfiguration visible.
 */
export const WARNED_AUTHORITIES_WINDOW_MS: number = 60 * 60 * 1000;

/**
 * When the current window began; `0` so the first warning opens one.  It
 * advances lazily, on the first warning after the window has elapsed, rather
 * than from a timer that would hold the event loop open on a quiet process.
 */
let warnedAuthoritiesWindowStart = 0;

/**
 * Whether the cap has already been reported in this window.  Reaching it
 * silences every later distinct value, which should not happen invisibly.
 */
let warnedAuthoritiesCapReported = false;

/**
 * Reports an authority the request URL could not be built from, once per
 * distinct value and window.
 */
export function warnUnusableAuthority(
  logger: HttpContext["logger"],
  host: string,
): void {
  const now = Date.now();
  // `<` as well as the elapsed check: a backwards clock step (an NTP
  // correction) would otherwise freeze the window until real time caught up
  // with a start that lies in the future.
  if (
    now < warnedAuthoritiesWindowStart ||
    now - warnedAuthoritiesWindowStart >= WARNED_AUTHORITIES_WINDOW_MS
  ) {
    warnedAuthoritiesWindowStart = now;
    warnedAuthorities.clear();
    warnedAuthoritiesCapReported = false;
  }

  if (warnedAuthorities.has(host)) return;
  if (warnedAuthorities.size >= WARNED_AUTHORITIES_LIMIT) {
    if (warnedAuthoritiesCapReported) return;
    warnedAuthoritiesCapReported = true;
    logger.warn(
      "Reached %d distinct unusable request authorities within %d minutes; " +
        "further distinct values are not reported until that window ends",
      WARNED_AUTHORITIES_LIMIT,
      WARNED_AUTHORITIES_WINDOW_MS / 60_000,
    );
    return;
  }
  warnedAuthorities.add(host);
  // By code point, so an emoji straddling the boundary cannot leave a lone
  // surrogate in the key or the log line.
  const points = Array.from(host);
  const shown = points.length > 128
    ? `${points.slice(0, 128).join("")}…`
    : host;
  logger.warn(
    'Unusable request authority "%s"; the URL Fedify sees falls back to ' +
      '"%s", so signatures covering the authority will not verify. Behind a ' +
      "proxy this is a misbehaving X-Forwarded-Host; otherwise a client sent " +
      "it directly. Each distinct value is reported once per %d minutes, up " +
      "to %d values in that window",
    shown,
    PLACEHOLDER_HOST,
    WARNED_AUTHORITIES_WINDOW_MS / 60_000,
    WARNED_AUTHORITIES_LIMIT,
  );
}
