import type { Rule } from "eslint";
import {
  hasIdentifierProperty,
  hasMemberExpressionCallee,
  hasMethodName,
  isNode,
} from "../lib/pred.ts";
import { trackFederationVariables } from "../lib/tracker.ts";
import type { CallExpression, Node } from "../lib/types.ts";

const MESSAGE =
  "setMediaUploader() should be protected with .authorize(); without it the " +
  "endpoint accepts uploads from anyone who can reach the URL.  Add " +
  ".authorize() unless a public upload endpoint is intended.";

function getParent(node: unknown): Node | null {
  if (node == null || typeof node !== "object") return null;
  const parent = (node as { parent?: unknown }).parent;
  return isNode(parent) ? parent : null;
}

/**
 * Whether the given `setMediaUploader(...)` call is directly chained with
 * `.authorize(...)`, i.e. `federation.setMediaUploader(...).authorize(...)`.
 */
function isDirectlyAuthorized(callNode: CallExpression): boolean {
  const member = getParent(callNode);
  if (
    member == null || member.type !== "MemberExpression" ||
    (member as { computed?: boolean }).computed === true
  ) {
    return false;
  }
  const property = (member as { property?: unknown }).property;
  if (
    !isNode(property) || property.type !== "Identifier" ||
    (property as { name?: unknown }).name !== "authorize"
  ) {
    return false;
  }
  const call = getParent(member);
  return call != null && call.type === "CallExpression" &&
    (call as { callee?: unknown }).callee === member;
}

function createRule<Context = Deno.lint.RuleContext | Rule.RuleContext>(
  buildReport: Context extends Deno.lint.RuleContext ? {
      message: string;
    }
    : {
      messageId: string;
      data: { message: string };
    },
) {
  return (context: Context) => {
    const federationTracker = trackFederationVariables();
    // setMediaUploader() calls not directly chained with .authorize(), paired
    // with the variable they are assigned to (if any) for the stored-setter
    // case `const s = federation.setMediaUploader(...); s.authorize(...)`.
    const unchained: { node: CallExpression; varName: string | null }[] = [];
    // Identifier names on which `.authorize(...)` is called.
    const authorizedVars = new Set<string>();

    return {
      VariableDeclarator: federationTracker.VariableDeclarator,

      CallExpression(node: CallExpression): void {
        if (
          hasMemberExpressionCallee(node) && hasIdentifierProperty(node) &&
          hasMethodName("authorize")(node)
        ) {
          const object = node.callee.object;
          if (isNode(object) && object.type === "Identifier") {
            authorizedVars.add((object as { name: string }).name);
          }
          return;
        }
        if (
          !hasMemberExpressionCallee(node) || !hasIdentifierProperty(node) ||
          !hasMethodName("setMediaUploader")(node) ||
          !federationTracker.isFederationObject(node.callee.object)
        ) {
          return;
        }
        if (isDirectlyAuthorized(node)) return;
        const parent = getParent(node);
        let varName: string | null = null;
        if (parent != null && parent.type === "VariableDeclarator") {
          const id = (parent as { id?: unknown }).id;
          if (isNode(id) && id.type === "Identifier") {
            varName = (id as { name: string }).name;
          }
        }
        unchained.push({ node, varName });
      },

      "Program:exit"(): void {
        for (const { node, varName } of unchained) {
          if (varName != null && authorizedVars.has(varName)) continue;
          (context as { report: (arg: unknown) => void }).report({
            node,
            ...buildReport,
          });
        }
      },
    };
  };
}

export const deno: Deno.lint.Rule = {
  create: createRule({ message: MESSAGE }),
};

export const eslint: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn when setMediaUploader() is registered without an authorize() " +
        "hook",
    },
    schema: [],
    messages: {
      required: "{{ message }}",
    },
  },
  create: createRule({
    messageId: "required",
    data: { message: MESSAGE },
  }),
};
