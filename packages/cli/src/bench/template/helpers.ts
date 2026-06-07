/**
 * The default whitelisted helpers available in `${{ ... }}` expressions.
 *
 * Runtime-specific helpers (such as actor and target accessors) are added on
 * top of these when the benchmark context is assembled.
 * @since 2.3.0
 * @module
 */

import type { TemplateHelper } from "./template.ts";

/**
 * Returns a fresh registry of the default template helpers:
 *
 *  -  `uuid()` — a random UUID string.
 *  -  `upper(value)` — the uppercase form of the argument.
 *  -  `lower(value)` — the lowercase form of the argument.
 * @returns A new record of helper functions.
 */
export function defaultHelpers(): Record<string, TemplateHelper> {
  return {
    uuid: () => crypto.randomUUID(),
    upper: (value) => String(value).toUpperCase(),
    lower: (value) => String(value).toLowerCase(),
  };
}
