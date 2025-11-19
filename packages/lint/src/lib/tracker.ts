/**
 * Helper to track variable names that store the result of createFederation() or createFederationBuilder() calls
 */
export function trackFederationVariables() {
  const federationVariables = new Set<string>();

  return {
    VariableDeclarator(node: unknown) {
      if (typeof node !== "object" || node === null) return;
      const n = node as Record<string, unknown>;
      const init = n.init as Record<string, unknown> | null | undefined;
      const id = n.id as Record<string, unknown>;

      if (
        init?.type === "CallExpression" &&
        typeof init.callee === "object" && init.callee !== null
      ) {
        const callee = init.callee as Record<string, unknown>;
        if (callee.type === "Identifier" && typeof callee.name === "string") {
          if (/^create(Federation|FederationBuilder)$/i.test(callee.name)) {
            if (id.type === "Identifier" && typeof id.name === "string") {
              federationVariables.add(id.name);
            }
          }
        }
      }
    },

    isFederationVariable(name: string): boolean {
      return federationVariables.has(name);
    },

    isFederationObject(obj: unknown): boolean {
      if (typeof obj !== "object" || obj === null) return false;
      const o = obj as Record<string, unknown>;

      if (o.type === "Identifier" && typeof o.name === "string") {
        return federationVariables.has(o.name);
      } else if (
        o.type === "CallExpression" &&
        typeof o.callee === "object" && o.callee !== null
      ) {
        const callee = o.callee as Record<string, unknown>;
        if (callee.type === "Identifier" && typeof callee.name === "string") {
          return /^create(Federation|FederationBuilder)$/i.test(callee.name);
        }
      }
      return false;
    },
  };
}
