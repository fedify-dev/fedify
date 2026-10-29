import type { Rule } from "eslint";
import { createDenoKvDeprecationRule } from "../lib/deprecated-import.ts";
import { DENO_KV_STORE_DEPRECATED as MESSAGE } from "../lib/messages.ts";

/**
 * Lint rule: deno-kv-store-deprecated
 *
 * Warns when `DenoKvStore` from the deprecated `@fedify/denokv` package is
 * imported or used.  The adapter remains supported throughout Fedify 2.x but
 * will be removed in Fedify 3.0.0; `@fedify/sqlite` covers local and
 * single-node deployments, and the PostgreSQL, Redis, MySQL, and Cloudflare
 * Workers adapters cover production.
 */
export const deno: Deno.lint.Rule = {
  create: createDenoKvDeprecationRule("DenoKvStore", MESSAGE),
};

export const eslint: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn when the deprecated `DenoKvStore` class from `@fedify/denokv` " +
        "is used",
    },
    schema: [],
  },
  create: createDenoKvDeprecationRule("DenoKvStore", MESSAGE),
};
