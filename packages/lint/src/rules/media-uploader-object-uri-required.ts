import type { Rule } from "eslint";
import {
  hasIdentifierProperty,
  hasMemberExpressionCallee,
  hasMethodName,
  isFunction,
  isNode,
} from "../lib/pred.ts";
import { trackFederationVariables } from "../lib/tracker.ts";
import type {
  AssignmentPattern,
  CallExpression,
  Expression,
  FunctionNode,
  Identifier,
  Node,
  VariableDeclarator,
} from "../lib/types.ts";

const MESSAGE =
  "setMediaUploader() callbacks should return a value derived from " +
  "ctx.getObjectUri(): either return ctx.getObjectUri(...) directly, or an " +
  "object whose id is ctx.getObjectUri(...).";

const GETTER_NAME = "getObjectUri";

type FunctionLikeNode =
  | FunctionNode
  | (Node & {
    type: "FunctionDeclaration";
    id: Identifier | null;
    params: unknown[];
    body: unknown;
  });

const getMemberPropertyName = (node: Node): string | null => {
  if (node.type !== "MemberExpression") return null;
  const property = node.property as Node;
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }
  return null;
};

function unwrapAssignmentPattern(node: Node | undefined): Node | null {
  let current: Node | null = node ?? null;
  while (current?.type === "AssignmentPattern") {
    current = (current as AssignmentPattern).left as Node;
  }
  return current;
}

/**
 * Resolves the callback argument to a function node, following simple bindings
 * when the callback is passed by reference (identifier or object member).
 */
const resolveCallbackReference = (
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
      return resolveCallbackReference(binding, bindings, seen);
    }
    return null;
  }
  // Object-member reference, e.g. `setMediaUploader(path, uploaders.image)`.
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

/**
 * Analyzes the callback's context parameter: its identifier name (used to
 * require that `getObjectUri()` member calls are made on the context itself,
 * not some other object), and the names under which `getObjectUri` is
 * destructured out of it (`({ getObjectUri }) => ...`), so a bare
 * `getObjectUri(...)` call counts as deriving from the context method.
 */
function analyzeContextParam(
  callback: FunctionLikeNode,
): { ctxName: string | null; aliases: Set<string> } {
  const aliases = new Set<string>();
  const contextParam = unwrapAssignmentPattern(
    callback.params[0] as Node | undefined,
  );
  if (contextParam?.type === "Identifier") {
    return { ctxName: contextParam.name, aliases };
  }
  if (contextParam?.type === "ObjectPattern") {
    for (const prop of contextParam.properties) {
      if (!isNode(prop) || prop.type !== "Property") continue;
      const keyName = prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal" && typeof prop.key.value === "string"
        ? prop.key.value
        : null;
      if (keyName !== GETTER_NAME) continue;
      const value = prop.value as Node;
      if (value.type === "Identifier") aliases.add(value.name);
      else if (
        value.type === "AssignmentPattern" && value.left.type === "Identifier"
      ) {
        aliases.add(value.left.name);
      }
    }
  }
  return { ctxName: null, aliases };
}

const FUNCTION_NODE_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * Collects `const`/`let`/`var name = init` bindings declared inside the
 * callback body (excluding nested functions), so an identifier used in a
 * returned expression can be resolved back to the expression it was assigned.
 */
function collectLocalBindings(
  node: unknown,
  bindings: Map<string, unknown>,
): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectLocalBindings(child, bindings);
    return;
  }
  const n = node as Record<string, unknown> & { type?: string };
  if (typeof n.type !== "string") return;
  if (FUNCTION_NODE_TYPES.has(n.type)) return; // separate scope
  if (n.type === "VariableDeclarator") {
    const id = n.id as Node | undefined;
    if (
      id != null && isNode(id) && id.type === "Identifier" && n.init != null
    ) {
      if (!bindings.has(id.name)) bindings.set(id.name, n.init);
    }
  }
  for (const key in n) {
    if (key === "parent") continue;
    collectLocalBindings(n[key], bindings);
  }
}

/**
 * Collects the returned expressions of the callback: the argument of every
 * `return` statement (excluding nested functions), or, for an
 * expression-bodied arrow, the body expression itself.  A bare `return;`
 * contributes `null`.
 */
function collectReturnedExpressions(callback: FunctionLikeNode): unknown[] {
  const body = callback.body;
  if (body != null && isNode(body) && body.type !== "BlockStatement") {
    return [body];
  }
  const result: unknown[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const n = node as Record<string, unknown> & { type?: string };
    if (typeof n.type !== "string") return;
    if (n.type === "ReturnStatement") {
      result.push(n.argument ?? null);
      return;
    }
    if (FUNCTION_NODE_TYPES.has(n.type)) return; // separate scope
    for (const key in n) {
      if (key === "parent") continue;
      walk(n[key]);
    }
  };
  walk(body);
  return result;
}

type AnyNode = Record<string, unknown> & { type: string };

function toNode(value: unknown): AnyNode | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const n = value as Record<string, unknown>;
  return typeof n.type === "string" ? (n as AnyNode) : null;
}

/** Strips wrapper expressions that do not change the underlying value. */
function unwrapExpression(value: unknown): AnyNode | null {
  let current = toNode(value);
  while (current != null) {
    if (current.type === "AwaitExpression") current = toNode(current.argument);
    else if (
      current.type === "TSAsExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "TSSatisfiesExpression"
    ) current = toNode(current.expression);
    else return current;
  }
  return null;
}

/** Whether the expression is a `<ctx>.getObjectUri(...)` or alias call. */
interface DeriveContext {
  /** The callback's context parameter name, or `null` when destructured. */
  ctxName: string | null;
  /** Names `getObjectUri` is destructured to (`({ getObjectUri }) => ...`). */
  aliases: Set<string>;
  /** `const`/`let`/`var` bindings declared inside the callback body. */
  bindings: Map<string, unknown>;
}

/**
 * Whether the expression is a call to `getObjectUri()` on the context: a member
 * call `<ctx>.getObjectUri(...)` whose receiver is the context parameter, or a
 * bare call to a name `getObjectUri` was destructured to.  A member call on any
 * other object (e.g. `helper.getObjectUri(...)`) does not count.
 */
function isGetObjectUriCall(expr: AnyNode, ctx: DeriveContext): boolean {
  if (expr.type !== "CallExpression") return false;
  const callee = toNode(expr.callee);
  if (callee == null) return false;
  if (
    callee.type === "MemberExpression" &&
    getMemberPropertyName(callee as unknown as Node) === GETTER_NAME
  ) {
    if (ctx.ctxName == null) return false;
    const object = unwrapExpression(callee.object);
    return object != null && object.type === "Identifier" &&
      object.name === ctx.ctxName;
  }
  return callee.type === "Identifier" && typeof callee.name === "string" &&
    ctx.aliases.has(callee.name);
}

function isUrlConstructor(expr: AnyNode): boolean {
  const callee = toNode(expr.callee);
  return callee != null && callee.type === "Identifier" &&
    callee.name === "URL";
}

/** Finds the first `ObjectExpression` argument of a `NewExpression`. */
function extractObjectArg(newExpr: AnyNode): AnyNode | null {
  const args = newExpr.arguments;
  if (!Array.isArray(args)) return null;
  for (const arg of args) {
    const a = toNode(arg);
    if (a != null && a.type === "ObjectExpression") return a;
  }
  return null;
}

/**
 * Whether a URL-valued expression is derived from `getObjectUri()`: a direct
 * call, an identifier whose local binding resolves to one
 * (`const uri = ctx.getObjectUri(...); return uri`), both branches of a
 * ternary, or `new URL(<derived>)`.
 */
function urlDerivesFromGetObjectUri(
  value: unknown,
  ctx: DeriveContext,
  seen: ReadonlySet<string>,
): boolean {
  const expr = unwrapExpression(value);
  if (expr == null) return false;
  if (isGetObjectUriCall(expr, ctx)) return true;
  if (expr.type === "Identifier") {
    const name = expr.name;
    if (typeof name === "string" && ctx.bindings.has(name) && !seen.has(name)) {
      return urlDerivesFromGetObjectUri(
        ctx.bindings.get(name),
        ctx,
        new Set(seen).add(name),
      );
    }
    return false;
  }
  if (expr.type === "ConditionalExpression") {
    return urlDerivesFromGetObjectUri(expr.consequent, ctx, seen) &&
      urlDerivesFromGetObjectUri(expr.alternate, ctx, seen);
  }
  if (expr.type === "NewExpression" && isUrlConstructor(expr)) {
    const args = expr.arguments;
    return Array.isArray(args) && args.length > 0 &&
      urlDerivesFromGetObjectUri(args[0], ctx, seen);
  }
  return false;
}

const SPREAD_TYPES = new Set([
  "SpreadElement",
  "SpreadProperty",
  "ExperimentalSpreadProperty",
]);

/**
 * Whether an object literal's *effective* own `id` is derived from
 * `getObjectUri`.  Properties are evaluated in order so a later duplicate `id`
 * wins, and a spread or computed key appearing after the last static `id`
 * (which could override it) is treated as unsafe.  An object with no static
 * `id` property (its `id` might come from an unresolved spread) is also
 * unsafe.
 */
function objectIdDerivesFromGetObjectUri(
  objExpr: AnyNode,
  ctx: DeriveContext,
  seen: ReadonlySet<string>,
): boolean {
  const props = objExpr.properties;
  if (!Array.isArray(props)) return false;
  let idValue: unknown;
  let idIsSet = false;
  let overridableAfterId = false;
  for (const prop of props) {
    const p = toNode(prop);
    if (p == null) return false;
    // A spread or a computed key could introduce or override `id`; if one
    // follows the last static `id`, we cannot prove the effective `id`.
    if (
      SPREAD_TYPES.has(p.type) ||
      (p.type === "Property" && p.computed === true)
    ) {
      if (idIsSet) overridableAfterId = true;
      continue;
    }
    if (p.type !== "Property") continue;
    const key = toNode(p.key);
    const keyName = key == null
      ? null
      : key.type === "Identifier" && typeof key.name === "string"
      ? key.name
      : key.type === "Literal" && typeof key.value === "string"
      ? key.value
      : null;
    if (keyName !== "id") continue;
    // For shorthand `{ id }`, `p.value` is the identifier `id`, which the
    // binding resolution in urlDerivesFromGetObjectUri follows.
    idValue = p.value;
    idIsSet = true;
    overridableAfterId = false;
  }
  if (!idIsSet || overridableAfterId) return false;
  return urlDerivesFromGetObjectUri(idValue, ctx, seen);
}

/**
 * Whether a single returned expression is valid: a URL derived from
 * `getObjectUri()`, or an object whose own `id` is derived from it.  An object
 * is judged solely by its `id`, so `getObjectUri()` appearing in another
 * property (e.g. `url`) does not excuse a hard-coded `id`.
 */
function returnDerivesFromGetObjectUri(
  value: unknown,
  ctx: DeriveContext,
  seen: ReadonlySet<string>,
): boolean {
  const expr = unwrapExpression(value);
  if (expr == null) return false;
  if (expr.type === "Identifier") {
    const name = expr.name;
    if (typeof name === "string" && ctx.bindings.has(name) && !seen.has(name)) {
      return returnDerivesFromGetObjectUri(
        ctx.bindings.get(name),
        ctx,
        new Set(seen).add(name),
      );
    }
    return false;
  }
  if (expr.type === "ConditionalExpression") {
    return returnDerivesFromGetObjectUri(expr.consequent, ctx, seen) &&
      returnDerivesFromGetObjectUri(expr.alternate, ctx, seen);
  }
  if (expr.type === "ObjectExpression") {
    return objectIdDerivesFromGetObjectUri(expr, ctx, seen);
  }
  if (expr.type === "NewExpression") {
    if (isUrlConstructor(expr)) {
      return urlDerivesFromGetObjectUri(expr, ctx, seen);
    }
    const objArg = extractObjectArg(expr);
    // `new Image(someVariable)` cannot be verified statically; require the
    // object literal so the `id` can be inspected.
    if (objArg == null) return false;
    return objectIdDerivesFromGetObjectUri(objArg, ctx, seen);
  }
  return urlDerivesFromGetObjectUri(expr, ctx, seen);
}

/**
 * Determines whether every returned value of the callback is derived from
 * `getObjectUri`.  Returns `false` when the callback has no return value or any
 * returned value is not derived from `getObjectUri`.
 */
function callbackDerivesFromGetObjectUri(callback: FunctionLikeNode): boolean {
  const returnedExpressions = collectReturnedExpressions(callback);
  if (returnedExpressions.length < 1) return false;
  const { ctxName, aliases } = analyzeContextParam(callback);
  const bindings = new Map<string, unknown>();
  collectLocalBindings(callback.body, bindings);
  const ctx: DeriveContext = { ctxName, aliases, bindings };
  return returnedExpressions.every((expr) =>
    returnDerivesFromGetObjectUri(expr, ctx, new Set())
  );
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
    const bindings = new Map<string, unknown>();
    const pendingCalls: CallExpression[] = [];

    const inspectCall = (node: CallExpression): void => {
      if (
        !hasMemberExpressionCallee(node) ||
        !hasIdentifierProperty(node) ||
        !hasMethodName("setMediaUploader")(node) ||
        node.arguments.length < 2
      ) {
        return;
      }
      if (!federationTracker.isFederationObject(node.callee.object)) return;

      const callbackArg = node.arguments[1] as unknown;
      const callback =
        isNode(callbackArg) && isFunction(callbackArg as Expression)
          ? callbackArg as FunctionLikeNode
          : isNode(callbackArg)
          ? resolveCallbackReference(callbackArg as Expression, bindings)
          : null;
      if (callback == null) return;

      if (callbackDerivesFromGetObjectUri(callback)) return;

      (context as { report: (arg: unknown) => void }).report({
        node: callback,
        ...buildReport,
      });
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
        "Warn when a setMediaUploader() callback does not derive its return " +
        "value from ctx.getObjectUri()",
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
