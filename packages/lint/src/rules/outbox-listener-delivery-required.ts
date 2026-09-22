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
  "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().";

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

const DELIVERY_METHOD_NAMES = new Set(["sendActivity", "forwardActivity"]);

type FunctionLikeNode =
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

const isFunctionLikeNode = (node: Node): node is FunctionLikeNode =>
  FUNCTION_NODE_TYPES.has(node.type);

const getMemberPropertyName = (expr: Expression): string | null => {
  if (expr.type !== "MemberExpression") return null;
  const property = expr.property as Node;
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }
  return null;
};

function unwrapContextParam(node: Node | undefined): Node | null {
  let current: Node | null = node ?? null;
  while (current?.type === "AssignmentPattern") {
    current = (current as AssignmentPattern).left as Node;
  }
  return current;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripCommentsAndStrings(code: string): string {
  let result = "";
  let index = 0;

  const skipQuotedString = (quote: "'" | '"'): void => {
    const start = index;
    index += 1;
    while (index < code.length) {
      const char = code[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      index += 1;
      if (char === quote) break;
    }
    const literal = code.slice(start, index);
    const value = literal.slice(1, -1);
    result += DELIVERY_METHOD_NAMES.has(value) ? literal : `${quote}${quote}`;
  };

  const stripTemplateLiteral = (): void => {
    const start = index;
    index += 1;
    let raw = "";
    let hasExpression = false;

    while (index < code.length) {
      const char = code[index];
      if (char === "\\") {
        raw += char;
        raw += code[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (char === "`") {
        index += 1;
        if (!hasExpression && DELIVERY_METHOD_NAMES.has(raw)) {
          result += code.slice(start, index);
        } else {
          result += "``";
        }
        return;
      }
      if (char === "$" && code[index + 1] === "{") {
        hasExpression = true;
        result += "`${";
        index += 2;
        let depth = 1;
        while (index < code.length && depth > 0) {
          const exprChar = code[index];
          const next = code[index + 1];
          if (exprChar === "'" || exprChar === '"') {
            skipQuotedString(exprChar);
            continue;
          }
          if (exprChar === "`") {
            stripTemplateLiteral();
            continue;
          }
          if (exprChar === "/" && next === "*") {
            index += 2;
            while (index < code.length) {
              if (code[index] === "*" && code[index + 1] === "/") {
                index += 2;
                break;
              }
              index += 1;
            }
            continue;
          }
          if (exprChar === "/" && next === "/") {
            index += 2;
            while (index < code.length && code[index] !== "\n") {
              index += 1;
            }
            continue;
          }
          result += exprChar;
          index += 1;
          if (exprChar === "{") depth += 1;
          else if (exprChar === "}") depth -= 1;
        }
        continue;
      }
      raw += char;
      index += 1;
    }

    result += "``";
  };

  while (index < code.length) {
    const char = code[index];
    const next = code[index + 1];

    if (char === "/" && next === "*") {
      index += 2;
      while (index < code.length) {
        if (code[index] === "*" && code[index + 1] === "/") {
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      index += 2;
      while (index < code.length && code[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      skipQuotedString(char);
      continue;
    }
    if (char === "`") {
      stripTemplateLiteral();
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

function getDeliveryAliasName(node: Node): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "AssignmentPattern" && node.left.type === "Identifier") {
    return node.left.name;
  }
  return null;
}

function buildContextExpressionPattern(contextName: string): string {
  const name = escapeRegExp(contextName);
  const boundedName = String.raw`(?<![\w$])${name}(?![\w$])`;
  return String
    .raw`(?:${boundedName}|\(\s*${boundedName}(?:\s+as\s+[^)]+)?\s*\))`;
}

/**
 * Resolves an expression to the function it refers to: a direct function
 * literal, a local variable bound to one, or a property of a local object
 * literal bound to one (e.g. `handlers.deliver` where
 * `const handlers = { deliver() {} }`). Used both to resolve a listener
 * argument (`.on(Activity, handler)`) and to resolve what a call expression
 * inside a listener actually invokes.
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

// ---------------------------------------------------------------------------
// Reachability: which statements can actually run, following control flow
// (if/else, try/catch/finally, switch, loops) but never descending into a
// nested function's own body, and pruning dead code (a statically-falsy `if`
// branch, or anything after a statement that always returns/throws).
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

function collectReachableStatements(node: Node, out: Node[]): void {
  switch (node.type) {
    case "BlockStatement":
      for (const statement of node.body) {
        collectReachableStatements(statement as Node, out);
        if (alwaysExits(statement as Node)) return;
      }
      return;

    case "IfStatement": {
      const test = node.test as Expression;
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
      for (const switchCase of node.cases) {
        for (const statement of switchCase.consequent) {
          collectReachableStatements(statement as Node, out);
          if (alwaysExits(statement as Node)) break;
        }
      }
      return;

    case "WhileStatement":
    case "DoWhileStatement":
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
      collectReachableStatements(node.body as Node, out);
      return;

    case "LabeledStatement":
    case "WithStatement":
      collectReachableStatements(node.body as Node, out);
      return;

    default:
      out.push(node);
      return;
  }
}

// ---------------------------------------------------------------------------
// What a listener (or a helper's own body) resolves to when scanned for a
// delivery call: three independent mechanisms decide which nested function
// bodies are folded into the scan instead of being masked out.
// ---------------------------------------------------------------------------

/**
 * Collects plain-value references to identifiers: `deliver()`,
 * `forEach(deliver)`, a shorthand `{ deliver }`, and so on. Skips positions
 * that name something rather than reference a value -- a declaration's own
 * `id`/params, and the non-computed `.property` of a member expression (so
 * `someService.deliver()` never counts as a reference to an unrelated local
 * `deliver`).
 */
function collectReferencedNames(node: unknown, out: Set<string>): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectReferencedNames(item, out);
    return;
  }
  if (!isNode(node)) return;
  const n = node;

  if (n.type === "Identifier") {
    out.add(n.name);
    return;
  }
  if (n.type === "MemberExpression" && !n.computed) {
    collectReferencedNames(n.object, out);
    return;
  }
  if (n.type === "Property" && !n.computed) {
    // `{ deliver: fn }` -- the key is a name, not a reference; only the
    // value is (for shorthand `{ deliver }`, the value is the same name,
    // so this still counts it).
    collectReferencedNames(n.value, out);
    return;
  }
  if (n.type === "VariableDeclarator") {
    if ((n as VariableDeclarator).init != null) {
      collectReferencedNames((n as VariableDeclarator).init, out);
    }
    return;
  }
  if (isFunctionLikeNode(n)) {
    collectReferencedNames((n as { body: unknown }).body, out);
    return;
  }

  const record = n as unknown as Record<string, unknown>;
  for (const key in record) {
    if (key === "parent") continue;
    collectReferencedNames(record[key], out);
  }
}

/**
 * Collects every named local helper in scope: a `function name() {}`
 * declaration, or a `const name = function/arrow` binding. Object-literal
 * properties are handled separately, through `resolveFunctionBinding`,
 * since their name is only meaningful together with the object it lives on.
 */
function collectNamedHelpers(
  node: unknown,
  out: Map<string, FunctionLikeNode>,
): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectNamedHelpers(item, out);
    return;
  }
  if (!isNode(node)) return;
  const n = node;

  if (n.type === "FunctionDeclaration") {
    if (n.id?.name != null) out.set(n.id.name, n as FunctionLikeNode);
    collectNamedHelpers((n as { body: unknown }).body, out);
    return;
  }
  if (
    n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression"
  ) {
    collectNamedHelpers((n as { body: unknown }).body, out);
    return;
  }
  if (n.type === "VariableDeclarator") {
    const decl = n as VariableDeclarator;
    if (decl.id.type === "Identifier" && decl.init != null) {
      const init = decl.init as Node;
      if (isFunctionLikeNode(init)) out.set(decl.id.name, init);
    }
    if (decl.init != null) collectNamedHelpers(decl.init, out);
    return;
  }

  const record = n as unknown as Record<string, unknown>;
  for (const key in record) {
    if (key === "parent") continue;
    collectNamedHelpers(record[key], out);
  }
}

/**
 * Resolves every call expression's callee against `bindings` (a local
 * helper, or a property of a local object literal bound to one) and
 * collects the functions those calls resolve to. This is also how a
 * directly invoked function expression -- `(() => {...})()` -- gets found:
 * `resolveFunctionBinding` returns a function literal callee as-is.
 */
function collectResolvedCallTargets(
  node: unknown,
  bindings: Map<string, unknown>,
  out: Set<FunctionLikeNode>,
): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectResolvedCallTargets(item, bindings, out);
    return;
  }
  if (!isNode(node)) return;
  const n = node;

  if (n.type === "CallExpression") {
    const resolved = resolveFunctionBinding(n.callee as Expression, bindings);
    if (resolved != null) out.add(resolved);
  }

  const record = n as unknown as Record<string, unknown>;
  for (const key in record) {
    if (key === "parent") continue;
    collectResolvedCallTargets(record[key], bindings, out);
  }
}

/**
 * Collects anonymous function-literal arguments that are reachable because
 * the call chain they are passed to is awaited or returned, e.g. the arrow
 * function in `await Promise.all(recipients.map((inbox) => ...))`. Named
 * references passed the same way (`recipients.map(deliver)`) don't need
 * this: `collectReferencedNames` already finds them regardless of whether
 * the result is awaited, matching how `array.forEach(deliver)` always
 * invokes `deliver`.
 */
function collectConsumedCallbacks(
  statements: readonly Node[],
  impliedReturn: boolean,
  out: Set<FunctionLikeNode>,
): void {
  const walkConsumed = (expr: unknown): void => {
    if (expr == null || typeof expr !== "object" || Array.isArray(expr)) {
      return;
    }
    if (!isNode(expr)) return;
    if (isFunctionLikeNode(expr)) {
      out.add(expr);
      return;
    }
    if (expr.type === "CallExpression" || expr.type === "NewExpression") {
      for (const arg of expr.arguments) walkConsumed(arg);
      return;
    }
  };

  for (const statement of statements) {
    if (statement.type === "ReturnStatement") {
      if (statement.argument != null) walkConsumed(statement.argument);
      continue;
    }
    if (
      statement.type === "ExpressionStatement" &&
      statement.expression.type === "AwaitExpression"
    ) {
      walkConsumed(statement.expression.argument);
      continue;
    }
    if (statement.type === "VariableDeclaration") {
      for (const decl of statement.declarations) {
        const init = (decl as VariableDeclarator).init as
          | Node
          | null
          | undefined;
        if (init?.type === "AwaitExpression") {
          walkConsumed((init as { argument: unknown }).argument);
        }
      }
    }
  }

  if (impliedReturn && statements.length === 1) {
    const [only] = statements;
    if (only.type !== "BlockStatement") walkConsumed(only);
  }
}

/**
 * Finds function literals directly nested in a reachable statement, without
 * descending past them -- their own reachability is decided separately.
 */
function collectNestedFunctions(
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
 * Builds the source text to scan for a delivery call: the reachable
 * statements of `root`, with every nested function literal either folded in
 * (its own reachable text spliced in place) or blanked out, depending on
 * whether `used` says it is actually invoked.
 */
function collectDeliveryScanCode(
  sourceCode: { getText(node: unknown): string },
  root: Node,
  used: Set<FunctionLikeNode>,
  visited: Set<Node>,
): string {
  if (visited.has(root)) return "";
  visited.add(root);

  const statements: Node[] = [];
  collectReachableStatements(root, statements);

  const consumed = new Set<FunctionLikeNode>();
  collectConsumedCallbacks(
    statements,
    root.type !== "BlockStatement",
    consumed,
  );

  return statements
    .map((statement) => {
      let text = sourceCode.getText(statement);
      const nested: FunctionLikeNode[] = [];
      collectNestedFunctions(statement, nested);
      for (const fn of nested) {
        const fnText = sourceCode.getText(fn);
        const replacement = used.has(fn) || consumed.has(fn)
          ? collectDeliveryScanCode(sourceCode, fn.body as Node, used, visited)
          : "";
        text = text.split(fnText).join(
          replacement.length > 0 ? replacement : "()=>{}",
        );
      }
      return text;
    })
    .join("\n");
}

const listenerCallsDeliveryMethod = (
  sourceCode: { getText(node: unknown): string },
  listener: FunctionLikeNode,
  bindings: Map<string, unknown>,
): boolean => {
  const usedFunctions = new Set<FunctionLikeNode>();
  const referencedNames = new Set<string>();
  collectReferencedNames(listener.body, referencedNames);
  const namedHelpers = new Map<string, FunctionLikeNode>();
  collectNamedHelpers(listener.body, namedHelpers);
  for (const [name, fn] of namedHelpers) {
    if (referencedNames.has(name)) usedFunctions.add(fn);
  }
  collectResolvedCallTargets(listener.body, bindings, usedFunctions);

  const code = stripCommentsAndStrings(
    collectDeliveryScanCode(
      sourceCode,
      listener.body as Node,
      usedFunctions,
      new Set(),
    ),
  );
  const aliases = new Set<string>();
  const contextParam = unwrapContextParam(
    listener.params[0] as Node | undefined,
  );
  const contextName = contextParam?.type === "Identifier"
    ? contextParam.name
    : null;

  if (contextParam?.type === "ObjectPattern") {
    for (const prop of contextParam.properties) {
      if (!isNode(prop) || prop.type !== "Property") continue;
      const keyName = prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal" && typeof prop.key.value === "string"
        ? prop.key.value
        : null;
      if (keyName == null || !DELIVERY_METHOD_NAMES.has(keyName)) continue;
      const alias = getDeliveryAliasName(prop.value as Node);
      if (alias != null) aliases.add(alias);
    }
  }

  if (contextName != null) {
    const contextExpr = buildContextExpressionPattern(contextName);
    const memberPattern = new RegExp(
      String
        .raw`${contextExpr}\s*(?:\?\s*\.\s*(?:sendActivity|forwardActivity)|\.\s*(?:sendActivity|forwardActivity)|\?\s*\.\s*\[\s*["'\`](?:sendActivity|forwardActivity)["'\`]\s*\]|\[\s*["'\`](?:sendActivity|forwardActivity)["'\`]\s*\])\s*\(`,
    );
    if (memberPattern.test(code)) return true;

    const destructuringPattern = new RegExp(
      String.raw`(?:const|let|var)\s*{([^}]*)}\s*=\s*${contextExpr}`,
      "g",
    );
    for (const match of code.matchAll(destructuringPattern)) {
      const fields = match[1].split(",").map((field) => field.trim()).filter(
        Boolean,
      );
      for (const field of fields) {
        const [sourceName, aliasName] = field.split(":").map((part) =>
          part.trim()
        );
        if (!DELIVERY_METHOD_NAMES.has(sourceName)) continue;
        aliases.add(aliasName ?? sourceName);
      }
    }

    const aliasPattern = new RegExp(
      String
        .raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${contextExpr}\s*(?:\?\s*\.\s*(sendActivity|forwardActivity)|\.\s*(sendActivity|forwardActivity)|\?\s*\.\s*\[\s*["'\`](sendActivity|forwardActivity)["'\`]\s*\]|\[\s*["'\`](sendActivity|forwardActivity)["'\`]\s*\])`,
      "g",
    );
    for (const match of code.matchAll(aliasPattern)) {
      aliases.add(match[1]);
    }
  }

  return globalThis.Array.from(aliases).some((alias) =>
    new RegExp(String.raw`\b${escapeRegExp(alias)}\s*\(`).test(code)
  );
};

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
    const sourceCode =
      (context as { sourceCode: { getText(node: unknown): string } })
        .sourceCode;

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

      if (
        listenerCallsDeliveryMethod(sourceCode, resolvedListener, bindings)
      ) {
        return;
      }

      (context as { report: (arg: unknown) => void }).report({
        node: resolvedListener,
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
        "Warn when an outbox listener omits explicit delivery methods",
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
