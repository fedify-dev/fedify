import type { Rule } from "eslint";
import {
  createOutboxListenerVisitor,
  DELIVERY_METHOD_NAMES,
  unwrapContextParam,
} from "../lib/outbox-listener.ts";
import { isNode } from "../lib/pred.ts";
import {
  collectNestedFunctions,
  collectReachableStatements,
  computeUsedFunctions,
  type FunctionLikeNode,
  getRange,
} from "../lib/reachability.ts";
import type { Node } from "../lib/types.ts";

const MESSAGE =
  "Outbox listeners should deliver posted activities explicitly with ctx.sendActivity() or ctx.forwardActivity().";

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
 * Builds the source text to scan for a delivery call: the reachable
 * statements of `root`, with every nested function literal either folded
 * in (its own reachable text spliced in place, wherever that function's
 * own declaration happens to live) or blanked out, depending on whether
 * `used` (from `computeUsedFunctions`) says it is actually invoked.
 *
 * Splices each function by its own range rather than by matching its
 * source text, and applies the splices from the end of the statement
 * backward. That keeps two functions with byte-identical bodies (e.g. two
 * object-literal methods that both merely call `ctx.sendActivity(...)`)
 * from colliding: a text-based replacement would find and blank out both
 * occurrences the first time either one is processed, since it matches by
 * content everywhere in the statement rather than by which node is
 * actually being replaced. Replacing from the end backward also means a
 * later replacement's length change never shifts the still-unprocessed
 * offsets of an earlier one.
 */
function collectDeliveryScanCode(
  sourceCode: { getText(node: unknown): string },
  root: Node,
  used: ReadonlySet<FunctionLikeNode>,
  visited: Set<Node>,
): string {
  if (visited.has(root)) return "";
  visited.add(root);

  const statements: Node[] = [];
  collectReachableStatements(root, statements);

  return statements
    .map((statement) => {
      const text = sourceCode.getText(statement);
      const [statementStart] = getRange(statement);

      const nested: FunctionLikeNode[] = [];
      collectNestedFunctions(statement, nested);
      const byDescendingStart = [...nested].sort((a, b) =>
        getRange(b)[0] - getRange(a)[0]
      );

      let result = text;
      for (const fn of byDescendingStart) {
        const [fnStart, fnEnd] = getRange(fn);
        const replacement = used.has(fn)
          ? collectDeliveryScanCode(sourceCode, fn.body as Node, used, visited)
          : "";
        // A method's range starts right after its key (`go` in `go() {}`)
        // on some parsers, so keep the spliced text apart from what
        // surrounds it, or `go` and `ctx` fuse into a single `goctx`.
        result = result.slice(0, fnStart - statementStart) +
          `\n${replacement.length > 0 ? replacement : "()=>{}"}\n` +
          result.slice(fnEnd - statementStart);
      }
      return result;
    })
    .join("\n");
}

const listenerCallsDeliveryMethod = (
  sourceCode: { getText(node: unknown): string },
  listener: FunctionLikeNode,
): boolean => {
  const used = computeUsedFunctions(listener.body as Node);
  const code = stripCommentsAndStrings(
    collectDeliveryScanCode(
      sourceCode,
      listener.body as Node,
      used,
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
    const sourceCode =
      (context as { sourceCode: { getText(node: unknown): string } })
        .sourceCode;

    return createOutboxListenerVisitor((listener) => {
      if (listenerCallsDeliveryMethod(sourceCode, listener)) return;

      (context as { report: (arg: unknown) => void }).report({
        node: listener,
        ...buildReport,
      });
    });
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
