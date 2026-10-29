import { getLogger } from "@logtape/logtape";

const logger = getLogger(["fedify", "fresh"]);

let warned = false;

/**
 * Emits a one-time deprecation warning for the Fresh integration.
 *
 * @internal
 */
export function warnFreshDeprecated(): void {
  if (warned) return;
  warned = true;
  logger.warn(
    "The @fedify/fresh integration is deprecated and Fresh is not " +
      "recommended for new projects.  It remains supported throughout the " +
      "2.x series, but is tentatively planned for removal in Fedify 3.0.0.  " +
      "See {url} for details.",
    { url: "https://github.com/fedify-dev/fedify/issues/1326" },
  );
}

/**
 * Resets the one-time deprecation warning state for tests.
 *
 * @internal
 */
export function resetFreshDeprecationWarningForTesting(): void {
  warned = false;
}
