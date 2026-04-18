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

const resolveListenerReference = (
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
      return resolveListenerReference(binding, bindings, seen);
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

const listenerCallsDeliveryMethod = (
  sourceCode: { getText(node: unknown): string },
  listener: FunctionLikeNode,
): boolean => {
  const code = stripCommentsAndStrings(sourceCode.getText(listener));
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
    const sourceCode =
      (context as { sourceCode: { getText(node: unknown): string } })
        .sourceCode;
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

        if (listenerCallsDeliveryMethod(sourceCode, resolvedListener)) return;

        (context as { report: (arg: unknown) => void }).report({
          node: resolvedListener,
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
