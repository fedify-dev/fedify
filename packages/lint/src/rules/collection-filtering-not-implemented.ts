import {
  COLLECTION_FILTERING_NOT_IMPLEMENTED_ERROR as message,
} from "../lib/messages.ts";
import {
  allOf,
  hasIdentifierProperty,
  hasMemberExpressionCallee,
  hasMethodName,
  hasMinArguments,
  isFunction,
} from "../lib/pred.ts";
import { trackFederationVariables } from "../lib/tracker.ts";
import type {
  CallMemberExpressionWithIdentified,
  FunctionNode,
} from "../lib/types.ts";

export const COLLECTION_FILTERING_NOT_IMPLEMENTED =
  "collection-filtering-not-implemented";

/**
 * The followers dispatcher method that supports filtering.
 * Only setFollowersDispatcher uses the filter parameter for
 * followers collection synchronization.
 * See: https://fedify.dev/manual/collections#filtering-by-server
 */
const FOLLOWERS_DISPATCHER_METHOD = "setFollowersDispatcher" as const;

/**
 * Checks if a node is a setFollowersDispatcher call.
 */
const isFollowersDispatcherCall = (
  node: Deno.lint.CallExpression,
): node is Deno.lint.CallExpression & CallMemberExpressionWithIdentified =>
  allOf(
    hasMemberExpressionCallee,
    hasIdentifierProperty,
    hasMinArguments(2),
    hasMethodName(FOLLOWERS_DISPATCHER_METHOD),
  )(node as Deno.lint.CallExpression & CallMemberExpressionWithIdentified);

/**
 * Checks if a function node has the filter parameter (4th parameter).
 * CollectionDispatcher signature: (context, identifier, cursor, filter?) => ...
 */
const hasFilterParameter = (fn: FunctionNode): boolean => {
  // Filter is the 4th parameter (index 3)
  return fn.params.length >= 4;
};

/**
 * Lint rule: collection-filtering-not-implemented
 *
 * Warns when setFollowersDispatcher doesn't implement filtering.
 * The followers dispatcher should accept a 4th parameter (filter/baseUri) to support
 * server-side filtering for followers collection synchronization.
 * See: https://fedify.dev/manual/collections#filtering-by-server
 *
 * @example Good:
 * ```ts
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
 * ```ts
 * federation.setFollowersDispatcher(
 *   "/users/{identifier}/followers",
 *   async (ctx, identifier, cursor) => {
 *     // No filter parameter - will cause warning
 *     return { items: [] };
 *   }
 * );
 * ```
 */
const collectionFilteringNotImplementedRule: Deno.lint.Rule = {
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

export default collectionFilteringNotImplementedRule;
