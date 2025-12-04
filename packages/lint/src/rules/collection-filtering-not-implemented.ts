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
 * Collection dispatcher methods that support filtering.
 * These are the setXxxDispatcher methods for collections.
 */
const COLLECTION_DISPATCHER_METHODS = [
  "setFollowersDispatcher",
  "setFollowingDispatcher",
  "setOutboxDispatcher",
  "setLikedDispatcher",
  "setFeaturedDispatcher",
  "setFeaturedTagsDispatcher",
] as const;

/**
 * Checks if a node is a collection dispatcher call.
 */
const isCollectionDispatcherCall = (
  node: Deno.lint.CallExpression,
): node is Deno.lint.CallExpression & CallMemberExpressionWithIdentified =>
  allOf(
    hasMemberExpressionCallee,
    hasIdentifierProperty,
    hasMinArguments(2),
    (n: Deno.lint.CallExpression & CallMemberExpressionWithIdentified) =>
      COLLECTION_DISPATCHER_METHODS.some((method) => hasMethodName(method)(n)),
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
 * Warns when a collection dispatcher doesn't implement filtering.
 * Collection dispatchers should accept a 4th parameter (filter) to support
 * server-side filtering and avoid large response payloads.
 *
 * @example Good:
 * ```ts
 * federation.setFollowersDispatcher(
 *   "/users/{identifier}/followers",
 *   async (ctx, identifier, cursor, filter) => {
 *     // Implementation with filter support
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
        // Check if it's a collection dispatcher call on a federation object
        if (!isCollectionDispatcherCall(node)) return;
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
