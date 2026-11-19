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
type Outcome = {
  fate: Fate;
  owner: FunctionLikeNode | null;
  shape?: Shape;
};

const HANDLED: Outcome = { fate: "handled", owner: null };
const DROPPED: Outcome = { fate: "dropped", owner: null };

/**
 * What the value being followed is. An array of promises, such as what
 * `map()` returns, waits for nothing until it reaches `Promise.all()` or one
 * of its siblings: awaiting or returning it leaves every promise in flight.
 * So does an object with a promise in one of its properties, which nothing
 * waits for at all.
 */
type Shape = "promise" | "promises" | "object";

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
  isNode(value) ? (value as Node) : null;

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
  visitAll(
    node,
    (n) => {
      if (n.type === "CallExpression") out.push(n as CallExpression);
    },
    false,
  );
}

function enclosingFunction(node: Node): FunctionLikeNode | null {
  for (let current = parentOf(node); current != null;) {
    if (isFunctionLikeNode(current)) return current;
    current = parentOf(current);
  }
  return null;
}

/** A static block, like a function body, owns its var bindings. */
function variableRegion(node: Node): Node | null {
  for (
    let current = parentOf(node);
    current != null;
    current = parentOf(current)
  ) {
    if (current.type === "StaticBlock") return current;
    if (isFunctionLikeNode(current)) return asNode(get(current, "body"));
  }
  return null;
}

/** Checks binding patterns without treating property keys as bindings. */
function bindsName(pattern: Node | null, name: string): boolean {
  if (pattern == null) return false;
  pattern = unwrap(pattern);
  switch (pattern.type) {
    case "Identifier":
      return pattern.name === name;
    case "RestElement":
      return bindsName(asNode(get(pattern, "argument")), name);
    case "AssignmentPattern":
      return bindsName(asNode(get(pattern, "left")), name);
    case "ArrayPattern":
      return (get(pattern, "elements") as (Node | null)[]).some((item) =>
        bindsName(item, name),
      );
    case "ObjectPattern":
      return (get(pattern, "properties") as Node[]).some((prop) =>
        bindsName(
          asNode(get(prop, prop.type === "RestElement" ? "argument" : "value")),
          name,
        ),
      );
    default:
      return false;
  }
}

/** A nearer lexical declaration makes a merged outer candidate ambiguous. */
function shadowsName(region: Node, name: string, lexicalOnly = false): boolean {
  if (isFunctionLikeNode(region)) {
    return (
      (get(region, "params") as Node[]).some((param) =>
        bindsName(param, name),
      ) ||
      (region.type !== "FunctionDeclaration" &&
        bindsName(asNode(get(region, "id")), name))
    );
  }
  if (region.type === "CatchClause") {
    return bindsName(asNode(get(region, "param")), name);
  }
  const declarations: Node[] =
    region.type === "BlockStatement" || region.type === "StaticBlock"
      ? (get(region, "body") as Node[])
      : region.type === "SwitchStatement"
        ? (get(region, "cases") as Node[]).flatMap(
            (clause) => get(clause, "consequent") as Node[],
          )
        : region.type === "ForStatement"
          ? ([asNode(get(region, "init"))].filter(isNode) as Node[])
          : region.type === "ForInStatement" || region.type === "ForOfStatement"
            ? ([asNode(get(region, "left"))].filter(isNode) as Node[])
            : [];
  return declarations.some((declaration) =>
    declaration.type === "VariableDeclaration"
      ? (!lexicalOnly || get(declaration, "kind") !== "var") &&
        (get(declaration, "declarations") as Node[]).some((item) =>
          bindsName(asNode(get(item, "id")), name),
        )
      : (declaration.type === "FunctionDeclaration" ||
          declaration.type === "ClassDeclaration") &&
        bindsName(asNode(get(declaration, "id")), name),
  );
}

/** Finds the nearest lexical binding, with function scope as a fallback. */
function assignmentRegion(assignment: Node, name: string): Node | null {
  for (
    let current = parentOf(assignment);
    current != null;
    current = parentOf(current)
  ) {
    if (isFunctionLikeNode(current)) return asNode(get(current, "body"));
    if (current.type === "StaticBlock") return current;
    if (shadowsName(current, name, true)) return current;
  }
  return null;
}

/**
 * The shared reachability map merges block-local functions. Do not use a
 * candidate outside its lexical declaration region: another binding may be
 * visible there, including one outside the listener that this rule ignores.
 * Ambiguous merged candidates remain unclassified rather than filtered down
 * to a possibly incomplete set.
 */
function helpersAt(
  node: Node,
  scope: UsedScope,
  unknownWrites: ReadonlySet<string>,
): FunctionLikeNode[] {
  if (node.type !== "Identifier" || unknownWrites.has(node.name)) return [];
  const helpers = scope.functionsByName.get(node.name) ?? [];
  for (const fn of helpers) {
    let declaration: Node = fn;
    while (
      parentOf(declaration) != null &&
      TRANSPARENT_WRAPPERS.has(parentOf(declaration)!.type)
    ) {
      declaration = parentOf(declaration)!;
    }
    const declarator = parentOf(declaration);
    // A function buried in an aggregate initializer may belong to a different
    // property or tuple element than the identifier being invoked. Only a
    // directly held callable certifies a named helper here.
    if (fn.type !== "FunctionDeclaration") {
      const target =
        declarator?.type === "VariableDeclarator"
          ? asNode(get(declarator, "id"))
          : declarator?.type === "AssignmentExpression" &&
              get(declarator, "operator") === "="
            ? asNode(get(declarator, "left"))
            : null;
      if (target?.type !== "Identifier" || target.name !== node.name) return [];
    }
    const variable =
      declarator?.type === "VariableDeclarator" ? parentOf(declarator) : null;
    const region =
      fn.type === "FunctionDeclaration"
        ? parentOf(fn)
        : variable?.type === "VariableDeclaration" &&
            get(variable, "kind") !== "var"
          ? parentOf(variable)
          : declarator?.type === "AssignmentExpression"
            ? assignmentRegion(declarator, node.name)
            : variableRegion(fn);
    if (region == null) return [];
    const functionScope = enclosingFunction(fn);
    let current: Node | null = node;
    while (current != null && current !== region) {
      // A var declaration in this function initializes the same binding,
      // even inside a block or loop head. In another function it can shadow.
      if (
        shadowsName(
          current,
          node.name,
          enclosingFunction(current) === functionScope,
        )
      )
        return [];
      current = parentOf(current);
    }
    if (current == null) return [];
  }
  return helpers;
}

/** The names an object pattern binds the delivery methods to. */
function deliveryAliasesOf(pattern: Node, out: Set<string>): void {
  if (pattern.type !== "ObjectPattern") return;
  for (const prop of get(pattern, "properties") as Node[]) {
    if (prop.type !== "Property") continue;
    const key = asNode(get(prop, "key"));
    const keyName =
      key?.type === "Identifier"
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
  const contextName =
    contextParam?.type === "Identifier" ? contextParam.name : null;
  if (contextParam != null) deliveryAliasesOf(contextParam, aliases);

  if (contextName != null) {
    for (const scope of scopes) {
      for (const statement of scope.statements) {
        visitAll(
          statement,
          (node) => {
            if (node.type !== "VariableDeclarator") return;
            const id = asNode(get(node, "id"));
            const init = asNode(get(node, "init"));
            if (id == null || init == null) return;
            const source = unwrap(init);
            if (source.type === "Identifier" && source.name === contextName) {
              deliveryAliasesOf(id, aliases);
              return;
            }
            if (
              id.type !== "Identifier" ||
              source.type !== "MemberExpression"
            ) {
              return;
            }
            const object = unwrap(asNode(get(source, "object")) ?? source);
            const name = memberName(source);
            if (
              object.type === "Identifier" &&
              object.name === contextName &&
              name != null &&
              DELIVERY_METHOD_NAMES.has(name)
            ) {
              aliases.add(id.name);
            }
          },
          false,
        );
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
function callbackResultOutcome(
  call: Node,
  analysis: Analysis,
  callback: Node,
  shape: Shape = "promise",
): Outcome {
  const callee = unwrap(asNode(get(call, "callee")) ?? call);
  const name = memberName(callee);
  // `forEach()` discards what its callback returns, which is the one callback
  // consumer the rule knows for certain. An unknown one, such as
  // `setTimeout()`, may well keep it.
  if (name === "forEach" || name === "map" || name === "flatMap") {
    // The optional second argument is thisArg, not another callback.
    if ((get(call, "arguments") as Node[])[0] !== callback) return HANDLED;
  }
  if (name === "forEach") return DROPPED;
  // Only flatMap flattens returned arrays; map and promise callbacks would
  // need nested-array or Promise<Array> tracking, which remains unsupported.
  if (shape === "promises" && name !== "flatMap") return HANDLED;
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
      return callbackResultOutcome(parent, analysis, fn);
    }
  }
  // A function declared or held under a name hands the promise to its
  // callers, who are judged at each call.
  return { fate: "returned", owner: fn };
}

/**
 * Where an array of promises, or an object holding one, goes when it is
 * returned. The listener's caller does not wait for what is inside it. Any
 * other function hands it to its own callers, who may well pass it to
 * `Promise.all()` or read the promise back out of it.
 */
function returnedContainerOutcome(
  fn: FunctionLikeNode | null,
  analysis: Analysis,
  shape: Shape,
): Outcome {
  if (fn === analysis.listener) return DROPPED;
  if (fn != null && shape === "promises" && get(fn, "async") !== true) {
    const parent = parentOf(fn);
    if (
      parent?.type === "CallExpression" &&
      (get(parent, "arguments") as Node[]).includes(fn)
    ) {
      return callbackResultOutcome(parent, analysis, fn, shape);
    }
  }
  return fn != null && shape === "promises"
    ? { fate: "returned", owner: fn, shape }
    : HANDLED;
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
      // Awaiting an array of promises, or an object holding one, waits for
      // none of them.
      case "AwaitExpression":
        if (currentShape === "promise") {
          return { fate: "awaited", owner: enclosingFunction(parent) };
        }
        // Await preserves an array value; its eventual consumer may still
        // aggregate the deliveries, store the array, or discard it.
        if (currentShape === "promises") {
          current = parent;
          continue;
        }
        return DROPPED;

      case "ReturnStatement":
        return currentShape === "promise"
          ? returnedOutcome(enclosingFunction(parent), analysis)
          : returnedContainerOutcome(
              enclosingFunction(parent),
              analysis,
              currentShape,
            );

      case "ArrowFunctionExpression":
        if (get(parent, "body") !== current) return HANDLED;
        return currentShape === "promise"
          ? returnedOutcome(parent as FunctionLikeNode, analysis)
          : returnedContainerOutcome(
              parent as FunctionLikeNode,
              analysis,
              currentShape,
            );

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

      // A promise is always truthy, so testing one waits for nothing. A `for`
      // loop discards the value of its initializer and its update as well.
      case "ConditionalExpression":
        if (get(parent, "test") === current) return DROPPED;
        current = parent;
        continue;

      case "IfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
      case "ForStatement":
        return DROPPED;

      case "LogicalExpression":
        if (
          get(parent, "operator") === "&&" &&
          get(parent, "left") === current
        ) {
          return DROPPED;
        }
        current = parent;
        continue;

      case "Property":
        if (get(parent, "computed") && get(parent, "key") === current) {
          return DROPPED;
        }
        current = parent;
        continue;

      // A promise in an object literal is an object holding a promise. An
      // array of promises in one is still an array of promises.
      case "ObjectExpression":
        if (currentShape === "promise") currentShape = "object";
        current = parent;
        continue;

      // A promise in an array literal is an array of promises. An array or an
      // object in one is left alone.
      case "ArrayExpression":
        if (currentShape !== "promise") return HANDLED;
        currentShape = "promises";
        current = parent;
        continue;

      // An array spread into an array literal is flattened into it, and stays
      // an array of promises.
      case "SpreadElement": {
        const array = parentOf(parent);
        if (currentShape !== "promises" || array?.type !== "ArrayExpression") {
          return HANDLED;
        }
        current = array;
        continue;
      }

      case "MemberExpression": {
        if (get(parent, "computed") && get(parent, "property") === current) {
          return DROPPED;
        }
        if (get(parent, "object") !== current) return HANDLED;
        const call = parentOf(parent);
        const name = memberName(parent);
        if (
          currentShape === "promise" &&
          call?.type === "CallExpression" &&
          get(call, "callee") === parent &&
          name != null &&
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
        const object =
          callee.type === "MemberExpression"
            ? unwrap(asNode(get(callee, "object")) ?? callee)
            : null;
        if (
          object?.type === "Identifier" &&
          object.name === "Promise" &&
          name != null &&
          PROMISE_COMBINATORS.has(name)
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

      case "AssignmentPattern": {
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

/** A small proof of no normal fallthrough, not a general control-flow graph. */
function exitsFunction(node: Node): boolean {
  switch (node.type) {
    case "ReturnStatement":
    case "ThrowStatement":
      return true;
    case "BlockStatement":
      return (get(node, "body") as Node[]).some(exitsFunction);
    case "IfStatement": {
      const test = asNode(get(node, "test"));
      const consequent = asNode(get(node, "consequent"));
      const alternate = asNode(get(node, "alternate"));
      if (test?.type === "Literal") {
        const branch = test.value ? consequent : alternate;
        return branch != null && exitsFunction(branch);
      }
      return (
        consequent != null &&
        alternate != null &&
        exitsFunction(consequent) &&
        exitsFunction(alternate)
      );
    }
    default:
      return false;
  }
}

/**
 * Classifies the container a helper returns independently of whether it
 * contains a delivery. The carrying walk supplies that evidence separately.
 * Unknown dependencies and recursive cycles never certify an array.
 */
function helperReturnShapes(
  scopes: readonly UsedScope[],
  isDeliveryCall: (call: CallExpression) => boolean,
  unknownWrites: ReadonlySet<string>,
): {
  shapes: ReadonlyMap<FunctionLikeNode, Shape | null>;
  arrayInvolved: ReadonlySet<FunctionLikeNode>;
} {
  const returns = new Map<FunctionLikeNode, (Node | null)[]>();
  const scopesByFunction = new Map<FunctionLikeNode, UsedScope>();
  for (const scope of scopes) {
    const fn = scope.fn;
    if (fn == null) continue;
    scopesByFunction.set(fn, scope);
    const body = fn.body as Node;
    returns.set(
      fn,
      body.type !== "BlockStatement"
        ? [body]
        : [
            ...scope.statements
              .filter((node) => node.type === "ReturnStatement")
              .map((node) => asNode(get(node, "argument"))),
            ...(exitsFunction(body) ? [] : [null]),
          ],
    );
  }

  const helpersOf = (node: Node, scope: UsedScope): FunctionLikeNode[] => {
    const callee = unwrap(asNode(get(node, "callee")) ?? node);
    return isFunctionLikeNode(callee)
      ? [callee]
      : helpersAt(callee, scope, unknownWrites);
  };
  // Keep array provenance even when a mixed or unsupported return has no
  // shape. Otherwise legacy promise propagation could revive that helper.
  const arrayInvolved = new Set<FunctionLikeNode>();
  const involvesArray = (node: Node | null, scope: UsedScope): boolean => {
    if (node == null) return false;
    node = unwrap(node);
    switch (node.type) {
      case "ArrayExpression":
        return true;
      case "CallExpression": {
        const name = memberName(unwrap(asNode(get(node, "callee")) ?? node));
        return (
          name === "map" ||
          name === "flatMap" ||
          helpersOf(node, scope).some(
            (fn) => get(fn, "async") !== true && arrayInvolved.has(fn),
          )
        );
      }
      case "ConditionalExpression":
        return (
          involvesArray(asNode(get(node, "consequent")), scope) ||
          involvesArray(asNode(get(node, "alternate")), scope)
        );
      case "LogicalExpression":
        return (
          involvesArray(asNode(get(node, "left")), scope) ||
          involvesArray(asNode(get(node, "right")), scope)
        );
      case "SequenceExpression":
        return involvesArray(
          (get(node, "expressions") as Node[]).at(-1) ?? null,
          scope,
        );
      case "AwaitExpression":
        return involvesArray(asNode(get(node, "argument")), scope);
      default:
        return false;
    }
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const [fn, expressions] of returns) {
      if (
        !arrayInvolved.has(fn) &&
        expressions.some((node) =>
          involvesArray(node, scopesByFunction.get(fn)!),
        )
      ) {
        arrayInvolved.add(fn);
        changed = true;
      }
    }
  }

  const shapes = new Map<FunctionLikeNode, Shape | null>();
  const active = new Set<FunctionLikeNode>();
  const agree = (values: (Shape | null)[]): Shape | null =>
    values.length > 0 &&
    values[0] != null &&
    values.every((value) => value === values[0])
      ? values[0]
      : null;
  const expressionShape = (
    node: Node | null,
    scope: UsedScope,
  ): Shape | null => {
    if (node == null) return null;
    node = unwrap(node);
    switch (node.type) {
      case "ArrayExpression":
        return "promises";
      case "ConditionalExpression":
        return agree([
          expressionShape(asNode(get(node, "consequent")), scope),
          expressionShape(asNode(get(node, "alternate")), scope),
        ]);
      case "SequenceExpression":
        return expressionShape(
          (get(node, "expressions") as Node[]).at(-1) ?? null,
          scope,
        );
      case "CallExpression": {
        if (isDeliveryCall(node as CallExpression)) return "promise";
        const callee = unwrap(asNode(get(node, "callee")) ?? node);
        const name = memberName(callee);
        if (name === "map" || name === "flatMap") return "promises";
        const object = asNode(get(callee, "object"));
        if (
          object != null &&
          unwrap(object).type === "Identifier" &&
          get(unwrap(object), "name") === "Promise" &&
          name != null &&
          PROMISE_COMBINATORS.has(name)
        )
          return "promise";
        return agree(helpersOf(node, scope).map(functionShape));
      }
      default:
        return null;
    }
  };
  const functionShape = (fn: FunctionLikeNode): Shape | null => {
    if (shapes.has(fn)) return shapes.get(fn)!;
    if (active.has(fn)) return null;
    const scope = scopesByFunction.get(fn);
    if (scope == null || get(fn, "generator") === true) return null;
    active.add(fn);
    let shape = agree(
      (returns.get(fn) ?? []).map((node) => expressionShape(node, scope)),
    );
    active.delete(fn);
    // An async array return is Promise<Array>, not a completion promise.
    if (shape === "promises" && get(fn, "async") === true) shape = null;
    shapes.set(fn, shape);
    return shape;
  };
  for (const fn of returns.keys()) functionShape(fn);
  return { shapes, arrayInvolved };
}

/** Reports every place in `listener` where a delivery promise is dropped. */
function checkListener(
  listener: FunctionLikeNode,
  report: (node: Node) => void,
): void {
  const scopes: UsedScope[] = [];
  walkUsedScopes(listener.body as Node, (scope) => scopes.push(scope));

  const invalidationExpressions = (scope: UsedScope): Node[] => {
    const expressions = [
      ...scope.statements,
      ...(scope.fn == null ? [] : (get(scope.fn, "params") as Node[])),
    ];
    // Catch patterns can execute even when the catch body is empty. They are
    // absent from the shared statement list, so scan them conservatively.
    visitAll(
      scope.fn?.body ?? listener.body,
      (node) => {
        if (node.type === "CatchClause") {
          const param = asNode(get(node, "param"));
          if (param != null) expressions.push(param);
        }
      },
      false,
    );
    return expressions;
  };
  // Parameter defaults are not part of shared body reachability. Follow their
  // possible local callees only for invalidation, not delivery diagnostics.
  const invalidationScopes = [...scopes];
  const invalidationFunctions = new Set(scopes.map((scope) => scope.fn));
  for (const [index, scope] of invalidationScopes.entries()) {
    const names = new Set<string>();
    const inlineFunctions = new Set<FunctionLikeNode>();
    const expressions = invalidationExpressions(scope);
    for (const expression of expressions) {
      const parent = parentOf(expression);
      if (
        (parent?.type === "ForOfStatement" ||
          parent?.type === "ForInStatement") &&
        get(parent, "right") === expression
      ) {
        // Loop member targets can invoke setters without an assignment node.
        visitAll(
          get(parent, "left"),
          (target) => {
            if (target.type === "MemberExpression")
              collectReferencedNames(target, names);
          },
          false,
        );
      }
      // Declaration ids contain executable defaults and computed keys that
      // collectReferencedNames intentionally omits from body reachability.
      visitAll(
        expression,
        (node) => {
          if (node.type === "CallExpression") {
            collectReferencedNames(node, names);
            // An executable binding key can invoke an inline function.
            visitAll(node, (value) => {
              if (isFunctionLikeNode(value)) inlineFunctions.add(value);
            });
          } else if (node.type === "AssignmentPattern") {
            collectReferencedNames(get(node, "right"), names);
            // Default values can supply inline callbacks for a later call.
            // Scan them only for invalidation, never for delivery diagnostics.
            visitAll(get(node, "right"), (value) => {
              if (isFunctionLikeNode(value)) inlineFunctions.add(value);
            });
          } else if (
            node.type === "AssignmentExpression" ||
            node.type === "UpdateExpression"
          ) {
            const target = asNode(
              get(
                node,
                node.type === "AssignmentExpression" ? "left" : "argument",
              ),
            );
            if (target != null && unwrap(target).type === "MemberExpression")
              collectReferencedNames(unwrap(target), names);
          }
        },
        false,
      );
    }
    if (index >= scopes.length) {
      for (const statement of scope.statements)
        collectReferencedNames(statement, names);
    }
    const candidates = new Set([
      ...inlineFunctions,
      ...[...names].flatMap((name) => scope.functionsByName.get(name) ?? []),
    ]);
    for (const fn of candidates) {
      if (invalidationFunctions.has(fn)) continue;
      walkUsedScopes(fn.body as Node, (nested) => {
        const nestedFn = nested.fn ?? fn;
        if (invalidationFunctions.has(nestedFn)) return;
        invalidationFunctions.add(nestedFn);
        invalidationScopes.push({
          ...nested,
          fn: nestedFn,
          functionsByName: new Map([
            ...scope.functionsByName,
            ...nested.functionsByName,
          ]),
        });
      });
    }
  }

  // Shared reachability collects function-valued assignments, but not aliases
  // or unknown replacement values. Without ordered binding data flow, any
  // such write makes a same-named helper unsafe to infer, including in a
  // closure. Name-wide invalidation is deliberately conservative.
  const helperNames = new Set(
    invalidationScopes.flatMap((scope) => [...scope.functionsByName.keys()]),
  );
  const unknownWrites = new Set<string>();
  for (const scope of invalidationScopes) {
    const localFunctionNames = new Set<string>();
    if (scope.fn != null) {
      for (const name of helperNames) {
        if (shadowsName(scope.fn, name)) localFunctionNames.add(name);
      }
      // var bindings belong to the whole function, including nested blocks.
      for (const statement of scope.statements) {
        visitAll(
          statement,
          (node) => {
            if (
              node.type !== "VariableDeclarator" ||
              get(parentOf(node), "kind") !== "var"
            )
              return;
            for (const name of helperNames) {
              if (bindsName(asNode(get(node, "id")), name))
                localFunctionNames.add(name);
            }
          },
          false,
        );
      }
    }
    const expressions = invalidationExpressions(scope);
    for (const statement of expressions) {
      // Reachability emits the iterable expression, not the loop statement.
      // Its left-hand target writes an existing binding on each iteration.
      const parent = parentOf(statement);
      if (
        (parent?.type === "ForOfStatement" ||
          parent?.type === "ForInStatement") &&
        get(parent, "right") === statement
      ) {
        const target = asNode(get(parent, "left"));
        if (target?.type === "VariableDeclaration") {
          for (const item of get(target, "declarations") as Node[]) {
            for (const name of helperNames) {
              if (bindsName(asNode(get(item, "id")), name))
                unknownWrites.add(name);
            }
          }
        } else {
          for (const name of helperNames) {
            if (bindsName(target, name)) unknownWrites.add(name);
          }
        }
      }
      visitAll(
        statement,
        (node) => {
          if (node.type === "VariableDeclarator") {
            const value = asNode(get(node, "init"));
            if (value != null && !isFunctionLikeNode(unwrap(value))) {
              for (const name of helperNames) {
                if (bindsName(asNode(get(node, "id")), name))
                  unknownWrites.add(name);
              }
            }
            return;
          }
          if (
            node.type !== "AssignmentExpression" &&
            node.type !== "UpdateExpression"
          )
            return;
          const target = asNode(
            get(
              node,
              node.type === "AssignmentExpression" ? "left" : "argument",
            ),
          );
          const value = asNode(get(node, "right"));
          if (
            get(node, "operator") === "=" &&
            value != null &&
            isFunctionLikeNode(unwrap(value)) &&
            // Nested scope maps do not update the enclosing caller's map.
            // Exempt a literal write only when its target is local.
            target?.type === "Identifier" &&
            scope.functionsByName
              .get(target.name)
              ?.includes(unwrap(value) as FunctionLikeNode) &&
            (scope.fn == null ||
              localFunctionNames.has(target.name) ||
              shadowsName(
                assignmentRegion(node, target.name) ?? node,
                target.name,
                true,
              ))
          )
            return;
          for (const name of helperNames) {
            if (bindsName(target, name)) unknownWrites.add(name);
          }
        },
        false,
      );
    }
  }

  const targets = findDeliveryTargets(listener, scopes);
  if (targets.contextName == null && targets.aliases.size === 0) return;

  const isDeliveryCall = (call: CallExpression): boolean => {
    const callee = unwrap(call.callee as Node);
    if (callee.type === "MemberExpression") {
      const name = memberName(callee);
      if (name == null || !DELIVERY_METHOD_NAMES.has(name)) return false;
      const object = unwrap(asNode(get(callee, "object")) ?? callee);
      return (
        object.type === "Identifier" && object.name === targets.contextName
      );
    }
    return callee.type === "Identifier" && targets.aliases.has(callee.name);
  };

  const mentioned = new Set<string>();
  collectReferencedNames(listener.body, mentioned, true);
  const analysis: Analysis = { listener, mentioned };
  const { shapes, arrayInvolved } = helperReturnShapes(
    scopes,
    isDeliveryCall,
    unknownWrites,
  );

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
  const carryingArrays = new Set<FunctionLikeNode>();
  const carriesCompletion = (helpers: readonly FunctionLikeNode[]): boolean =>
    helpers.some((fn) => carrying.has(fn)) &&
    helpers.every((fn) => !arrayInvolved.has(fn) || get(fn, "async") === true);
  const carriesArray = (helpers: readonly FunctionLikeNode[]): boolean =>
    helpers.some((fn) => carryingArrays.has(fn)) &&
    helpers.every((fn) => shapes.get(fn) === "promises");
  const deliveryShape = (
    call: CallExpression,
    scope: UsedScope,
  ): Shape | null => {
    if (isDeliveryCall(call)) return "promise";
    const callee = unwrap(call.callee as Node);
    const helpers = isFunctionLikeNode(callee)
      ? [callee]
      : helpersAt(callee, scope, unknownWrites);
    if (helpers.length === 0) return null;
    if (carriesCompletion(helpers)) return "promise";
    if (carriesArray(helpers)) return "promises";
    return null;
  };
  const noteCarrying = ({
    fate,
    owner,
    shape = "promise",
  }: Outcome): boolean => {
    if (owner == null || owner === listener) return false;
    if (fate !== "awaited" && fate !== "returned") return false;
    // Awaiting or adopting a delivery makes an async helper's own completion
    // promise significant, even if another branch returns an array.
    if (
      arrayInvolved.has(owner) &&
      !(shape === "promise" && get(owner, "async") === true)
    ) {
      if (shape !== "promises" || shapes.get(owner) !== "promises")
        return false;
      if (carryingArrays.has(owner)) return false;
      carryingArrays.add(owner);
      return true;
    }
    if (shape !== "promise") return false;
    const known = carrying.get(owner);
    if (known === "awaited" || known === fate) return false;
    carrying.set(owner, fate);
    return true;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const [index, scope] of scopes.entries()) {
      for (const call of callsByScope[index]) {
        const shape = deliveryShape(call, scope);
        if (shape != null && noteCarrying(fateOf(call, analysis, shape))) {
          changed = true;
        }
        for (const arg of call.arguments as Node[]) {
          if (arg.type !== "Identifier") continue;
          const helpers = helpersAt(arg, scope, unknownWrites);
          const shape = carriesCompletion(helpers)
            ? "promise"
            : carriesArray(helpers)
              ? "promises"
              : null;
          if (shape == null) continue;
          const outcome = callbackResultOutcome(call, analysis, arg, shape);
          if (noteCarrying(outcome)) {
            changed = true;
          }
        }
      }
    }
    // An inline async map callback carries delivery through its own promise
    // into the returned array, without a named call to seed that array.
    for (const [fn, kind] of carrying) {
      if (kind !== "awaited") continue;
      const outcome = returnedOutcome(fn, analysis);
      if (outcome.shape === "promises" && noteCarrying(outcome)) changed = true;
    }
  }

  const reported = new Set<Node>();
  const flag = (node: Node): void => {
    if (reported.has(node)) return;
    reported.add(node);
    report(node);
  };

  // A delivery call, or a call to a helper that delivers, whose promise is
  // dropped.
  for (const [index, scope] of scopes.entries()) {
    for (const call of callsByScope[index]) {
      const shape = deliveryShape(call, scope);
      if (shape == null) continue;
      if (fateOf(call, analysis, shape).fate === "dropped") flag(call);
    }
  }

  // A callback that awaits a delivery hands its own promise to whoever runs
  // it: `forEach()` drops it, an immediately invoked one is as safe as the
  // call, and one given to `map()` is as safe as the array it builds. A
  // callback that returns the delivery was already judged above.
  for (const [fn, kind] of carrying) {
    if (
      kind === "awaited" &&
      returnedOutcome(fn, analysis).fate === "dropped"
    ) {
      const parent = parentOf(fn);
      // The call-site pass also follows IIFE completion. Use the same node
      // here so an unawaited invocation produces only one diagnostic.
      flag(
        parent?.type === "CallExpression" && get(parent, "callee") === fn
          ? parent
          : fn,
      );
    }
  }

  // The same for a function that delivers when it is handed over by name,
  // as in `inboxes.forEach(deliver)`.
  for (const [index, scope] of scopes.entries()) {
    for (const call of callsByScope[index]) {
      for (const arg of call.arguments as Node[]) {
        if (arg.type !== "Identifier") continue;
        const held = helpersAt(arg, scope, unknownWrites);
        const shape = carriesCompletion(held)
          ? "promise"
          : carriesArray(held)
            ? "promises"
            : null;
        if (shape == null) continue;
        if (
          callbackResultOutcome(call, analysis, arg, shape).fate === "dropped"
        ) {
          flag(arg);
        }
      }
    }
  }
}

function createRule<Context = Deno.lint.RuleContext | Rule.RuleContext>(
  buildReport: Context extends Deno.lint.RuleContext
    ? {
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
      }),
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
