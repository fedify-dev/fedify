import type { Rule } from "eslint";
import type { Node } from "./types.ts";

interface ReportContext {
  report(descriptor: { node: Node; message: string }): void;
}

/**
 * Whether the given module specifier refers to `@fedify/denokv`, including
 * versioned `jsr:` and `npm:` specifiers.
 */
export function isDenokvSpecifier(specifier: string): boolean {
  return /^(?:jsr:|npm:)?@fedify\/denokv(?:@[^/]+)?(?:\/.*)?$/.test(specifier);
}

function getSourceValue(node: Node): string | null {
  const source = (node as { source?: unknown }).source;
  if (source == null || typeof source !== "object") return null;
  const value = (source as { value?: unknown }).value;
  return typeof value === "string" ? value : null;
}

/**
 * Returns the name of an `Identifier` or the value of a string `Literal`.
 */
function getModuleName(node: unknown): string | null {
  if (node == null || typeof node !== "object") return null;
  const type = (node as { type?: unknown }).type;
  if (type === "Identifier") {
    const name = (node as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  }
  if (type === "Literal") {
    const value = (node as { value?: unknown }).value;
    return typeof value === "string" ? value : null;
  }
  return null;
}

/**
 * Creates a rule that reports imports and re-exports of a deprecated class
 * from `@fedify/denokv`.
 *
 * Named imports, aliases, `import type`, inline `{ type X }` imports, named
 * re-exports, and namespace imports are covered.  Dynamic `import()` calls and
 * `export * from "@fedify/denokv"` are not.  A namespace import is reported as
 * a whole because the rule does not resolve which member the code uses; this
 * keeps the rule free of scope-analysis false positives.
 */
export function createDenoKvDeprecationRule<
  Context = Deno.lint.RuleContext | Rule.RuleContext,
>(
  className: string,
  message: string,
) {
  return (context: Context) => {
    const report = (descriptor: { node: Node; message: string }) =>
      (context as unknown as ReportContext).report(descriptor);

    return {
      ImportDeclaration(node: Node): void {
        const source = getSourceValue(node);
        if (source == null || !isDenokvSpecifier(source)) return;
        const specifiers = (node as { specifiers?: unknown }).specifiers;
        if (!Array.isArray(specifiers)) return;
        for (const specifier of specifiers) {
          if (specifier == null || typeof specifier !== "object") continue;
          const type = (specifier as { type?: unknown }).type;
          if (type === "ImportSpecifier") {
            const imported = getModuleName(
              (specifier as { imported?: unknown }).imported,
            );
            if (imported === className) {
              report({ node: specifier as Node, message });
            }
          } else if (type === "ImportNamespaceSpecifier") {
            report({ node: specifier as Node, message });
          }
        }
      },

      ExportNamedDeclaration(node: Node): void {
        const source = getSourceValue(node);
        if (source == null || !isDenokvSpecifier(source)) return;
        const specifiers = (node as { specifiers?: unknown }).specifiers;
        if (!Array.isArray(specifiers)) return;
        for (const specifier of specifiers) {
          if (specifier == null || typeof specifier !== "object") continue;
          if ((specifier as { type?: unknown }).type !== "ExportSpecifier") {
            continue;
          }
          const local = getModuleName((specifier as { local?: unknown }).local);
          if (local === className) {
            report({ node: specifier as Node, message });
          }
        }
      },
    };
  };
}
