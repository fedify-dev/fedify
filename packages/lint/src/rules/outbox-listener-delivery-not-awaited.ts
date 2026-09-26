import type { Rule } from "eslint";
import {
  createOutboxListenerVisitor,
  DELIVERY_METHOD_NAMES,
  unwrapContextParam,
} from "../lib/outbox-listener.ts";
import { isNode } from "../lib/pred.ts";
import {
  collectReferencedNames,
  type FunctionLikeNode,
  getAssignmentTargetName,
  isFunctionLikeNode,
  type UsedScope,
  walkUsedScopes,
} from "../lib/reachability.ts";
import type { CallExpression, Node } from "../lib/types.ts";

const MESSAGE =
  "Delivery is not awaited, so the activity may be lost once the handler returns (for example on Cloudflare Workers). Await it, return it, or pass it to waitUntil().";

/**
 * What becomes of the promise a delivery call returns:
 *
 *  -  `"dropped"`: nothing keeps hold of it, which is what the rule reports.
 *  -  `"awaited"`: it reaches an `await`.
 *  -  `"returned"`: it is handed back to whoever called the function.
 *  -  `"handled"`: it is opted out of (`void`), owned by the runtime
 *     (`waitUntil()`), used somewhere the rule cannot follow, or stored in a
 *     variable that is mentioned again. The rule stays quiet.
 */
type Fate = "dropped" | "awaited" | "returned" | "handled";

/** Wrappers that pass a value through unchanged. */
const TRANSPARENT_WRAPPERS = new Set([
  "ChainExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
]);

/** `Promise` methods that settle once every promise they are given has. */
const PROMISE_COMBINATORS = new Set(["all", "allSettled", "race", "any"]);

/** Methods on a promise that return a new promise carrying the chain on. */
const PROMISE_CHAIN_METHODS = new Set(["then", "catch", "finally"]);

/**
 * Methods whose own result is what a callback's return value ends up in, so
 * a promise a callback returns is only as safe as that result is.
 */
const CALLBACK_RESULT_METHODS = new Set([
  "map",
  "flatMap",
  ...PROMISE_CHAIN_METHODS,
]);

const get = (node: Node | null | undefined, key: string): unknown =>
  node == null ? undefined : (node as unknown as Record<string, unknown>)[key];

const asNode = (value: unknown): Node | null =>
  isNode(value) ? value as Node : null;

const parentOf = (node: Node): Node | null => asNode(get(node, "parent"));

function unwrap(node: Node): Node {
  let current = node;
  while (TRANSPARENT_WRAPPERS.has(current.type)) {
    const inner = asNode(get(current, "expression"));
    if (inner == null) break;
    current = inner;
  }
  return current;
}

/** The name a member expression accesses, when it is spelled out plainly. */
function memberName(node: Node): string | null {
  if (node.type !== "MemberExpression") return null;
  const property = asNode(get(node, "property"));
  if (property == null) return null;
  if (get(node, "computed") !== true) {
    return property.type === "Identifier" ? property.name : null;
  }
  if (property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }
  if (property.type === "TemplateLiteral") {
    const quasis = get(property, "quasis") as { value: { cooked?: string } }[];
    const expressions = get(property, "expressions") as unknown[];
    if (expressions.length === 0 && quasis.length === 1) {
      return quasis[0].value.cooked ?? null;
    }
  }
  return null;
}

function visitAll(node: unknown, visitor: (node: Node) => void): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) visitAll(item, visitor);
    return;
  }
  if (!isNode(node)) return;
  visitor(node as Node);
  const record = node as unknown as Record<string, unknown>;
  for (const key in record) {
    if (key !== "parent") visitAll(record[key], visitor);
  }
}

/** Collects the calls in `node` that run in the same function, not in one nested in it. */
function collectCalls(node: unknown, out: CallExpression[]): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectCalls(item, out);
    return;
  }
  if (!isNode(node)) return;
  const n = node as Node;
  if (isFunctionLikeNode(n)) return;
  if (n.type === "CallExpression") out.push(n as CallExpression);
  const record = n as unknown as Record<string, unknown>;
  for (const key in record) {
    if (key !== "parent") collectCalls(record[key], out);
  }
}

function enclosingFunction(node: Node): FunctionLikeNode | null {
  for (let current = parentOf(node); current != null;) {
    if (isFunctionLikeNode(current)) return current;
    current = parentOf(current);
  }
  return null;
}

/** The names an object pattern binds the delivery methods to. */
function deliveryAliasesOf(pattern: Node, out: Set<string>): void {
  if (pattern.type !== "ObjectPattern") return;
  for (const prop of get(pattern, "properties") as Node[]) {
    if (prop.type !== "Property") continue;
    const key = asNode(get(prop, "key"));
    const keyName = key?.type === "Identifier"
      ? key.name
      : key?.type === "Literal" && typeof key.value === "string"
      ? key.value
      : null;
    if (keyName == null || !DELIVERY_METHOD_NAMES.has(keyName)) continue;
    const value = asNode(get(prop, "value"));
    if (value?.type === "Identifier") out.add(value.name);
    else if (value?.type === "AssignmentPattern") {
      const left = asNode(get(value, "left"));
      if (left?.type === "Identifier") out.add(left.name);
    }
  }
}

type DeliveryTargets = {
  contextName: string | null;
  aliases: Set<string>;
};

/**
 * Works out how the listener refers to the delivery methods: through its
 * context parameter (`ctx.sendActivity`), or through a name bound to one of
 * them, either in the parameter (`{ sendActivity }`) or in the body
 * (`const { sendActivity } = ctx`, `const send = ctx.sendActivity`).
 */
function findDeliveryTargets(listener: FunctionLikeNode): DeliveryTargets {
  const aliases = new Set<string>();
  const contextParam = unwrapContextParam(
    listener.params[0] as Node | undefined,
  );
  const contextName = contextParam?.type === "Identifier"
    ? contextParam.name
    : null;
  if (contextParam != null) deliveryAliasesOf(contextParam, aliases);

  if (contextName != null) {
    visitAll(listener.body, (node) => {
      if (node.type !== "VariableDeclarator") return;
      const id = asNode(get(node, "id"));
      const init = asNode(get(node, "init"));
      if (id == null || init == null) return;
      const source = unwrap(init);
      if (source.type === "Identifier" && source.name === contextName) {
        deliveryAliasesOf(id, aliases);
        return;
      }
      if (id.type !== "Identifier" || source.type !== "MemberExpression") {
        return;
      }
      const object = unwrap(asNode(get(source, "object")) ?? source);
      const name = memberName(source);
      if (
        object.type === "Identifier" && object.name === contextName &&
        name != null && DELIVERY_METHOD_NAMES.has(name)
      ) {
        aliases.add(id.name);
      }
    });
  }
  return { contextName, aliases };
}

type Analysis = {
  listener: FunctionLikeNode;
  /** Every name mentioned anywhere in the listener, nested functions included. */
  mentioned: ReadonlySet<string>;
};

/** Where the promise a function returns goes, given who calls the function. */
function returnedFate(
  fn: FunctionLikeNode | null,
  analysis: Analysis,
): Fate {
  if (fn == null) return "handled";
  if (fn === analysis.listener) return "returned";
  const parent = parentOf(fn);
  if (parent?.type === "CallExpression") {
    // An immediately invoked function returns to the call itself.
    if (get(parent, "callee") === fn) return fateOf(parent, analysis);
    const args = get(parent, "arguments") as unknown[];
    if (args.includes(fn)) {
      const callee = unwrap(asNode(get(parent, "callee")) ?? parent);
      const name = memberName(callee);
      // `forEach()` discards what its callback returns, which is the one
      // callback consumer the rule knows for certain. An unknown one, such
      // as `setTimeout()`, may well keep it.
      if (name === "forEach") return "dropped";
      if (name != null && CALLBACK_RESULT_METHODS.has(name)) {
        return fateOf(parent, analysis);
      }
      return "handled";
    }
  }
  // A function declared or held under a name hands the promise to its
  // callers, who are judged at each call.
  return "returned";
}

/** Follows the value of `expression` up through its parents to where it ends up. */
function fateOf(expression: Node, analysis: Analysis): Fate {
  let current = expression;
  for (;;) {
    const parent = parentOf(current);
    if (parent == null) return "handled";

    if (TRANSPARENT_WRAPPERS.has(parent.type)) {
      current = parent;
      continue;
    }

    switch (parent.type) {
      case "AwaitExpression":
        return "awaited";

      case "ReturnStatement":
        return returnedFate(enclosingFunction(parent), analysis);

      case "ArrowFunctionExpression":
        return get(parent, "body") === current
          ? returnedFate(parent as FunctionLikeNode, analysis)
          : "handled";

      case "ExpressionStatement":
        return "dropped";

      // `void` is the way to say a promise is deliberately not awaited, and
      // any other operator uses the value somewhere the rule cannot follow.
      case "UnaryExpression":
        return "handled";

      case "SequenceExpression": {
        const expressions = get(parent, "expressions") as Node[];
        if (expressions[expressions.length - 1] !== current) return "dropped";
        current = parent;
        continue;
      }

      case "ConditionalExpression":
        if (get(parent, "test") === current) return "handled";
        current = parent;
        continue;

      case "LogicalExpression":
      case "ArrayExpression":
      case "SpreadElement":
      case "Property":
      case "ObjectExpression":
        current = parent;
        continue;

      case "MemberExpression": {
        if (get(parent, "object") !== current) return "handled";
        const call = parentOf(parent);
        const name = memberName(parent);
        if (
          call?.type === "CallExpression" && get(call, "callee") === parent &&
          name != null && PROMISE_CHAIN_METHODS.has(name)
        ) {
          current = call;
          continue;
        }
        return "handled";
      }

      case "CallExpression": {
        if (get(parent, "callee") === current) return "handled";
        const callee = unwrap(asNode(get(parent, "callee")) ?? parent);
        const name = memberName(callee);
        if (name === "waitUntil") return "handled";
        const object = callee.type === "MemberExpression"
          ? unwrap(asNode(get(callee, "object")) ?? callee)
          : null;
        if (
          object?.type === "Identifier" && object.name === "Promise" &&
          name != null && PROMISE_COMBINATORS.has(name)
        ) {
          current = parent;
          continue;
        }
        return "handled";
      }

      // A promise kept in a variable is safe when the variable is used
      // anywhere else; when nothing ever mentions it again it is forgotten.
      case "VariableDeclarator": {
        const id = asNode(get(parent, "id"));
        if (get(parent, "init") !== current || id?.type !== "Identifier") {
          return "handled";
        }
        return analysis.mentioned.has(id.name) ? "handled" : "dropped";
      }

      case "AssignmentExpression": {
        if (get(parent, "right") !== current) return "handled";
        const name = getAssignmentTargetName(
          asNode(get(parent, "left")) ?? parent,
        );
        if (name == null) return "handled";
        return analysis.mentioned.has(name) ? "handled" : "dropped";
      }

      default:
        return "handled";
    }
  }
}

/** Reports every delivery call in `listener` whose promise is dropped. */
function checkListener(
  listener: FunctionLikeNode,
  report: (node: Node) => void,
): void {
  const targets = findDeliveryTargets(listener);
  if (targets.contextName == null && targets.aliases.size === 0) return;

  const isDeliveryCall = (call: CallExpression): boolean => {
    const callee = unwrap(call.callee as Node);
    if (callee.type === "MemberExpression") {
      const name = memberName(callee);
      if (name == null || !DELIVERY_METHOD_NAMES.has(name)) return false;
      const object = unwrap(asNode(get(callee, "object")) ?? callee);
      return object.type === "Identifier" &&
        object.name === targets.contextName;
    }
    return callee.type === "Identifier" && targets.aliases.has(callee.name);
  };

  const mentioned = new Set<string>();
  collectReferencedNames(listener.body, mentioned, true);
  const analysis: Analysis = { listener, mentioned };

  const scopes: UsedScope[] = [];
  walkUsedScopes(listener.body as Node, (scope) => scopes.push(scope));
  const callsByScope = scopes.map((scope) => {
    const calls: CallExpression[] = [];
    for (const statement of scope.statements) collectCalls(statement, calls);
    return calls;
  });

  // A local helper that delivers and hands its promise back, by awaiting the
  // delivery or by returning it, is only as safe as the way it is called.
  const carrying = new Set<FunctionLikeNode>();
  const carriesDelivery = (call: CallExpression, scope: UsedScope): boolean => {
    if (isDeliveryCall(call)) return true;
    const callee = unwrap(call.callee as Node);
    if (callee.type !== "Identifier") return false;
    const helpers = scope.functionsByName.get(callee.name);
    return helpers?.some((helper) => carrying.has(helper)) ?? false;
  };
  for (let changed = true; changed;) {
    changed = false;
    scopes.forEach((scope, index) => {
      const fn = scope.fn;
      if (fn == null || carrying.has(fn)) return;
      for (const call of callsByScope[index]) {
        if (!carriesDelivery(call, scope)) continue;
        const fate = fateOf(call, analysis);
        if (fate === "awaited" || fate === "returned") {
          carrying.add(fn);
          changed = true;
          return;
        }
      }
    });
  }

  const reported = new Set<Node>();
  scopes.forEach((scope, index) => {
    for (const call of callsByScope[index]) {
      if (reported.has(call) || !carriesDelivery(call, scope)) continue;
      if (fateOf(call, analysis) !== "dropped") continue;
      reported.add(call);
      report(call);
    }
  });
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
  return (context: Context) =>
    createOutboxListenerVisitor((listener) =>
      checkListener(listener, (node) => {
        (context as { report: (arg: unknown) => void }).report({
          node,
          ...buildReport,
        });
      })
    );
}

export const deno: Deno.lint.Rule = {
  create: createRule({ message: MESSAGE }),
};

export const eslint: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn when an outbox listener delivers an activity without awaiting it",
    },
    schema: [],
    messages: {
      notAwaited: "{{ message }}",
    },
  },
  create: createRule({
    messageId: "notAwaited",
    data: { message: MESSAGE },
  }),
};
