import type { Rule } from "eslint";
import {
  COLLECTION_FILTERING_NOT_IMPLEMENTED_ERROR,
  COLLECTION_FILTERING_NOT_IMPLEMENTED_ERROR as message,
} from "../lib/messages.ts";
import { hasMinParams, isFunction } from "../lib/pred.ts";
import { trackFederationVariables } from "../lib/tracker.ts";
import type {
  CallExpression,
  CallMemberExpressionWithIdentified,
} from "../lib/types.ts";

export const COLLECTION_FILTERING_NOT_IMPLEMENTED =
  "collection-filtering-not-implemented";

/**
 * The followers dispatcher method that supports filtering.
 * Only setFollowersDispatcher uses the filter parameter for
 * followers collection synchronization.
 * See: https://fedify.dev/manual/collections#filtering-by-server
 */
const FILTER_NEEDED = ["setFollowersDispatcher"];

/**
 * Checks if a node is a setFollowersDispatcher call.
 */
const isFollowersDispatcherCall = (
  node: CallExpression,
): node is CallMemberExpressionWithIdentified =>
  "callee" in node &&
  node.callee &&
  node.callee.type === "MemberExpression" &&
  node.callee.property.type === "Identifier" &&
  FILTER_NEEDED.includes(node.callee.property.name);

/**
 * Checks if a function node has the filter parameter (4th parameter).
 * CollectionDispatcher signature: (context, identifier, cursor, filter?) => ...
 */
const hasFilterParameter = hasMinParams(4);

/**
 * Lint rule: collection-filtering-not-implemented
 *
 * Warns when setFollowersDispatcher doesn't implement filtering.
 * The followers dispatcher should accept a 4th parameter (filter/baseUri) to
 * support server-side filtering for followers collection synchronization.
 * See: https://fedify.dev/manual/collections#filtering-by-server
 *
 * @example Good:
 * ```typescript ignore
 * federation.setFollowersDispatcher(
 *   "/users/{identifier}/followers",
 *   async (ctx, identifier, cursor, filter) => {
 *     // filter is a URL representing the base URI to filter by
 *     if (filter != null) {
 *       // Filter followers by server
 *     }
 *     return { items: [] };
 *   }
 * );
 * ```
 *
 * @example Bad:
 * ```typescript ignore
 * federation.setFollowersDispatcher(
 *   "/users/{identifier}/followers",
 *   async (ctx, identifier, cursor) => {
 *     // No filter parameter - will cause warning
 *     return { items: [] };
 *   }
 * );
 * ```
 */
export const deno: Deno.lint.Rule = {
  create(context) {
    const federationTracker = trackFederationVariables();

    return {
      VariableDeclarator: federationTracker.VariableDeclarator,

      CallExpression(node) {
        // Check if it's a setFollowersDispatcher call on a federation object
        if (!isFollowersDispatcherCall(node)) return;
        if (!federationTracker.isFederationObject(node.callee.object)) return;

        // Get the dispatcher callback (2nd argument)
        const dispatcherArg = node.arguments[1];
        if (!isFunction(dispatcherArg)) return;

        // Check if the callback has the filter parameter
        if (!hasFilterParameter(dispatcherArg)) {
          context.report({
            node: dispatcherArg,
            message,
          });
        }
      },
    };
  },
};

export const eslint: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Ensure followers dispatcher implements filtering",
    },
    schema: [],
    messages: {
      filterRequired: COLLECTION_FILTERING_NOT_IMPLEMENTED_ERROR,
    },
  },
  create(context) {
    const federationTracker = trackFederationVariables();

    return {
      VariableDeclarator: federationTracker.VariableDeclarator,
      CallExpression(node): void {
        if (!isFollowersDispatcherCall(node)) return;
        if (!federationTracker.isFederationObject(node.callee.object)) return;

        // Get the dispatcher callback (2nd argument)
        const dispatcherArg = node.arguments[1];
        if (!isFunction(dispatcherArg)) return;

        // Check if the callback has the filter parameter (4th parameter)
        if (!hasFilterParameter(dispatcherArg)) {
          context.report({
            node: dispatcherArg,
            messageId: "filterRequired",
          });
        }
      },
    };
  },
};
