/**
 * Common tracker for Federation variable tracking.
 * Works with TSESTree AST nodes from @typescript-eslint/utils.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import type { CallExpression, Node, VariableDeclarator } from "./ast-types.ts";

/**
 * Checks if a CallExpression is a createFederation or createFederationBuilder call.
 */
const isCreateFederation = (node: CallExpression): boolean =>
  node.callee.type === "Identifier" &&
  /^create(Federation|FederationBuilder)$/i.test(node.callee.name);

/**
 * Helper to track variable names that store the result of createFederation()
 * or createFederationBuilder() calls.
 */
export function trackFederationVariables() {
  const federationVariables = new Set<string>();

  const isFederationObject = (obj: TSESTree.Expression): boolean => {
    switch (obj.type) {
      case "Identifier":
        return federationVariables.has(obj.name);
      case "CallExpression": {
        // Check if it's a direct createFederation call
        if (isCreateFederation(obj)) return true;
        // Check if it's a chained method call on a federation object
        if (obj.callee.type === "MemberExpression") {
          return isFederationObject(obj.callee.object);
        }
        return false;
      }
      case "MemberExpression":
        return isFederationObject(obj.object);
    }
    return false;
  };

  return {
    VariableDeclarator(node: VariableDeclarator) {
      const init = node.init;
      const id = node.id;

      if (init?.type === "CallExpression") {
        if (isCreateFederation(init) && id.type === "Identifier") {
          federationVariables.add(id.name);
        }
      }
    },

    isFederationVariable(name: string): boolean {
      return federationVariables.has(name);
    },

    isFederationObject,
  };
}
