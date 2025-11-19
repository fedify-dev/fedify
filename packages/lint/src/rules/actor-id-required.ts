import { filter, isNil, isObject, pipe, some } from "@fxts/core";
import { trackFederationVariables } from "../lib/tracker.ts";

export const ACTOR_ID_REQUIRED = "actor-id-required" as const;

const actorIdRequired: Deno.lint.Rule = {
  create(context) {
    const tracker = trackFederationVariables();

    return {
      VariableDeclarator: tracker.VariableDeclarator,

      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "setActorDispatcher" &&
          node.arguments.length >= 2
        ) {
          if (!tracker.isFederationObject(node.callee.object)) return;

          const dispatcherArg = node.arguments[1];

          if (
            dispatcherArg.type === "ArrowFunctionExpression" ||
            dispatcherArg.type === "FunctionExpression"
          ) {
            const hasIdProperty = checkForIdProperty(dispatcherArg.body);

            if (!hasIdProperty) {
              context.report({
                node: dispatcherArg,
                message:
                  "Actor dispatcher must return an actor with an `id` property. Use `Context.getActorUri(identifier)` to set it.",
              });
            }
          }
        }
      },
    };
  },
};

export default actorIdRequired;

function hasIdProperty(prop: unknown): boolean {
  if (!isObject(prop) || isNil(prop)) return false;
  const p = prop as Record<string, unknown>;
  const key = p.key as Record<string, unknown>;
  return p.type === "Property" &&
    key.type === "Identifier" &&
    key.name === "id";
}

function checkObjectExpression(obj: Record<string, unknown>): boolean {
  if (!Array.isArray(obj.properties)) return false;
  return pipe(
    obj.properties,
    filter(isObject),
    filter((p): p is Record<string, unknown> => !isNil(p)),
    some(hasIdProperty),
  );
}

function checkReturnStatement(n: Record<string, unknown>): boolean {
  if (!n.argument) return false;
  const arg = n.argument as Record<string, unknown>;

  if (
    arg.type === "NewExpression" && Array.isArray(arg.arguments) &&
    arg.arguments.length > 0
  ) {
    const objArg = arg.arguments[0] as Record<string, unknown>;
    if (objArg.type === "ObjectExpression") {
      return checkObjectExpression(objArg);
    }
  }

  if (arg.type === "ObjectExpression") {
    return checkObjectExpression(arg);
  }

  return false;
}

function checkForIdProperty(node: unknown): boolean {
  if (!isObject(node) || isNil(node)) return false;
  const n = node as Record<string, unknown>;

  if (n.type === "ReturnStatement") {
    return checkReturnStatement(n);
  }

  if (n.type === "BlockStatement" && Array.isArray(n.body)) {
    return pipe(
      n.body,
      some(checkForIdProperty),
    );
  }

  return false;
}
