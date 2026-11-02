import type { Node } from "./types.ts";

/** Options for checking additional generated vocabulary modules. */
export interface RawPropertyIriOptions {
  modules?: readonly string[];
}

/** A statically known property IRI and its suggested expansion, if any. */
export interface RawPropertyIriDiagnostic {
  node: Node;
  messageId: "invalid" | "nonHttp";
  value: string;
  replacement?: string;
  suggestionNode?: Node;
}

// A structural view keeps the analysis independent of the three AST providers.
type Ast = { type: string; [key: string]: unknown };
interface Binding {
  imported?: string;
  namespace?: boolean;
  init?: Ast;
}
interface Scope {
  parent?: Scope;
  functionScope: boolean;
  bindings: Map<string, Binding>;
}

const functions = new Set([
  "getRawPropertyValues",
  "getRawPropertyValue",
]);
const prefixes: Readonly<Record<string, string>> = {
  as: "https://www.w3.org/ns/activitystreams#",
  dcterms: "http://purl.org/dc/terms/",
  fedibird: "http://fedibird.com/ns#",
  ldp: "http://www.w3.org/ns/ldp#",
  litepub: "http://litepub.social/ns#",
  misskey: "https://misskey-hub.net/ns#",
  schema: "http://schema.org#",
  sec: "https://w3id.org/security#",
  toot: "http://joinmastodon.org/ns#",
  vcard: "http://www.w3.org/2006/vcard/ns#",
};

function ast(value: unknown): Ast | undefined {
  return value != null && typeof value === "object" &&
      typeof (value as Ast).type === "string"
    ? value as Ast
    : undefined;
}
function name(value: unknown): string | undefined {
  const node = ast(value);
  return node?.type === "Identifier"
    ? node.name as string
    : typeof node?.value === "string"
    ? node.value
    : undefined;
}
function children(node: Ast): Ast[] {
  const result: Ast[] = [];
  // Deno exposes AST fields through non-enumerable getters.  Include its
  // standard child fields explicitly, while retaining parser-specific fields
  // from ESTree providers.  Never follow parent pointers.
  const keys = new Set([
    ...Object.keys(node),
    "declaration",
    "openingElement",
    "closingElement",
    "attributes",
    "decorators",
    "parameter",
    "body",
    "expression",
    "expressions",
    "declarations",
    "id",
    "init",
    "params",
    "param",
    "callee",
    "arguments",
    "object",
    "property",
    "key",
    "value",
    "properties",
    "elements",
    "left",
    "right",
    "argument",
    "test",
    "consequent",
    "alternate",
    "block",
    "handler",
    "finalizer",
    "cases",
    "discriminant",
    "update",
    "specifiers",
    "local",
    "imported",
    "source",
    "superClass",
    "tag",
    "quasi",
    "quasis",
    "children",
  ]);
  for (const key of keys) {
    // ESTree providers attach the token and comment arrays to Program:
    if (key === "parent" || key === "tokens" || key === "comments") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = ast(item);
        if (child) result.push(child);
      }
    } else {
      const child = ast(value);
      if (child) result.push(child);
    }
  }
  return result;
}
function bind(pattern: unknown, scope: Scope, binding: Binding = {}): void {
  const node = ast(pattern);
  if (!node) return;
  if (node.type === "Identifier") {
    scope.bindings.set(node.name as string, binding);
  } else if (node.type === "TSParameterProperty") {
    bind(node.parameter, scope);
  } else if (node.type === "RestElement") {
    bind(node.argument, scope);
  } else if (node.type === "AssignmentPattern") {
    bind(node.left, scope);
  } else if (node.type === "ObjectPattern") {
    for (const property of node.properties as Ast[]) {
      bind(
        property.type === "RestElement" ? property.argument : property.value,
        scope,
      );
    }
  } else if (node.type === "ArrayPattern") {
    for (const element of node.elements as unknown[]) bind(element, scope);
  }
}
function lookup(
  scope: Scope | undefined,
  identifier: string,
): Binding | undefined {
  for (; scope; scope = scope.parent) {
    if (scope.bindings.has(identifier)) return scope.bindings.get(identifier);
  }
}

/**
 * Analyze a complete program after collecting lexical bindings, including
 * declarations that shadow imports before their textual declaration.
 */
export function checkRawPropertyIris(
  program: Node,
  options: RawPropertyIriOptions,
  report: (diagnostic: RawPropertyIriDiagnostic) => void,
): void {
  const scopes = new WeakMap<Ast, Scope>();
  const calls: Ast[] = [];
  const root: Scope = { functionScope: true, bindings: new Map() };
  function visit(node: Ast, outer: Scope): void {
    const isFunction =
      /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/
        .test(node.type);
    if (
      node.type === "FunctionDeclaration" || node.type === "ClassDeclaration"
    ) {
      bind(node.id, outer);
    }
    const scoped = isFunction || [
      "BlockStatement",
      "CatchClause",
      "ForStatement",
      "ForInStatement",
      "ForOfStatement",
      "SwitchStatement",
      "ClassExpression",
      "ClassDeclaration",
      "StaticBlock",
    ].includes(node.type);
    const scope: Scope = scoped
      ? {
        parent: outer,
        functionScope: isFunction || node.type === "StaticBlock",
        bindings: new Map(),
      }
      : outer;
    scopes.set(node, scope);
    if (isFunction) {
      if (node.type === "FunctionExpression") bind(node.id, scope);
      for (const param of node.params as unknown[]) bind(param, scope);
    }
    if (node.type === "ClassExpression" || node.type === "ClassDeclaration") {
      bind(node.id, scope);
    }
    if (node.type === "CatchClause") bind(node.param, scope);
    if (node.type === "ImportDeclaration") {
      const source = name(node.source);
      const included = source != null && (
        /^(?:jsr:|npm:)?@fedify\/vocab(?:@[^/]+)?$/.test(source) ||
        /^(?:jsr:|npm:)?@fedify\/fedify(?:@[^/]+)?\/vocab$/.test(source) ||
        options.modules?.includes(source)
      );
      for (const specifier of node.specifiers as Ast[]) {
        bind(
          specifier.local,
          scope,
          included && node.importKind !== "type" &&
            specifier.importKind !== "type"
            ? {
              imported: name(specifier.imported),
              namespace: specifier.type === "ImportNamespaceSpecifier",
            }
            : {},
        );
      }
    }
    if (node.type === "VariableDeclaration") {
      let target = scope;
      if (node.kind === "var") {
        while (!target.functionScope && target.parent) target = target.parent;
      }
      for (const declaration of node.declarations as Ast[]) {
        bind(
          declaration.id,
          target,
          node.kind === "const" ? { init: ast(declaration.init) } : {},
        );
      }
    }
    if (node.type === "CallExpression") calls.push(node);
    for (const child of children(node)) {
      // The discriminant of a switch is evaluated outside its case scope:
      visit(
        child,
        node.type === "SwitchStatement" && child === node.discriminant
          ? outer
          : scope,
      );
    }
  }
  visit(program as unknown as Ast, root);

  function staticString(
    node: Ast | undefined,
    seen = new Set<Ast>(),
    bound = false,
  ): { value: string; literal: Ast } | undefined {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (node.type === "Literal" && typeof node.value === "string") {
      // Deno replaces escaped lone surrogates in Literal.value with U+FFFD.
      // JSON-compatible raw literals retain their exact code units.
      if (typeof node.raw === "string" && node.raw.startsWith('"')) {
        try {
          const value: unknown = JSON.parse(node.raw);
          if (typeof value === "string") return { value, literal: node };
        } catch {
          // JavaScript-only escapes (such as \x20) use the parser's value.
        }
      }
      return { value: node.value, literal: node };
    }
    if (
      node.type === "TemplateLiteral" &&
      (node.expressions as unknown[]).length === 0
    ) {
      const quasi = (node.quasis as Ast[])[0];
      const value = (quasi.value as { cooked?: string } | undefined)?.cooked ??
        quasi.cooked;
      if (typeof value === "string") return { value, literal: node };
    }
    if (node.type === "Identifier") {
      return staticString(
        lookup(scopes.get(node), node.name as string)?.init,
        seen,
        true,
      );
    }
    if (
      // A URL object bound to a const can still be mutated, e.g., through its
      // href setter, so only a URL constructed in place is known statically:
      !bound &&
      node.type === "NewExpression" && name(node.callee) === "URL" &&
      ast(node.callee)?.type === "Identifier" &&
      !lookup(scopes.get(node), "URL")
    ) {
      const args = node.arguments as Ast[];
      if (args.length !== 1) return undefined;
      const known = staticString(args[0], seen);
      // The raw-property functions see the URL's serialization, which the
      // WHATWG URL parser normalizes, e.g., by percent-encoding spaces:
      if (known == null || !URL.canParse(known.value)) return known;
      return { ...known, value: new URL(known.value).href };
    }
  }
  function check(node: Ast): void {
    const known = staticString(node);
    if (!known) return;
    const value = known.value;
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value);
    const rest = scheme == null ? "" : value.slice(scheme[0].length);
    let path = rest;
    if (rest.startsWith("//")) {
      const end = rest.slice(2).search(/[/?#]/);
      path = end < 0 ? "" : rest.slice(2 + end);
    }
    // These checks follow the raw-property API's IRI syntax contract, rather
    // than WHATWG URL parsing (which normalizes spaces and malformed escapes).
    if (
      !scheme || rest === "" || value.startsWith("_:") ||
      path.includes("[") || path.includes("]") ||
      /["<>\\^`{|}]/u.test(value) ||
      Array.from(value).some((char) => {
        const code = char.codePointAt(0)!;
        return code <= 0x20 || (code >= 0x7f && code <= 0x9f) ||
          (code >= 0xd800 && code <= 0xdfff);
      }) ||
      /%(?![\da-f]{2})/i.test(value) ||
      value.indexOf("#") !== value.lastIndexOf("#")
    ) {
      report({ node: node as unknown as Node, messageId: "invalid", value });
    } else if (!/^https?$/i.test(scheme[1])) {
      const prefixName = scheme[1].toLowerCase();
      const prefix = Object.hasOwn(prefixes, prefixName)
        ? prefixes[prefixName]
        : undefined;
      const replacement = prefix == null
        ? undefined
        : prefix + value.slice(scheme[0].length);
      report({
        node: node as unknown as Node,
        messageId: "nonHttp",
        value,
        replacement,
        // Never suggest changing a const declaration shared by other uses.
        suggestionNode: known.literal === node ||
            (node.type === "NewExpression" &&
              (node.arguments as unknown[])[0] === known.literal)
          ? known.literal as unknown as Node
          : undefined,
      });
    }
  }
  for (const call of calls) {
    const callee = ast(call.callee);
    let functionName: string | undefined;
    if (callee?.type === "Identifier") {
      functionName = lookup(scopes.get(callee), callee.name as string)
        ?.imported;
    } else if (
      callee?.type === "MemberExpression" &&
      ast(callee.object)?.type === "Identifier"
    ) {
      if (lookup(scopes.get(callee), name(callee.object)!)?.namespace) {
        functionName = callee.computed
          ? staticString(ast(callee.property))?.value
          : name(callee.property);
      }
    }
    if (!functionName || !functions.has(functionName)) continue;
    const argument = ast((call.arguments as unknown[])[1]);
    if (argument) check(argument);
  }
}
