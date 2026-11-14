import {
  ast,
  type Ast,
  children,
  isVocabularySource as isBuiltinVocabularySource,
  name,
  unwrap,
} from "./ast.ts";
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

interface Binding {
  imported?: string;
  namespace?: boolean;
  init?: Ast;
  /** Namespace and enum declarations prevent resolving this binding. */
  opaque?: boolean;
}
interface Scope {
  parent?: Scope;
  functionScope: boolean;
  bindings: Map<string, Binding>;
}

const functions = new Set([
  "getRawPropertyValues",
  "getRawPropertyValue",
  "withRawProperty",
  "withRawProperties",
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

function primitivePropertyKey(node: Ast): string | undefined {
  if (node.type !== "Literal" || node.regex != null) return;
  if (typeof node.value === "bigint") return String(node.value);
  // Some providers expose BigInt literals as value: null plus metadata.
  // Convert the metadata before the null case, without losing precision.
  if (typeof node.bigint === "string") {
    try {
      return String(BigInt(node.bigint.replaceAll("_", "")));
    } catch {
      return;
    }
  }
  if (typeof node.value === "number") {
    // Deno can expose separated numeric literals as NaN; retain valid
    // overflow values such as Infinity when recovering their source text.
    const value =
      Number.isNaN(node.value) && typeof node.raw === "string"
        ? Number(node.raw.replaceAll("_", ""))
        : node.value;
    return Number.isNaN(value) ? undefined : String(value);
  }
  if (node.value === null || typeof node.value === "boolean")
    return String(node.value);
}
function bind(pattern: unknown, scope: Scope, binding: Binding = {}): void {
  const node = ast(pattern);
  if (!node) return;
  if (node.type === "Identifier") {
    // A later declaration cannot make a namespace or enum safe to resolve.
    if (!scope.bindings.get(node.name as string)?.opaque) {
      scope.bindings.set(node.name as string, binding);
    }
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

const IP_LITERAL_PATTERN = /^\[([^[\]]*)\](?::[0-9]*)?$/;
const IP_FUTURE_PATTERN = /^v[0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+$/i;

/**
 * Checks that an authority has a numeric port, if any, and that square
 * brackets delimit an IPv6 address or an IPvFuture literal as the whole host,
 * as the runtime does.
 */
function isAuthoritySyntax(authority: string): boolean {
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  const userinfo = authority.slice(0, authority.length - hostPort.length);
  // The userinfo ends with the only unescaped @ an authority can have:
  if (/[[\]]/.test(userinfo) || userinfo.slice(0, -1).includes("@")) {
    return false;
  }
  if (!/[[\]]/.test(hostPort)) return /^[^:]*(?::[0-9]*)?$/.test(hostPort);
  const match = IP_LITERAL_PATTERN.exec(hostPort);
  if (match == null) return false;
  const literal = match[1];
  return (
    IP_FUTURE_PATTERN.test(literal) || URL.canParse(`http://[${literal}]/`)
  );
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
  const isVocabularySource = (source: string | undefined): boolean =>
    source != null &&
    (isBuiltinVocabularySource(source) ||
      options.modules?.includes(source) === true);
  const scopes = new WeakMap<Ast, Scope>();
  const calls: Ast[] = [];
  const root: Scope = { functionScope: true, bindings: new Map() };
  function visit(node: Ast, outer: Scope): void {
    if (
      node.type === "TSModuleDeclaration" ||
      node.type === "TSEnumDeclaration"
    ) {
      // Keep the enclosing binding opaque, including the first segment of a
      // dotted namespace name.  Do not attempt declaration merging.
      let id = ast(node.id);
      while (id?.type === "TSQualifiedName") id = ast(id.left);
      bind(id, outer, { opaque: true });
      // No call or constant inside these bodies is safe to resolve, even in
      // a nested function or block, so skip the entire body.
      return;
    }
    if (node.type === "TSModuleBlock") return;
    const isFunction =
      /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(
        node.type,
      );
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "ClassDeclaration"
    ) {
      bind(node.id, outer);
    }
    const scoped =
      isFunction ||
      [
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
    // An import alias, such as import iri = M.iri, binds a value that is
    // not statically known here:
    if (node.type === "TSImportEqualsDeclaration") bind(node.id, scope);
    if (node.type === "ImportDeclaration") {
      const included = isVocabularySource(name(node.source));
      for (const specifier of node.specifiers as Ast[]) {
        bind(
          specifier.local,
          scope,
          included &&
            node.importKind !== "type" &&
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
  // Imports are top-level statements, so a file importing no vocabulary module
  // has no call to check:
  const body = (program as unknown as Ast).body;
  if (
    globalThis.Array.isArray(body) &&
    !body.some(
      (statement: Ast) =>
        statement.type === "ImportDeclaration" &&
        isVocabularySource(name(statement.source)),
    )
  ) {
    return;
  }
  visit(program as unknown as Ast, root);

  function staticString(
    node: Ast | undefined,
    seen = new Set<Ast>(),
    bound = false,
  ): { value: string; literal: Ast } | undefined {
    node = unwrap(node);
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
      const value =
        (quasi.value as { cooked?: string } | undefined)?.cooked ??
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
      node.type === "NewExpression" &&
      name(node.callee) === "URL" &&
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
  function check(
    node: Ast,
    known: { value: string; literal?: Ast } | undefined = staticString(node),
  ): void {
    if (!known) return;
    const expression = unwrap(node)!;
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
      !scheme ||
      rest === "" ||
      value.startsWith("_:") ||
      !isAuthoritySyntax(authority) ||
      path.includes("[") ||
      path.includes("]") ||
      /["<>\\^`{|}]/u.test(value) ||
      Array.from(value).some((char) => {
        const code = char.codePointAt(0)!;
        return (
          code <= 0x20 ||
          (code >= 0x7f && code <= 0x9f) ||
          (code >= 0xd800 && code <= 0xdfff)
        );
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
      const replacement =
        prefix == null ? undefined : prefix + value.slice(scheme[0].length);
      report({
        node: node as unknown as Node,
        messageId: "nonHttp",
        value,
        replacement,
        // Never suggest changing a const declaration shared by other uses.
        suggestionNode:
          known.literal != null &&
          (known.literal === expression ||
            (expression.type === "NewExpression" &&
              unwrap(ast((expression.arguments as unknown[])[0])) ===
                known.literal))
            ? (known.literal as unknown as Node)
            : undefined,
      });
    }
  }
  function isGlobalIteratorProperty(property: Ast): boolean {
    if (property.type !== "Property") return false;
    // Member-expression keys must be computed, even when Deno reports
    // computed: false for an object method.
    const member = unwrap(ast(property.key));
    if (member?.type !== "MemberExpression") return false;
    const object = unwrap(ast(member.object));
    if (
      object?.type !== "Identifier" ||
      object.name !== "Symbol" ||
      lookup(scopes.get(object), "Symbol") != null
    )
      return false;
    return (
      (member.computed
        ? staticString(ast(member.property))?.value
        : name(member.property)) === "iterator"
    );
  }
  function checkEntries(argument: Ast): void {
    const entries = unwrap(argument);
    if (entries?.type === "ObjectExpression") {
      const properties = entries.properties as Ast[];
      // The runtime treats objects with Symbol.iterator as iterables;
      // their ordinary string fields are not record entries.
      if (properties.some(isGlobalIteratorProperty)) return;
      for (const property of properties) {
        if (property.type !== "Property") continue;
        const key = ast(property.key);
        if (!key) continue;
        // Deno loses whether an identifier method/accessor key is computed.
        // Wrapped keys keep that distinction, so skip only bare identifiers.
        if (
          key.type === "Identifier" &&
          (property.method || property.kind !== "init")
        )
          continue;
        const expression = unwrap(key)!;
        // This syntax sets the record's prototype rather than an own key.
        // Computed, shorthand, method, and accessor forms create own keys.
        if (
          !property.computed &&
          !property.shorthand &&
          !property.method &&
          property.kind === "init" &&
          name(expression) === "__proto__"
        )
          continue;
        const primitive = primitivePropertyKey(expression);
        if (!property.computed && key.type === "Identifier") {
          // Object keys, including shorthand keys, are text rather than a
          // reference to a potentially unrelated same-named binding.
          check(key, { value: expression.name as string });
        } else if (primitive != null) {
          check(key, { value: primitive });
        } else {
          check(key);
        }
      }
    } else if (entries?.type === "ArrayExpression") {
      for (const element of entries.elements as unknown[]) {
        const entry = unwrap(ast(element));
        if (entry?.type !== "ArrayExpression") continue;
        const pair = entry.elements as unknown[];
        if (
          pair.length !== 2 ||
          pair.some(
            (item) => item == null || ast(item)?.type === "SpreadElement",
          )
        )
          continue;
        const key = ast(pair[0]);
        if (key) check(key);
      }
    }
  }
  for (const call of calls) {
    const callee = ast(call.callee);
    let functionName: string | undefined;
    if (callee?.type === "Identifier") {
      functionName = lookup(
        scopes.get(callee),
        callee.name as string,
      )?.imported;
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
    if (argument) {
      if (functionName === "withRawProperties") checkEntries(argument);
      else check(argument);
    }
  }
}
