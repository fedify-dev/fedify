import { isNode } from "./pred.ts";
import type {
  Expression,
  FunctionNode,
  Identifier,
  Node,
  VariableDeclarator,
} from "./types.ts";

export type FunctionLikeNode =
  | FunctionNode
  | (Node & {
    type: "FunctionDeclaration";
    id: Identifier | null;
    params: unknown[];
    body: unknown;
  });

const FUNCTION_NODE_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

export const isFunctionLikeNode = (node: Node): node is FunctionLikeNode =>
  FUNCTION_NODE_TYPES.has(node.type);

// ---------------------------------------------------------------------------
// Reachability: which statements can actually run, following control flow
// (if/else, try/catch/finally, switch, loops) but never descending into a
// nested function's own body, and pruning dead code (a statically-falsy `if`
// branch, or anything after a statement that always returns/throws).
//
// A control-flow statement's head expressions (an `if` test, a `switch`
// discriminant and case tests, a loop's `init`/`test`/`update`/`right`) run
// whenever the statement itself does, whichever branch is taken, so they are
// collected alongside the bodies. Collecting one never revives the branch
// behind it: `if (false)` still hides its consequent.
// ---------------------------------------------------------------------------

const isStaticallyFalsy = (test: Expression): boolean =>
  test.type === "Literal" && !test.value;

const isStaticallyTruthy = (test: Expression): boolean =>
  test.type === "Literal" && Boolean(test.value);

/**
 * Whether every path through this statement unconditionally returns or
 * throws, meaning anything textually after it in the same statement list
 * never runs. Deliberately conservative: when it can't prove that, it
 * answers `false`, which keeps the following code counted as reachable
 * (a missed dead-code case is safer than wrongly hiding live code).
 */
function alwaysExits(node: Node): boolean {
  switch (node.type) {
    case "ReturnStatement":
    case "ThrowStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return true;

    case "BlockStatement":
      return node.body.some((statement) => alwaysExits(statement as Node));

    case "IfStatement": {
      const test = node.test as Expression;
      if (isStaticallyFalsy(test)) {
        return node.alternate != null && alwaysExits(node.alternate as Node);
      }
      if (isStaticallyTruthy(test)) {
        return alwaysExits(node.consequent as Node);
      }
      if (node.alternate == null) return false;
      return alwaysExits(node.consequent as Node) &&
        alwaysExits(node.alternate as Node);
    }

    case "TryStatement":
      // A `finally` that always exits dominates the whole statement. Beyond
      // that, a `try` block can throw partway through and jump to `catch`,
      // so proving more than this would need tracking which statements can
      // throw -- stay conservative and say "not sure" instead.
      return node.finalizer != null && alwaysExits(node.finalizer as Node);

    default:
      return false;
  }
}

export function collectReachableStatements(node: Node, out: Node[]): void {
  switch (node.type) {
    case "BlockStatement":
      for (const [index, statement] of node.body.entries()) {
        collectReachableStatements(statement as Node, out);
        if (alwaysExits(statement as Node)) {
          // Function declarations hoist: one written below an exit is still
          // callable from the code above it.
          for (const rest of node.body.slice(index + 1)) {
            if ((rest as Node).type === "FunctionDeclaration") {
              out.push(rest as Node);
            }
          }
          return;
        }
      }
      return;

    case "IfStatement": {
      const test = node.test as Expression;
      out.push(test);
      if (!isStaticallyFalsy(test)) {
        collectReachableStatements(node.consequent as Node, out);
      }
      if (node.alternate != null && !isStaticallyTruthy(test)) {
        collectReachableStatements(node.alternate as Node, out);
      }
      return;
    }

    case "TryStatement":
      collectReachableStatements(node.block as Node, out);
      if (node.handler != null) {
        collectReachableStatements(node.handler.body as Node, out);
      }
      if (node.finalizer != null) {
        collectReachableStatements(node.finalizer as Node, out);
      }
      return;

    case "SwitchStatement":
      out.push(node.discriminant as Node);
      for (const switchCase of node.cases) {
        if (switchCase.test != null) out.push(switchCase.test as Node);
        for (const statement of switchCase.consequent) {
          collectReachableStatements(statement as Node, out);
          if (alwaysExits(statement as Node)) break;
        }
      }
      return;

    case "WhileStatement":
    case "DoWhileStatement":
      out.push(node.test as Node);
      collectReachableStatements(node.body as Node, out);
      return;

    case "ForStatement":
      for (const head of [node.init, node.test, node.update]) {
        if (head != null) out.push(head as Node);
      }
      collectReachableStatements(node.body as Node, out);
      return;

    case "ForInStatement":
    case "ForOfStatement":
      // Only `right` is evaluated as a value; `left` declares or assigns the
      // loop variable.
      out.push(node.right as Node);
      collectReachableStatements(node.body as Node, out);
      return;

    case "LabeledStatement":
      collectReachableStatements(node.body as Node, out);
      return;

    case "WithStatement":
      out.push(node.object as Node);
      collectReachableStatements(node.body as Node, out);
      return;

    default:
      out.push(node);
      return;
  }
}

// ---------------------------------------------------------------------------
// What a listener (or a helper's own body) resolves to when scanned for a
// delivery call: two rules decide which nested function bodies are folded
// into the scan instead of being masked out.
//
// The rule reports only when neither can account for a delivery call, so
// both err toward treating a function as used. Working out how a function
// value travels through arbitrary JavaScript (an alias, a destructured
// property, an array, a wrapper call) is open-ended, and so is working out
// what a call does with a callback it receives. Showing that a name never
// appears anywhere that runs is not. So a function held under a name is
// used as soon as that name is mentioned, without tracing how it is then
// passed around, and any other function literal, such as a callback handed
// to a call, is used wherever it appears, since the rule cannot show that
// the receiving call never runs it. A missed warning is the safe direction;
// a warning on code that delivers is not.
// ---------------------------------------------------------------------------

/**
 * Collects plain-value references to identifiers: `deliver()`,
 * `forEach(deliver)`, a shorthand `{ deliver }`, and so on. Skips positions
 * that name something rather than reference a value: a declaration's own
 * `id`/params, the non-computed `.property` of a member expression (so
 * `someService.deliver()` never counts as a reference to an unrelated local
 * `deliver`), and the target of an assignment, which writes to a name
 * instead of reading it.
 */
export function collectReferencedNames(
  node: unknown,
  out: Set<string>,
  crossFunctions = false,
): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectReferencedNames(item, out, crossFunctions);
    return;
  }
  if (!isNode(node)) return;
  const n = node;

  if (n.type === "Identifier") {
    out.add(n.name);
    return;
  }
  if (n.type === "MemberExpression" && !n.computed) {
    collectReferencedNames(n.object, out, crossFunctions);
    return;
  }
  if (n.type === "Property" && !n.computed) {
    // `{ deliver: fn }` -- the key is a name, not a reference; only the
    // value is (for shorthand `{ deliver }`, the value is the same name,
    // so this still counts it).
    collectReferencedNames(n.value, out, crossFunctions);
    return;
  }
  if (n.type === "VariableDeclarator") {
    if ((n as VariableDeclarator).init != null) {
      collectReferencedNames(
        (n as VariableDeclarator).init,
        out,
        crossFunctions,
      );
    }
    return;
  }
  if (n.type === "ClassDeclaration" || n.type === "ClassExpression") {
    // The class's own name is a declaration, not a mention of it.
    collectReferencedNames(n.superClass, out, crossFunctions);
    collectReferencedNames(n.body, out, crossFunctions);
    return;
  }
  if (
    (n.type === "MethodDefinition" || n.type === "PropertyDefinition") &&
    !n.computed
  ) {
    // Same as an object literal's `Property`: the key names a member, and
    // only what it holds can reference something.
    collectReferencedNames(n.value, out, crossFunctions);
    return;
  }
  if (n.type === "AssignmentExpression" && n.operator === "=") {
    // `x = fn` and `obj.x = fn` write to a name rather than mention it.
    if (getAssignmentTargetName(n.left as Node) != null) {
      collectReferencedNames(n.right, out, crossFunctions);
      return;
    }
  }
  if (isFunctionLikeNode(n)) {
    // Stop at a nested function's own boundary by default: whether a name it
    // references counts is decided separately, only once that function
    // itself is found to be reachable. A caller that wants every mention in
    // a function, such as whether a stored value is used anywhere, asks to
    // cross it.
    if (crossFunctions) {
      collectReferencedNames(n.body, out, crossFunctions);
    }
    return;
  }

  const record = n as unknown as Record<string, unknown>;
  for (const key in record) {
    if (key === "parent") continue;
    collectReferencedNames(record[key], out, crossFunctions);
  }
}

/**
 * The name an assignment writes to: `x` for `x = ...`, and the root object
 * for `obj.a.b = ...`. `null` for anything more exotic.
 */
export function getAssignmentTargetName(target: Node): string | null {
  let current: Node = target;
  while (current.type === "MemberExpression") current = current.object as Node;
  return current.type === "Identifier" ? current.name : null;
}

/** Every identifier a declaration pattern binds (`a`, `{ a, b: c }`, `[a]`). */
function collectBoundNames(pattern: unknown, out: string[]): void {
  if (pattern == null || typeof pattern !== "object" || !isNode(pattern)) {
    return;
  }
  const p = pattern as Node;
  switch (p.type) {
    case "Identifier":
      out.push(p.name);
      return;
    case "AssignmentPattern":
      collectBoundNames(p.left, out);
      return;
    case "RestElement":
      collectBoundNames(p.argument, out);
      return;
    case "ArrayPattern":
      for (const element of p.elements) collectBoundNames(element, out);
      return;
    case "ObjectPattern":
      for (const prop of p.properties) {
        collectBoundNames(
          (prop as { value?: unknown; argument?: unknown }).value ??
            (prop as { argument?: unknown }).argument,
          out,
        );
      }
      return;
  }
}

/**
 * Finds the function literals a value holds itself: the value is the
 * function, or it sits in an object or array literal, a conditional, or a
 * class body. Stops at a call, so a function handed to one as an argument,
 * or invoked by it, is not held by whatever the call's result is bound to.
 * Those count on their own wherever they appear.
 */
function collectHeldFunctions(node: unknown, out: FunctionLikeNode[]): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectHeldFunctions(item, out);
    return;
  }
  if (!isNode(node)) return;
  const n = node;

  if (isFunctionLikeNode(n)) {
    out.push(n);
    return;
  }
  if (n.type === "CallExpression" || n.type === "NewExpression") return;

  const record = n as unknown as Record<string, unknown>;
  for (const key in record) {
    if (key === "parent") continue;
    collectHeldFunctions(record[key], out);
  }
}

/**
 * Collects the functions each name in `node`'s own scope holds: `function
 * name() {}`, `class Name {}`, and the value of `const name = ...` or a
 * later `name = ...` or `name.prop = ...`, including a function inside an
 * object or array literal (see `collectHeldFunctions`). A function held
 * under a name counts as used as soon as the name is mentioned, however it
 * is mentioned, so this never has to work out how the name reaches the
 * function. Does not descend into a found function's own body: a name bound
 * inside it is only found once that function is itself resolved as
 * reachable, so it can be layered on top of (and correctly shadow) the outer
 * scope's names.
 */
function collectFunctionsByName(
  node: unknown,
  out: Map<string, FunctionLikeNode[]>,
): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectFunctionsByName(item, out);
    return;
  }
  if (!isNode(node)) return;
  const n = node;

  const bindTo = (names: string[], from: unknown): void => {
    const functions: FunctionLikeNode[] = [];
    collectHeldFunctions(from, functions);
    if (functions.length < 1) return;
    for (const name of names) {
      out.set(name, [...(out.get(name) ?? []), ...functions]);
    }
  };

  if (n.type === "FunctionDeclaration") {
    if (n.id?.name != null) bindTo([n.id.name], n);
    return;
  }
  if (n.type === "ClassDeclaration") {
    if (n.id?.name != null) bindTo([n.id.name], n);
    return;
  }
  if (isFunctionLikeNode(n)) return;
  if (n.type === "VariableDeclarator") {
    const decl = n as VariableDeclarator;
    if (decl.init != null) {
      const names: string[] = [];
      collectBoundNames(decl.id, names);
      bindTo(names, decl.init);
      collectFunctionsByName(decl.init, out);
    }
    return;
  }
  if (n.type === "AssignmentExpression") {
    const name = getAssignmentTargetName(n.left as Node);
    if (name != null) bindTo([name], n.right);
    collectFunctionsByName(n.right, out);
    return;
  }

  const record = n as unknown as Record<string, unknown>;
  for (const key in record) {
    if (key === "parent") continue;
    collectFunctionsByName(record[key], out);
  }
}

/**
 * Finds function literals directly nested in a reachable statement, without
 * descending past them -- their own reachability is decided separately.
 */
export function collectNestedFunctions(
  node: unknown,
  out: FunctionLikeNode[],
): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectNestedFunctions(item, out);
    return;
  }
  if (!isNode(node)) return;
  const n = node;

  if (isFunctionLikeNode(n)) {
    out.push(n);
    return;
  }

  const record = n as unknown as Record<string, unknown>;
  for (const key in record) {
    if (key === "parent") continue;
    collectNestedFunctions(record[key], out);
  }
}

/**
 * One scope of the used-function walk: the body of the root, or of a function
 * found to be used.
 */
export type UsedScope = {
  /** The function whose body this scope is, or `null` for the root. */
  fn: FunctionLikeNode | null;
  /** The statements and control-flow head expressions that can run here. */
  statements: readonly Node[];
  /**
   * The functions each name holds at this point, with a name bound in an
   * inner scope shadowing a same-named one further out.
   */
  functionsByName: ReadonlyMap<string, FunctionLikeNode[]>;
};

/**
 * Walks every scope that is actually reachable from `root`, calling `visit`
 * for each, and returns the set of function nodes found to be used: `root`
 * itself feeds a worklist, and each function it (or a function already on
 * the worklist) uses from *its own* reachable statements -- never from a
 * dead branch or some other not-yet-reached function's body -- gets queued in
 * turn. `outerFunctionsByName` is layered fresh for each scope, so a name
 * bound at an inner scope shadows a same-named one further out instead of
 * overwriting it globally, and a dead branch that merely mentions a name
 * never queues what it holds.
 */
export function walkUsedScopes(
  root: Node,
  visit: (scope: UsedScope) => void,
): Set<FunctionLikeNode> {
  const used = new Set<FunctionLikeNode>();
  const visited = new Set<Node>();

  const processScope = (
    scopeRoot: Node,
    scopeFn: FunctionLikeNode | null,
    outerFunctionsByName: ReadonlyMap<string, FunctionLikeNode[]>,
  ): void => {
    if (visited.has(scopeRoot)) return;
    visited.add(scopeRoot);

    const statements: Node[] = [];
    collectReachableStatements(scopeRoot, statements);

    const functionsHere = new Map<string, FunctionLikeNode[]>();
    for (const statement of statements) {
      collectFunctionsByName(statement, functionsHere);
    }
    const functionsByName = new Map(outerFunctionsByName);
    for (const [name, functions] of functionsHere) {
      functionsByName.set(name, functions);
    }
    visit({ fn: scopeFn, statements, functionsByName });

    const referencedNames = new Set<string>();
    for (const statement of statements) {
      collectReferencedNames(statement, referencedNames);
    }
    // A function held under a name counts as reached as soon as that name
    // is mentioned at all -- called, passed along, aliased, destructured,
    // passed to `console.log`, stored in a variable, anything -- not only
    // when it's actually invoked. That's what lets `recipients.map(deliver)`
    // and `const { deliver } = handlers` resolve as used without this code
    // having to know that `map` invokes its argument or how a destructured
    // property gets from the object to the call. Telling a real invocation
    // apart from merely holding a reference would need following every
    // shape a function value can travel in and knowing which APIs call what
    // they're given, which is more than this rule should carry, and any
    // shape it missed would report code that delivers. The cost is a
    // narrow false negative: a function that's only logged or reassigned,
    // never called, is not reported. That is accepted deliberately, since
    // missing a case here is the safe direction. Leave this as is.
    const reached = new Set<FunctionLikeNode>();
    for (const [name, functions] of functionsByName) {
      if (!referencedNames.has(name)) continue;
      for (const fn of functions) reached.add(fn);
    }

    // Every other function literal counts wherever it appears: a callback
    // handed to `map`, `forEach`, `queue.push` or a call the rule has never
    // heard of, an immediately invoked function, a returned closure. The
    // rule cannot show that the receiving code never runs it, and it does
    // not check whether the result is awaited: a delivery call that is
    // never awaited is left alone too. Leave this as is.
    const held = new Set<FunctionLikeNode>();
    for (const functions of functionsHere.values()) {
      for (const fn of functions) held.add(fn);
    }
    for (const statement of statements) {
      const nested: FunctionLikeNode[] = [];
      collectNestedFunctions(statement, nested);
      for (const fn of nested) {
        if (!held.has(fn)) reached.add(fn);
      }
    }

    for (const reachedFn of reached) {
      used.add(reachedFn);
      processScope(reachedFn.body as Node, reachedFn, functionsByName);
    }
  };

  processScope(root, null, new Map());
  return used;
}

/**
 * The set of function nodes that are actually reachable from `root`. See
 * `walkUsedScopes`.
 */
export function computeUsedFunctions(root: Node): Set<FunctionLikeNode> {
  return walkUsedScopes(root, () => {});
}

/**
 * A node's `[start, end)` character offsets into the whole source file.
 * Both engines always populate this -- ESLint forces it on regardless of
 * parser options, and Deno.lint exposes it the same way as every other
 * child property (see the `for...in` note on why plain property access
 * still works even though it's not an own enumerable property).
 */
export function getRange(node: Node): readonly [number, number] {
  return (node as unknown as { range: [number, number] }).range;
}
