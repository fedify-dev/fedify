/**
 * @fedify/lint - Fedify linting rules and plugins
 *
 * This package provides lint rules for both Deno.lint and ESLint.
 *
 * @example ESLint usage:
 * ```js
 * // eslint.config.js
 * import fedifyLint from "@fedify/lint";
 *
 * export default [
 *   {
 *     plugins: {
 *       "@fedify/lint": fedifyLint,
 *     },
 *     rules: {
 *       "@fedify/lint/actor-id-required": "warn",
 *       "@fedify/lint/actor-id-mismatch": "error",
 *     },
 *   },
 * ];
 * ```
 *
 * Or use the recommended configuration:
 * ```js
 * // eslint.config.js
 * import fedifyLint from "@fedify/lint";
 *
 * export default [
 *   fedifyLint.configs.recommended,
 * ];
 * ```
 */
export { default, RULE_IDS, rules } from "./eslint.ts";
