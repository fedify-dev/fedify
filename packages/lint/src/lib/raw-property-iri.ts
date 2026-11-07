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
  /**
   * The names that declarations merged with this namespace or enum export.
   * It is set on the scopes of those, and only of those.
   */
  merged?: Set<string>;
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
    "members",
    "initializer",
  ]);
  for (const key of keys) {
    // ESTree providers attach the token and comment arrays to Program:
    if (key === "parent" || key === "tokens" || key === "comments") continue;
    // typescript-eslint keeps a deprecated copy of TSEnumBody.members here:
    if (
      key === "members" && node.type === "TSEnumDeclaration" &&
      ast(node.body) != null
    ) {
      continue;
    }
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
/**
 * Rewrites a single-quoted string literal's source as a double-quoted one, so
 * that `JSON.parse()` can decode its escapes.  Returns `null` for anything
 * other than a string literal.
 */
function toJsonString(raw: string): string | null {
  if (raw.startsWith('"')) return raw;
  if (!raw.startsWith("'")) return null;
  let result = '"';
  for (let i = 1; i < raw.length - 1; i++) {
    const char = raw[i];
    if (char === "\\") {
      const next = raw[++i];
      result += next === "'" ? "'" : char + next;
    } else {
      result += char === '"' ? '\\"' : char;
    }
  }
  return result + '"';
}

const IP_LITERAL_PATTERN = /^\[([^\[\]]*)\](?::[0-9]*)?$/;
const IP_FUTURE_PATTERN = /^v[0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+$/i;

/**
 * Checks that an authority has a numeric port, if any, and that square
 * brackets delimit an IPv6 address or an IPvFuture literal as the whole host,
 * as the runtime does.
 */
function isAuthoritySyntax(authority: string): boolean {
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  const userinfo = authority.slice(0, authority.length - hostPort.length);
  if (/[[\]]/.test(userinfo)) return false;
  if (!/[[\]]/.test(hostPort)) return /^[^:]*(?::[0-9]*)?$/.test(hostPort);
  const match = IP_LITERAL_PATTERN.exec(hostPort);
  if (match == null) return false;
  const literal = match[1];
  return IP_FUTURE_PATTERN.test(literal) ||
    URL.canParse(`http://[${literal}]/`);
}

/**
 * Whether a TypeScript namespace declares a value, as opposed to containing
 * only types.  Only such a namespace shadows an outer value binding.
 */
function isInstantiated(node: Ast): boolean {
  const body = ast(node.body);
  if (body == null) return true;
  if (body.type === "TSModuleDeclaration") return isInstantiated(body);
  for (const statement of (body.body ?? []) as Ast[]) {
    const declaration = statement.type === "ExportNamedDeclaration"
      ? ast(statement.declaration)
      : statement;
    if (declaration == null) continue;
    if (
      // A non-exported import alias does not make a namespace a value:
      (statement.type === "TSImportEqualsDeclaration" &&
        statement.isExport !== true) ||
      declaration.type === "TSInterfaceDeclaration" ||
      declaration.type === "TSTypeAliasDeclaration" ||
      (declaration.type === "TSModuleDeclaration" &&
        !isInstantiated(declaration))
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function lookup(
  scope: Scope | undefined,
  identifier: string,
): Binding | undefined {
  for (; scope; scope = scope.parent) {
    if (scope.bindings.has(identifier)) return scope.bindings.get(identifier);
    if (scope.merged?.has(identifier)) return {};
  }
}

/** Splits the name of a TypeScript namespace, which can be dotted. */
function qualifiedName(id: unknown): string[] {
  const node = ast(id);
  if (node?.type === "TSQualifiedName") {
    return [...qualifiedName(node.left), ...qualifiedName(node.right)];
  }
  const identifier = name(node);
  return identifier == null ? [] : [identifier];
}

/** Lists the values that the body of a TypeScript namespace exports. */
function exportedNames(block: Ast): string[] {
  const scope: Scope = { functionScope: true, bindings: new Map() };
  for (const statement of (block.body ?? []) as Ast[]) {
    const declaration = statement.type === "ExportNamedDeclaration"
      ? ast(statement.declaration)
      : statement.type === "TSImportEqualsDeclaration" &&
          statement.isExport === true
      ? statement
      : undefined;
    if (declaration?.type === "VariableDeclaration") {
      for (const variable of declaration.declarations as Ast[]) {
        bind(variable.id, scope);
      }
    } else if (
      declaration != null &&
      declaration.type !== "TSInterfaceDeclaration" &&
      declaration.type !== "TSTypeAliasDeclaration" &&
      (declaration.type !== "TSModuleDeclaration" ||
        isInstantiated(declaration))
    ) {
      bind(declaration.id, scope);
    }
  }
  return [...scope.bindings.keys()];
}

/**
 * Looks up a binding to follow for its value.  Another declaration of the same
 * namespace or enum can export a member that shadows an outer binding, so
 * the lookup does not leave such a scope.
 */
function lookupConstant(
  scope: Scope | undefined,
  identifier: string,
): Binding | undefined {
  for (; scope; scope = scope.parent) {
    if (scope.bindings.has(identifier)) return scope.bindings.get(identifier);
    if (scope.merged != null) return undefined;
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
  // TypeScript merges namespaces and enums of the same name in a scope, and
  // makes what each declaration exports visible in the others:
  const members = new Map<object, Map<string, Set<string>>>();
  const blockMembers = new WeakMap<Ast, Set<string>>();
  function mergedMembers(owner: object, id: string | undefined): Set<string> {
    if (id == null) return new Set();
    let names = members.get(owner);
    if (names == null) members.set(owner, names = new Map());
    let merged = names.get(id);
    if (merged == null) names.set(id, merged = new Set());
    return merged;
  }
  function visit(node: Ast, outer: Scope): void {
    if (node.type === "TSModuleDeclaration") {
      // Declarations nested in a merged namespace merge with each other, too,
      // and a dotted name stands for such a nesting:
      let owner: object = outer.merged ?? outer;
      let declaration: Ast | undefined = node;
      let body: Ast | undefined;
      for (; declaration?.type === "TSModuleDeclaration"; declaration = body) {
        body = ast(declaration.body);
        for (const id of qualifiedName(declaration.id)) {
          owner = mergedMembers(owner, id);
        }
      }
      if (body?.type === "TSModuleBlock" && !blockMembers.has(body)) {
        const merged = owner as Set<string>;
        blockMembers.set(body, merged);
        for (const exported of exportedNames(body)) merged.add(exported);
      }
    }
    const isFunction =
      /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/
        .test(node.type);
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "ClassDeclaration" ||
      // Enums and namespaces with values also declare a value binding:
      node.type === "TSEnumDeclaration" ||
      (node.type === "TSModuleDeclaration" && isInstantiated(node))
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
      "TSModuleBlock",
      "TSEnumDeclaration",
    ].includes(node.type);
    const scope: Scope = scoped
      ? {
        parent: outer,
        // A TypeScript namespace body is compiled to a function body:
        functionScope: isFunction || node.type === "StaticBlock" ||
          node.type === "TSModuleBlock",
        merged: node.type === "TSModuleBlock"
          ? blockMembers.get(node) ?? new Set()
          : node.type === "TSEnumDeclaration"
          ? mergedMembers(outer.merged ?? outer, name(node.id))
          : undefined,
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
    // An import alias, such as import iri = M.iri, binds a value that is
    // not statically known here:
    if (node.type === "TSImportEqualsDeclaration") bind(node.id, scope);
    if (node.type === "TSEnumDeclaration") {
      // Initializers can refer to members by their bare names:
      const body = ast(node.body);
      const members = (body?.members ?? node.members ?? []) as Ast[];
      for (const member of members) {
        const id = name(member.id);
        if (id == null) continue;
        scope.bindings.set(id, {});
        scope.merged?.add(id);
      }
    }
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
      const raw = typeof node.raw === "string" ? toJsonString(node.raw) : null;
      if (raw != null) {
        try {
          const value: unknown = JSON.parse(raw);
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
        lookupConstant(scopes.get(node), node.name as string)?.init,
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
    let authority = "";
    if (rest.startsWith("//")) {
      const end = rest.slice(2).search(/[/?#]/);
      authority = end < 0 ? rest.slice(2) : rest.slice(2, 2 + end);
      path = end < 0 ? "" : rest.slice(2 + end);
    }
    // These checks follow the raw-property API's IRI syntax contract, rather
    // than WHATWG URL parsing (which normalizes spaces and malformed escapes).
    if (
      !scheme || rest === "" || value.startsWith("_:") ||
      !isAuthoritySyntax(authority) ||
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
