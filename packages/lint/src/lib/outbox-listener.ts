import {
  hasIdentifierProperty,
  hasMemberExpressionCallee,
  hasMethodName,
  isFunction,
  isNode,
} from "./pred.ts";
import type { FunctionLikeNode } from "./reachability.ts";
import { trackFederationVariables } from "./tracker.ts";
import type {
  AssignmentPattern,
  CallExpression,
  Expression,
  Identifier,
  Node,
  VariableDeclarator,
} from "./types.ts";

export const DELIVERY_METHOD_NAMES = new Set([
  "sendActivity",
  "forwardActivity",
]);

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

const getMemberPropertyName = (expr: Expression): string | null => {
  if (expr.type !== "MemberExpression") return null;
  const property = expr.property as Node;
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }
  return null;
};

export function unwrapContextParam(node: Node | undefined): Node | null {
  let current: Node | null = node ?? null;
  while (current?.type === "AssignmentPattern") {
    current = (current as AssignmentPattern).left as Node;
  }
  return current;
}

/**
 * Resolves an expression to the function it refers to: a direct function
 * literal, a local variable bound to one, or a property of a local object
 * literal bound to one (e.g. `handlers.deliver` where
 * `const handlers = { deliver() {} }`). Used to resolve a listener argument
 * (`.on(Activity, handler)`).
 */
const resolveFunctionBinding = (
  expr: Expression,
  bindings: Map<string, unknown>,
  seen = new Set<string>(),
): FunctionLikeNode | null => {
  if (isFunction(expr)) return expr;
  if (expr.type === "Identifier") {
    if (seen.has(expr.name)) return null;
    seen.add(expr.name);
    const binding = bindings.get(expr.name);
    if (binding == null || !isNode(binding)) return null;
    if (
      isFunction(binding as Expression) ||
      (binding as { type?: string }).type === "FunctionDeclaration"
    ) {
      return binding as FunctionLikeNode;
    }
    if (binding.type === "Identifier") {
      return resolveFunctionBinding(binding, bindings, seen);
    }
    return null;
  }
  if (
    expr.type === "MemberExpression" && expr.object.type === "Identifier" &&
    !expr.computed
  ) {
    const binding = bindings.get(expr.object.name);
    if (
      binding == null || !isNode(binding) || binding.type !== "ObjectExpression"
    ) {
      return null;
    }
    const propertyName = getMemberPropertyName(expr);
    if (propertyName == null) return null;
    for (const prop of binding.properties) {
      if (!isNode(prop) || prop.type !== "Property") continue;
      const keyName = prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal" && typeof prop.key.value === "string"
        ? prop.key.value
        : null;
      if (keyName !== propertyName || !isNode(prop.value)) continue;
      const value = prop.value as unknown;
      if (
        isFunction(value as Expression) ||
        (value as { type?: string }).type === "FunctionDeclaration"
      ) {
        return value as FunctionLikeNode;
      }
    }
  }
  return null;
};

type OutboxListenerVisitor = {
  VariableDeclarator(node: VariableDeclarator): void;
  FunctionDeclaration(
    node: Node & { type: "FunctionDeclaration"; id: Identifier | null },
  ): void;
  CallExpression(node: CallExpression): void;
  "Program:exit"(): void;
};

/**
 * Builds the visitor an outbox-listener rule registers: it follows
 * `federation.setOutboxListeners(...).on(Type, listener)` chains through the
 * file and, once the whole file has been seen, hands each listener, resolved
 * to its function, to `onListener`. The listener may be an inline function or
 * a name bound to one elsewhere in the file.
 */
export function createOutboxListenerVisitor(
  onListener: (listener: FunctionLikeNode) => void,
): OutboxListenerVisitor {
  const federationTracker = trackFederationVariables();
  const bindings = new Map<string, unknown>();
  const pendingCalls: CallExpression[] = [];

  const inspectCall = (node: CallExpression): void => {
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

    const listener = node.arguments[1] as unknown;
    const resolvedListener =
      isNode(listener) && isFunction(listener as Expression)
        ? listener as FunctionLikeNode
        : isNode(listener)
        ? resolveFunctionBinding(listener as Expression, bindings)
        : null;
    if (resolvedListener == null) return;

    onListener(resolvedListener);
  };

  return {
    VariableDeclarator(node: VariableDeclarator): void {
      federationTracker.VariableDeclarator(node);
      if (node.id.type === "Identifier" && node.init != null) {
        bindings.set(node.id.name, node.init);
      }
    },

    FunctionDeclaration(
      node: Node & {
        type: "FunctionDeclaration";
        id: Identifier | null;
      },
    ): void {
      if (node.id != null) bindings.set(node.id.name, node);
    },

    CallExpression(node: CallExpression): void {
      pendingCalls.push(node);
    },

    "Program:exit"(): void {
      for (const node of pendingCalls) inspectCall(node);
    },
  };
}
