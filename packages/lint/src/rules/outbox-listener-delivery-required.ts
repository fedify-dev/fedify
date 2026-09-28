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

const getMemberPropertyName = (expr: Expression): string | null => {
  if (expr.type !== "MemberExpression") return null;
  const property = expr.property as Node;
  if (property.type === "Identifier" && !expr.computed) return property.name;
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

// Both linters attach parent links before the exit visitor runs.
const getParent = (node: Node): Node | null =>
  (node as Node & { parent?: Node }).parent ?? null;

const isFunctionLike = (node: Node): node is FunctionLikeNode =>
  node.type === "FunctionDeclaration" || isFunction(node as Expression);

interface Binding {
  value: Node | null;
  initializedVariable?: boolean;
}

type Bindings = Map<string, Binding>;

function bindPattern(node: Node, bindings: Bindings): void {
  switch (node.type) {
    case "Identifier":
      bindings.set(node.name, { value: null });
      break;
    case "AssignmentPattern":
      bindPattern(node.left as Node, bindings);
      break;
    case "RestElement":
      bindPattern(node.argument as Node, bindings);
      break;
    case "ObjectPattern":
      for (const property of node.properties) {
        bindPattern(
          property.type === "Property"
            ? property.value as Node
            : property as Node,
          bindings,
        );
      }
      break;
    case "ArrayPattern":
      for (const element of node.elements) {
        if (element != null) bindPattern(element as Node, bindings);
      }
      break;
  }
}

function createBindingIndex() {
  const scopes = new Map<Node, Bindings>();
  const scopeBindings = (scope: Node): Bindings => {
    let bindings = scopes.get(scope);
    if (bindings == null) {
      bindings = new Map();
      scopes.set(scope, bindings);
      if (isFunctionLike(scope)) {
        if (scope.type === "FunctionExpression" && scope.id != null) {
          bindings.set(scope.id.name, { value: scope });
        }
        for (const param of scope.params) bindPattern(param as Node, bindings);
      }
      if (scope.type === "ClassExpression" && scope.id != null) {
        bindings.set(scope.id.name, { value: null });
      }
      if (scope.type === "CatchClause" && scope.param != null) {
        bindPattern(scope.param as Node, bindings);
      }
    }
    return bindings;
  };

  const enclosingScope = (node: Node, functionScope = false): Node => {
    let scope = getParent(node)!;
    while (
      scope.type !== "Program" && scope.type !== "StaticBlock" &&
      scope.type !== "TSModuleBlock" &&
      !isFunctionLike(scope) &&
      (functionScope || ![
        "BlockStatement",
        "ForStatement",
        "ForInStatement",
        "ForOfStatement",
        "SwitchStatement",
        "CatchClause",
      ].includes(scope.type))
    ) scope = getParent(scope)!;
    return scope;
  };

  const lookup = (node: Node, name: string): Binding | null => {
    for (
      let scope: Node | null = node;
      scope != null;
      scope = getParent(scope)
    ) {
      const binding = scopeBindings(scope).get(name);
      if (binding != null) return binding;
    }
    return null;
  };

  return {
    lookup,
    declare(node: Node, pattern: Node, value: Node | null, hoisted = false) {
      const bindings = scopeBindings(enclosingScope(node, hoisted));
      if (pattern.type === "Identifier") {
        // An uninitialized var redeclaration does not replace its value.
        if (hoisted && value == null && bindings.has(pattern.name)) return;
        // Function declarations hoist before variable initializers execute.
        if (
          node.type === "FunctionDeclaration" &&
          bindings.get(pattern.name)?.initializedVariable
        ) return;
        bindings.set(pattern.name, {
          value,
          initializedVariable: node.type === "VariableDeclarator" &&
            value != null,
        });
      } else bindPattern(pattern, bindings);
    },
  };
}

type BindingIndex = ReturnType<typeof createBindingIndex>;

const resolveBindingValue = (
  expr: Node,
  bindings: BindingIndex,
  seen = new Set<Binding>(),
): Node | null => {
  if (expr.type !== "Identifier") return expr;
  const binding = bindings.lookup(expr, expr.name);
  if (binding == null || binding.value == null || seen.has(binding)) {
    return null;
  }
  seen.add(binding);
  // Follow aliases at their declaration, rather than in the caller's scope.
  return resolveBindingValue(binding.value, bindings, seen);
};

const resolveListenerReference = (
  expr: Expression,
  bindings: BindingIndex,
): FunctionLikeNode | null => {
  const target = resolveBindingValue(expr as Node, bindings);
  if (target == null) return null;
  if (isFunctionLike(target)) return target;
  if (target.type !== "MemberExpression") return null;
  const object = resolveBindingValue(target.object as Node, bindings);
  if (object?.type !== "ObjectExpression") return null;
  const propertyName = getMemberPropertyName(target);
  if (propertyName == null) return null;
  for (const prop of object.properties) {
    if (prop.type !== "Property") continue;
    const keyName = prop.key.type === "Identifier" && !prop.computed
      ? prop.key.name
      : prop.key.type === "Literal" && typeof prop.key.value === "string"
      ? prop.key.value
      : null;
    if (keyName !== propertyName) continue;
    const value = resolveBindingValue(prop.value as Node, bindings);
    if (value != null && isFunctionLike(value)) return value;
  }
  return null;
};

function unwrapArgument(node: Node): Node {
  while (
    node.type === "TSAsExpression" || node.type === "TSTypeAssertion" ||
    node.type === "TSNonNullExpression"
  ) node = node.expression as Node;
  return node;
}

function functionCallsDelivery(
  sourceCode: { getText(node: unknown): string },
  listener: FunctionLikeNode,
  bindings: BindingIndex,
  calls: readonly CallExpression[],
  contextIndex = 0,
  visited = new Map<FunctionLikeNode, Set<number>>(),
): boolean {
  let indices = visited.get(listener);
  if (indices?.has(contextIndex)) return false;
  if (indices == null) visited.set(listener, indices = new Set());
  indices.add(contextIndex);
  if (listenerCallsDeliveryMethod(sourceCode, listener, contextIndex)) {
    return true;
  }

  const param = unwrapContextParam(listener.params[contextIndex] as Node);
  if (param?.type !== "Identifier") return false;
  const contextBinding = bindings.lookup(listener, param.name);
  for (const call of calls) {
    // Calls in uncalled nested functions must not credit a module helper.
    let child = call as Node;
    let owner = getParent(child);
    while (owner != null && !isFunctionLike(owner)) {
      // AccessorProperty is emitted by both parsers but absent from Node's
      // declared union. Instance initializers are deferred; keys run now.
      const field = owner as { type: string; static?: boolean; value?: Node };
      if (
        (field.type === "PropertyDefinition" ||
          field.type === "AccessorProperty") &&
        !field.static && field.value === child
      ) break;
      child = owner;
      owner = getParent(owner);
    }
    if (owner !== listener) continue;
    const helper = resolveListenerReference(
      call.callee as Expression,
      bindings,
    );
    // Calling a generator creates an iterator without executing its body.
    if (helper == null || ("generator" in helper && helper.generator)) continue;
    for (const [index, argument] of call.arguments.entries()) {
      if (argument.type === "SpreadElement") break;
      const arg = unwrapArgument(argument as Node);
      if (
        arg.type !== "Identifier" || arg.name !== param.name ||
        bindings.lookup(arg, arg.name) !== contextBinding ||
        (helper.params[index] as Node | undefined)?.type === "RestElement"
      ) continue;
      if (
        functionCallsDelivery(
          sourceCode,
          helper,
          bindings,
          calls,
          index,
          visited,
        )
      ) return true;
    }
  }
  return false;
}

const listenerCallsDeliveryMethod = (
  sourceCode: { getText(node: unknown): string },
  listener: FunctionLikeNode,
  contextIndex = 0,
): boolean => {
  const code = stripCommentsAndStrings(sourceCode.getText(listener));
  const aliases = new Set<string>();
  const contextParam = unwrapContextParam(
    listener.params[contextIndex] as Node | undefined,
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
    const bindings = createBindingIndex();
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
          ? resolveListenerReference(listener as Expression, bindings)
          : null;
      if (resolvedListener == null) return;

      if (
        functionCallsDelivery(
          sourceCode,
          resolvedListener,
          bindings,
          pendingCalls,
        )
      ) return;

      (context as { report: (arg: unknown) => void }).report({
        node: resolvedListener,
        ...buildReport,
      });
    };

    return {
      VariableDeclarator(node: VariableDeclarator): void {
        federationTracker.VariableDeclarator(node);
        const declaration = getParent(node as Node) as
          | (Node & { kind?: string })
          | null;
        bindings.declare(
          node as Node,
          node.id as Node,
          node.init as Node | null,
          declaration?.kind === "var",
        );
      },

      FunctionDeclaration(
        node: Node & {
          type: "FunctionDeclaration";
          id: Identifier | null;
        },
      ): void {
        if (node.id == null) return;
        const parent = getParent(node);
        const owner = parent == null ? null : getParent(parent);
        const inVarBody = parent?.type === "BlockStatement" &&
          owner != null && (owner.type === "StaticBlock" ||
            (isFunctionLike(owner) && owner.body === parent));
        bindings.declare(node, node.id, node, inVarBody);
      },

      ImportDeclaration(
        node: Node & { specifiers: { local: Identifier }[] },
      ): void {
        for (const specifier of node.specifiers) {
          bindings.declare(node, specifier.local, null);
        }
      },

      ClassDeclaration(node: Node & { id: Identifier | null }): void {
        if (node.id != null) bindings.declare(node, node.id, null);
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
