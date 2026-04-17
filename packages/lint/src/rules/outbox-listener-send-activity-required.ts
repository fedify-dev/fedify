import type { Rule } from "eslint";
import {
  hasIdentifierProperty,
  hasMemberExpressionCallee,
  hasMethodName,
  isFunction,
} from "../lib/pred.ts";
import { trackFederationVariables } from "../lib/tracker.ts";
import type { CallExpression, Expression, FunctionNode } from "../lib/types.ts";

const MESSAGE = "Outbox listeners should call ctx.sendActivity() explicitly.";

const isChainedFromOutboxListeners = (
  expr: Expression,
  federationTracker: ReturnType<typeof trackFederationVariables>,
): boolean => {
  if (expr.type !== "CallExpression") return false;
  if (!hasMemberExpressionCallee(expr) || !hasIdentifierProperty(expr)) {
    return false;
  }
  const methodName = expr.callee.property.name;
  if (methodName === "setOutboxListeners") {
    return federationTracker.isFederationObject(expr.callee.object);
  }
  if (
    methodName === "authorize" || methodName === "onError" ||
    methodName === "on"
  ) {
    return isChainedFromOutboxListeners(expr.callee.object, federationTracker);
  }
  return false;
};

const listenerCallsSendActivity = (
  sourceCode: { getText(node: unknown): string },
  listener: FunctionNode,
): boolean => sourceCode.getText(listener).includes(".sendActivity(");

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
    const sourceCode =
      (context as { sourceCode: { getText(node: unknown): string } })
        .sourceCode;

    return {
      VariableDeclarator: federationTracker.VariableDeclarator,

      CallExpression(node: CallExpression): void {
        if (
          !hasMemberExpressionCallee(node) ||
          !hasIdentifierProperty(node) ||
          !hasMethodName("on")(node) ||
          node.arguments.length < 2
        ) {
          return;
        }
        if (
          !isChainedFromOutboxListeners(node.callee.object, federationTracker)
        ) {
          return;
        }

        const listener = node.arguments[1];
        if (!isFunction(listener)) return;

        if (listenerCallsSendActivity(sourceCode, listener)) return;

        (context as { report: (arg: unknown) => void }).report({
          node: listener,
          ...buildReport,
        });
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
      description: "Warn when an outbox listener omits ctx.sendActivity()",
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
