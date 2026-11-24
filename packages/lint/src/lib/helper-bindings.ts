import { isNode } from "./pred.ts";
import { type FunctionLikeNode, isFunctionLikeNode } from "./reachability.ts";
import type { Node } from "./types.ts";

interface Binding {
  definitions: number;
  fn: FunctionLikeNode | null;
  written: boolean;
  replacements: FunctionLikeNode[];
  unknownWrite: boolean;
  uninitialized: boolean;
}

interface Scope {
  parent: Scope | null;
  variables: boolean;
  bindings: Map<string, Binding>;
}

const get = (node: Node, key: string): unknown =>
  (node as unknown as Record<string, unknown>)[key];
const asNode = (value: unknown): Node | null => (isNode(value) ? value : null);
const WRAPPERS = new Set([
  "ChainExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
]);

function unwrap(node: Node): Node {
  while (WRAPPERS.has(node.type)) {
    const inner = asNode(get(node, "expression"));
    if (inner == null) break;
    node = inner;
  }
  return node;
}

/** Visits bound names, not property keys or member-assignment receivers. */
function boundNames(pattern: Node, visit: (name: string) => void): void {
  pattern = unwrap(pattern);
  switch (pattern.type) {
    case "Identifier":
      visit(pattern.name);
      break;
    case "AssignmentPattern":
      boundNames(get(pattern, "left") as Node, visit);
      break;
    case "RestElement":
      boundNames(get(pattern, "argument") as Node, visit);
      break;
    case "ArrayPattern":
      for (const item of get(pattern, "elements") as (Node | null)[])
        if (item != null) boundNames(item, visit);
      break;
    case "ObjectPattern":
      for (const item of get(pattern, "properties") as Node[])
        boundNames(
          get(item, item.type === "RestElement" ? "argument" : "value") as Node,
          visit,
        );
      break;
  }
}

/**
 * Resolves direct, single-definition local helpers with no syntactic writes.
 *
 * This is a binding index, not execution or alias analysis. Every nested body
 * is scanned, even unused/dead code. A write disqualifies only its actual
 * binding; property writes never replace the receiver binding. Parameters,
 * destructured values, and aliases are unknown, not helper definitions.
 */
export function indexHelperBindings(listener: FunctionLikeNode): {
  resolve: (reference: Node) => FunctionLikeNode | null;
  completionCandidates: (reference: Node) => readonly FunctionLikeNode[];
} {
  const scopes = new WeakMap<Node, Scope>();
  const nodes: Node[] = [];
  const makeScope = (parent: Scope | null, variables = false): Scope => ({
    parent,
    variables,
    bindings: new Map(),
  });
  const lookup = (scope: Scope | undefined, name: string): Binding | null => {
    for (
      let current = scope;
      current != null;
      current = current.parent ?? undefined
    ) {
      const binding = current.bindings.get(name);
      if (binding != null) return binding;
    }
    return null;
  };
  const bind = (
    scope: Scope,
    pattern: Node | null,
    fn: FunctionLikeNode | null = null,
    uninitialized = false,
  ): void => {
    if (pattern == null) return;
    boundNames(pattern, (name) => {
      const previous = scope.bindings.get(name);
      if (previous != null) previous.definitions++;
      else
        scope.bindings.set(name, {
          definitions: 1,
          fn,
          written: false,
          replacements: [],
          unknownWrite: false,
          uninitialized,
        });
    });
  };
  const variableScope = (scope: Scope): Scope => {
    while (!scope.variables && scope.parent != null) scope = scope.parent;
    return scope;
  };

  const visit = (value: unknown, scope: Scope): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, scope);
      return;
    }
    if (!isNode(value)) return;
    const node = value;
    scopes.set(node, scope);
    nodes.push(node);
    if (isFunctionLikeNode(node)) {
      if (node.type === "FunctionDeclaration")
        bind(scope, asNode(get(node, "id")), node);
      const parameters = makeScope(scope);
      if (node.type === "FunctionExpression")
        bind(parameters, asNode(get(node, "id")), node);
      for (const param of node.params) bind(parameters, asNode(param));
      visit(node.params, parameters);
      // Defaults have no access to declarations in the body.
      const body = makeScope(parameters, true);
      const root = asNode(node.body);
      if (root?.type === "BlockStatement") {
        scopes.set(root, body);
        visit(get(root, "body"), body);
      } else visit(root, body);
      return;
    }
    if (node.type === "SwitchStatement") {
      visit(get(node, "discriminant"), scope);
      visit(get(node, "cases"), makeScope(scope));
      return;
    }
    if (node.type === "BlockStatement" || node.type === "StaticBlock") {
      visit(get(node, "body"), makeScope(scope, node.type === "StaticBlock"));
      return;
    }
    if (node.type === "CatchClause") {
      const caught = makeScope(scope);
      bind(caught, asNode(get(node, "param")));
      visit(get(node, "param"), caught);
      visit(get(node, "body"), caught);
      return;
    }
    if (
      node.type === "ForStatement" ||
      node.type === "ForOfStatement" ||
      node.type === "ForInStatement"
    ) {
      scope = makeScope(scope);
      scopes.set(node, scope);
    }
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (node.type === "ClassDeclaration")
        bind(scope, asNode(get(node, "id")));
      visit(get(node, "superClass"), scope);
      const inner = makeScope(scope);
      bind(inner, asNode(get(node, "id")));
      visit(get(node, "body"), inner);
      return;
    }
    if (node.type === "VariableDeclaration") {
      const target = get(node, "kind") === "var" ? variableScope(scope) : scope;
      for (const item of get(node, "declarations") as Node[]) {
        const pattern = asNode(get(item, "id"));
        const value = asNode(get(item, "init"));
        const fn = value == null ? null : unwrap(value);
        bind(
          target,
          pattern,
          pattern?.type === "Identifier" && fn != null && isFunctionLikeNode(fn)
            ? fn
            : null,
          pattern?.type === "Identifier" && value == null,
        );
      }
    }
    // Other declaration forms must shadow, never inherit an outer helper.
    if (
      node.type === "TSEnumDeclaration" ||
      node.type === "TSModuleDeclaration" ||
      node.type === "TSDeclareFunction" ||
      node.type === "TSImportEqualsDeclaration"
    )
      bind(scope, asNode(get(node, "id")));
    // Deno's AST exposes fields through enumerable prototype accessors.
    for (const key in node) {
      if (key !== "parent") visit(get(node, key), scope);
    }
  };
  visit(listener, makeScope(null, true));

  // All declarations are known before resolving writes, including hoisted
  // ones and writes in closures, defaults, accessors, or coercion hooks.
  for (const node of nodes) {
    let target: Node | null = null;
    if (node.type === "AssignmentExpression")
      target = asNode(get(node, "left"));
    else if (node.type === "UpdateExpression")
      target = asNode(get(node, "argument"));
    else if (node.type === "ForOfStatement" || node.type === "ForInStatement") {
      const left = asNode(get(node, "left"));
      if (left?.type !== "VariableDeclaration") target = left;
    }
    if (target != null)
      boundNames(target, (name) => {
        const binding = lookup(scopes.get(node), name);
        if (binding == null) return;
        binding.written = true;
        const value = asNode(get(node, "right"));
        const fn = value == null ? null : unwrap(value);
        if (
          node.type === "AssignmentExpression" &&
          get(node, "operator") === "=" &&
          target.type === "Identifier" &&
          fn != null &&
          isFunctionLikeNode(fn)
        )
          binding.replacements.push(fn);
        else binding.unknownWrite = true;
      });
  }

  return {
    resolve(reference) {
      reference = unwrap(reference);
      if (reference.type !== "Identifier") return null;
      const binding = lookup(scopes.get(reference), reference.name);
      return binding != null && binding.definitions === 1 && !binding.written
        ? binding.fn
        : null;
    },
    completionCandidates(reference) {
      reference = unwrap(reference);
      if (reference.type !== "Identifier") return [];
      const binding = lookup(scopes.get(reference), reference.name);
      // Preserve legacy may-carry-completion evidence for known literal
      // alternatives. Never use this union to certify an array return shape.
      return binding != null &&
        binding.definitions === 1 &&
        (binding.fn != null || binding.uninitialized) &&
        !binding.unknownWrite
        ? [...(binding.fn == null ? [] : [binding.fn]), ...binding.replacements]
        : [];
    },
  };
}
