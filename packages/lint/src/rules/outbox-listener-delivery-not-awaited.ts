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
 * What becomes of a promise the rule is following:
 *
 *  -  `"dropped"`: nothing keeps hold of it, which is what the rule reports.
 *  -  `"awaited"`: it reaches an `await`.
 *  -  `"returned"`: it is handed back to whoever called the function.
 *  -  `"handled"`: it is opted out of (`void`, `Promise.race()`), owned by the
 *     runtime (`waitUntil()`), used somewhere the rule cannot follow, or
 *     stored in a variable that is mentioned again. The rule stays quiet.
 */
type Fate = "dropped" | "awaited" | "returned" | "handled";

/**
 * A fate, with the function the promise ended up in when that is an `await`
 * or a `return`: the function that now carries the promise on to its own
 * callers.
 */
type Outcome = { fate: Fate; owner: FunctionLikeNode | null };

const HANDLED: Outcome = { fate: "handled", owner: null };
const DROPPED: Outcome = { fate: "dropped", owner: null };

/**
 * What the value being followed is. An array of promises, such as what
 * `map()` returns, waits for nothing until it reaches `Promise.all()` or one
 * of its siblings: awaiting or returning it leaves every promise in flight.
 */
type Shape = "promise" | "promises";

/** Wrappers that pass a value through unchanged. */
const TRANSPARENT_WRAPPERS = new Set([
  "ChainExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
]);

/**
 * `Promise` methods that turn promises into one promise. `race()` and
 * `any()` settle as soon as one input does, which is accepted as a
 * deliberate choice to stop waiting, like `void`. A `race()` or `any()`
 * that is itself dropped is still reported.
 */
const PROMISE_COMBINATORS = new Set(["all", "allSettled", "race", "any"]);

/** Methods on a promise that return a new promise carrying the chain on. */
const PROMISE_CHAIN_METHODS = new Set(["then", "catch", "finally"]);

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
    // ESTree keeps the text under `value`, and Deno.lint exposes it directly.
    const quasis = get(property, "quasis") as {
      cooked?: string;
      value?: { cooked?: string };
    }[];
    const expressions = get(property, "expressions") as unknown[];
    if (expressions.length === 0 && quasis.length === 1) {
      return quasis[0].cooked ?? quasis[0].value?.cooked ?? null;
    }
  }
  return null;
}

/** Visits every node in `node`, stopping at a nested function unless asked to cross it. */
function visitAll(
  node: unknown,
  visitor: (node: Node) => void,
  crossFunctions = true,
): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) visitAll(item, visitor, crossFunctions);
    return;
  }
  if (!isNode(node)) return;
  if (!crossFunctions && isFunctionLikeNode(node as Node)) return;
  visitor(node as Node);
  const record = node as unknown as Record<string, unknown>;
  for (const key in record) {
    if (key !== "parent") visitAll(record[key], visitor, crossFunctions);
  }
}

/** Collects the calls in `node` that run in the same function, not in one nested in it. */
function collectCalls(node: unknown, out: CallExpression[]): void {
  visitAll(node, (n) => {
    if (n.type === "CallExpression") out.push(n as CallExpression);
  }, false);
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
 * them, either in the parameter (`{ sendActivity }`) or in code that can run
 * (`const { sendActivity } = ctx`, `const send = ctx.sendActivity`). A name
 * bound in a helper nothing uses, or in a dead branch, does not count.
 */
function findDeliveryTargets(
  listener: FunctionLikeNode,
  scopes: readonly UsedScope[],
): DeliveryTargets {
  const aliases = new Set<string>();
  const contextParam = unwrapContextParam(
    listener.params[0] as Node | undefined,
  );
  const contextName = contextParam?.type === "Identifier"
    ? contextParam.name
    : null;
  if (contextParam != null) deliveryAliasesOf(contextParam, aliases);

  if (contextName != null) {
    for (const scope of scopes) {
      for (const statement of scope.statements) {
        visitAll(statement, (node) => {
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
        }, false);
      }
    }
  }
  return { contextName, aliases };
}

type Analysis = {
  listener: FunctionLikeNode;
  /** Every name mentioned anywhere in the listener, nested functions included. */
  mentioned: ReadonlySet<string>;
};

/**
 * Where the value a callback returns goes, judged by the call that receives
 * the callback.
 */
function callbackResultOutcome(call: Node, analysis: Analysis): Outcome {
  const callee = unwrap(asNode(get(call, "callee")) ?? call);
  const name = memberName(callee);
  // `forEach()` discards what its callback returns, which is the one callback
  // consumer the rule knows for certain. An unknown one, such as
  // `setTimeout()`, may well keep it.
  if (name === "forEach") return DROPPED;
  if (name === "map" || name === "flatMap") {
    return fateOf(call, analysis, "promises");
  }
  if (name != null && PROMISE_CHAIN_METHODS.has(name)) {
    return fateOf(call, analysis, "promise");
  }
  return HANDLED;
}

/** Where the promise a function returns goes, given who calls the function. */
function returnedOutcome(
  fn: FunctionLikeNode | null,
  analysis: Analysis,
): Outcome {
  if (fn == null) return HANDLED;
  if (fn === analysis.listener) return { fate: "returned", owner: fn };
  const parent = parentOf(fn);
  if (parent?.type === "CallExpression") {
    // An immediately invoked function returns to the call itself.
    if (get(parent, "callee") === fn) {
      return fateOf(parent, analysis, "promise");
    }
    if ((get(parent, "arguments") as unknown[]).includes(fn)) {
      return callbackResultOutcome(parent, analysis);
    }
  }
  // A function declared or held under a name hands the promise to its
  // callers, who are judged at each call.
  return { fate: "returned", owner: fn };
}

/**
 * Where an array of promises goes when it is returned. The listener's caller
 * does not wait for what is inside it. Any other function hands it to its
 * own callers, who may well pass it to `Promise.all()`.
 */
function returnedArrayOutcome(
  fn: FunctionLikeNode | null,
  analysis: Analysis,
): Outcome {
  return fn === analysis.listener ? DROPPED : HANDLED;
}

/** Follows the value of `expression` up through its parents to where it ends up. */
function fateOf(
  expression: Node,
  analysis: Analysis,
  shape: Shape = "promise",
): Outcome {
  let current = expression;
  let currentShape = shape;
  for (;;) {
    const parent = parentOf(current);
    if (parent == null) return HANDLED;

    if (TRANSPARENT_WRAPPERS.has(parent.type)) {
      current = parent;
      continue;
    }

    switch (parent.type) {
      // Awaiting an array of promises waits for none of them.
      case "AwaitExpression":
        return currentShape === "promise"
          ? { fate: "awaited", owner: enclosingFunction(parent) }
          : DROPPED;

      case "ReturnStatement":
        return currentShape === "promise"
          ? returnedOutcome(enclosingFunction(parent), analysis)
          : returnedArrayOutcome(enclosingFunction(parent), analysis);

      case "ArrowFunctionExpression":
        if (get(parent, "body") !== current) return HANDLED;
        return currentShape === "promise"
          ? returnedOutcome(parent as FunctionLikeNode, analysis)
          : returnedArrayOutcome(parent as FunctionLikeNode, analysis);

      case "ExpressionStatement":
        return DROPPED;

      // `void` is the way to say a promise is deliberately not awaited. Any
      // other operator (`!`, `typeof`, ...) makes no use of the promise.
      case "UnaryExpression":
        return get(parent, "operator") === "void" ? HANDLED : DROPPED;

      case "SequenceExpression": {
        const expressions = get(parent, "expressions") as Node[];
        if (expressions[expressions.length - 1] !== current) return DROPPED;
        current = parent;
        continue;
      }

      case "ConditionalExpression":
        if (get(parent, "test") === current) return HANDLED;
        current = parent;
        continue;

      case "LogicalExpression":
      case "Property":
      case "ObjectExpression":
        current = parent;
        continue;

      // A promise in an array literal is an array of promises. An array
      // spread into one is flattened into it, and stays what it was.
      case "ArrayExpression":
        if (currentShape === "promises") return HANDLED;
        currentShape = "promises";
        current = parent;
        continue;

      case "SpreadElement": {
        const array = parentOf(parent);
        if (currentShape !== "promises" || array?.type !== "ArrayExpression") {
          return HANDLED;
        }
        current = array;
        continue;
      }

      case "MemberExpression": {
        if (get(parent, "object") !== current) return HANDLED;
        const call = parentOf(parent);
        const name = memberName(parent);
        if (
          currentShape === "promise" && call?.type === "CallExpression" &&
          get(call, "callee") === parent && name != null &&
          PROMISE_CHAIN_METHODS.has(name)
        ) {
          current = call;
          continue;
        }
        return HANDLED;
      }

      case "CallExpression": {
        if (get(parent, "callee") === current) return HANDLED;
        const callee = unwrap(asNode(get(parent, "callee")) ?? parent);
        const name = memberName(callee);
        if (name === "waitUntil") return HANDLED;
        const object = callee.type === "MemberExpression"
          ? unwrap(asNode(get(callee, "object")) ?? callee)
          : null;
        if (
          object?.type === "Identifier" && object.name === "Promise" &&
          name != null && PROMISE_COMBINATORS.has(name)
        ) {
          current = parent;
          currentShape = "promise";
          continue;
        }
        return HANDLED;
      }

      // A promise kept in a variable is safe when the variable is used
      // anywhere else; when nothing ever mentions it again it is forgotten.
      case "VariableDeclarator": {
        const id = asNode(get(parent, "id"));
        if (get(parent, "init") !== current || id?.type !== "Identifier") {
          return HANDLED;
        }
        return analysis.mentioned.has(id.name) ? HANDLED : DROPPED;
      }

      case "AssignmentExpression": {
        if (get(parent, "right") !== current) return HANDLED;
        const name = getAssignmentTargetName(
          asNode(get(parent, "left")) ?? parent,
        );
        if (name == null) return HANDLED;
        return analysis.mentioned.has(name) ? HANDLED : DROPPED;
      }

      default:
        return HANDLED;
    }
  }
}

/** Reports every place in `listener` where a delivery promise is dropped. */
function checkListener(
  listener: FunctionLikeNode,
  report: (node: Node) => void,
): void {
  const scopes: UsedScope[] = [];
  walkUsedScopes(listener.body as Node, (scope) => scopes.push(scope));

  const targets = findDeliveryTargets(listener, scopes);
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

  const callsByScope = scopes.map((scope) => {
    const calls: CallExpression[] = [];
    for (const statement of scope.statements) collectCalls(statement, calls);
    return calls;
  });

  // A function that delivers and carries the promise on, by awaiting the
  // delivery or by returning it, is only as safe as what its own callers do
  // with the promise it returns. `fateOf()` says which function the promise
  // ended up in, which is not always the one that made the call: a delivery
  // inside a `map()` callback lands in whatever function awaits or returns
  // the `Promise.all()` around it.
  const carrying = new Map<FunctionLikeNode, Fate>();
  const carriesDelivery = (call: CallExpression, scope: UsedScope): boolean => {
    if (isDeliveryCall(call)) return true;
    const callee = unwrap(call.callee as Node);
    if (callee.type !== "Identifier") return false;
    const helpers = scope.functionsByName.get(callee.name);
    return helpers?.some((helper) => carrying.has(helper)) ?? false;
  };
  const noteCarrying = ({ fate, owner }: Outcome): boolean => {
    if (owner == null || owner === listener) return false;
    if (fate !== "awaited" && fate !== "returned") return false;
    const known = carrying.get(owner);
    if (known === "awaited" || known === fate) return false;
    carrying.set(owner, fate);
    return true;
  };
  for (let changed = true; changed;) {
    changed = false;
    scopes.forEach((scope, index) => {
      for (const call of callsByScope[index]) {
        if (
          carriesDelivery(call, scope) && noteCarrying(fateOf(call, analysis))
        ) {
          changed = true;
        }
      }
    });
  }

  const reported = new Set<Node>();
  const flag = (node: Node): void => {
    if (reported.has(node)) return;
    reported.add(node);
    report(node);
  };

  // A delivery call, or a call to a helper that delivers, whose promise is
  // dropped.
  scopes.forEach((scope, index) => {
    for (const call of callsByScope[index]) {
      if (!carriesDelivery(call, scope)) continue;
      if (fateOf(call, analysis).fate === "dropped") flag(call);
    }
  });

  // A callback that awaits a delivery hands its own promise to whoever runs
  // it: `forEach()` drops it, an immediately invoked one is as safe as the
  // call, and one given to `map()` is as safe as the array it builds. A
  // callback that returns the delivery was already judged above.
  for (const [fn, kind] of carrying) {
    if (
      kind === "awaited" && returnedOutcome(fn, analysis).fate === "dropped"
    ) {
      flag(fn);
    }
  }

  // The same for a function that delivers when it is handed over by name,
  // as in `inboxes.forEach(deliver)`.
  scopes.forEach((scope, index) => {
    for (const call of callsByScope[index]) {
      for (const arg of call.arguments as Node[]) {
        if (arg.type !== "Identifier") continue;
        const held = scope.functionsByName.get(arg.name);
        if (held == null || !held.some((fn) => carrying.has(fn))) continue;
        if (callbackResultOutcome(call, analysis).fate === "dropped") {
          flag(arg);
        }
      }
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
