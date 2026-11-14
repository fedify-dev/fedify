// oxlint-disable no-await-in-loop -- Discover context closures serially under shared per-request budgets.
/** Conservative preflight for the private raw JSON-LD shape profile. @internal */
import type { DocumentLoader, RemoteDocument } from "@fedify/vocab-runtime";
type J = null | boolean | number | string | J[] | { [key: string]: J };
type Remote = RemoteDocument;
type Loader = DocumentLoader;
type Graph = {
  units: number;
  definitions: number;
  depth: number;
  nonPropagating: boolean;
  serialization: number;
  cloneUnits: number;
};
export class ContextProfileError extends Error {
  readonly code: "resource-limit" | "unsupported-lossy-shape";
  constructor(
    code: "resource-limit" | "unsupported-lossy-shape",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}
const LIMIT = 64 * 1024 * 1024;
const IRI_LIMIT = 2048;
const DEPTH_LIMIT = 64;
const UNFOLDED_LIMIT = 4096;
const obj = (v: unknown): v is Record<string, J> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const anchor = (v: string): boolean =>
  /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(v) || v === "_:";
const terminal = /[:/?#[\]@]$/;
function reject(message: string): never {
  throw new ContextProfileError("resource-limit", message);
}
function unsupported(message: string): never {
  throw new ContextProfileError("unsupported-lossy-shape", message);
}
function add(a: number, b: number, cap = LIMIT): number {
  if (a > cap - b) reject("Conservative JSON-LD work estimate exceeded.");
  return a + b;
}
function mul(a: number, b: number, cap = LIMIT): number {
  if (a !== 0 && b > Math.floor(cap / a))
    reject("Conservative JSON-LD work estimate exceeded.");
  return a * b;
}
function syntaxWeight(v: J): number {
  if (typeof v === "string") return 1 + v.length;
  if (Array.isArray(v))
    return v.reduce<number>((n, x) => add(n, syntaxWeight(x)), 1);
  if (obj(v))
    return Object.entries(v).reduce(
      (n, [k, x]) => add(n, k.length + 1 + syntaxWeight(x)),
      1,
    );
  return 1;
}
// util.clone returns scalar strings unchanged; only containers and members are
// traversed/allocated when copying a mapping. Reserve 24 slots per definition
// for generated metadata/protection in addition to its complete input syntax.
function structuralNodes(v: J): number {
  if (Array.isArray(v))
    return v.reduce<number>((n, x) => add(n, structuralNodes(x)), 1);
  if (obj(v))
    return Object.values(v).reduce<number>(
      (n, x) => add(n, structuralNodes(x)),
      1,
    );
  return 1;
}
function strings(v: J, visit: (s: string) => void): void {
  if (typeof v === "string") visit(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, visit);
  else if (obj(v))
    for (const [k, x] of Object.entries(v)) {
      visit(k);
      strings(x, visit);
    }
}
/**
 * Contract: raw and every loader result are already descriptor-safe, detached,
 * acyclic JSON snapshots under existing per-request raw/context budgets.
 * This function calls no JSON-LD operation. The supplied loader is the existing
 * memoized, max-32-distinct-URLs snapshot loader, NOT the external loader itself.
 * Run prepare once, then estimate both raw and the completed diagnostic clone;
 * only then call jsonld.expand, using the returned closed-world loader.
 */
export async function prepareExpansionBudget(raw: J, loader: Loader) {
  const remote = new Map<string, Remote>();
  const remoteGraphs = new Map<string, Graph>();
  const pending = new Set<string>();
  const inlineGraphs = new WeakMap<object, Graph>();
  const structuralGraphs = new Map<string, Graph>();
  const scoped = new Map<string, Graph[]>();
  // Global may-alias sets deliberately over-approximate active-context state.
  // Possible opaque payloads containing @context are rejected before I/O; never
  // skip a potentially active inline context based only on this over-approximation.
  const opaqueTerms = new Set<string>(["@value"]);
  const valueAliases = new Set<string>(["@value"]);
  const jsonAliases = new Set<string>(["@json"]);
  const aliasUsers = new Map<string, Set<string>>();
  const typeUsers = new Map<string, Set<string>>();
  function propagateAlias(seed: string, aliases: Set<string>) {
    const queue = [seed];
    for (const target of queue) {
      if (aliases === valueAliases) opaqueTerms.add(target);
      else
        for (const user of typeUsers.get(target) ?? []) opaqueTerms.add(user);
      for (const user of aliasUsers.get(target) ?? []) {
        if (!aliases.has(user)) {
          aliases.add(user);
          queue.push(user);
        }
      }
    }
  }
  function registerAlias(name: string, id: J | undefined, type: J | undefined) {
    if (typeof id === "string") {
      const users = aliasUsers.get(id) ?? new Set<string>();
      users.add(name);
      aliasUsers.set(id, users);
      for (const aliases of [valueAliases, jsonAliases]) {
        if (aliases.has(id) && !aliases.has(name)) {
          aliases.add(name);
          propagateAlias(name, aliases);
        }
      }
    }
    if (typeof type === "string") {
      const users = typeUsers.get(type) ?? new Set<string>();
      users.add(name);
      typeUsers.set(type, users);
      if (jsonAliases.has(type)) opaqueTerms.add(name);
    }
  }
  let mappingWeight = 1;
  let cloneWeight = 1;
  let resolutionWeight = 0;
  let longestContextString = 1;
  let definitionCount = 0;
  const dependencies = new Map<string, Set<string>>();
  function checkString(s: string) {
    if (s.length > IRI_LIMIT)
      reject("Context strings and term names exceed 2048 code units.");
    longestContextString = Math.max(longestContextString, s.length);
  }
  function url(s: unknown): asserts s is string {
    if (typeof s !== "string" || !anchor(s) || s === "_:")
      unsupported("Context URLs must be absolute hierarchical URLs.");
    checkString(s);
  }
  function combine(a: Graph, b: Graph, scopedChild = false): Graph {
    return {
      units: add(a.units, b.units, UNFOLDED_LIMIT),
      definitions: add(a.definitions, b.definitions, UNFOLDED_LIMIT),
      depth: Math.max(a.depth, b.depth + 1),
      nonPropagating: a.nonPropagating || (!scopedChild && b.nonPropagating),
      serialization: add(a.serialization, b.serialization),
      cloneUnits: add(
        a.cloneUnits,
        scopedChild ? mul(b.units, 4) : b.cloneUnits,
      ),
    };
  }
  function checkGraph(g: Graph): Graph {
    if (g.depth > DEPTH_LIMIT) reject("Context closure is too deep.");
    return g;
  }
  async function visitRemote(id: string): Promise<Graph> {
    url(id);
    const done = remoteGraphs.get(id);
    if (done) return done;
    if (pending.has(id))
      unsupported(
        "Recursive remote/scoped contexts are outside the bounded profile.",
      );
    pending.add(id);
    const r = await loader(id);
    url(r.documentUrl);
    remote.set(id, r);
    if (!obj(r.document)) unsupported("A context document must be an object.");
    let g = await context(r.document["@context"] ?? {});
    if (r.contextUrl != null) {
      url(r.contextUrl);
      g = combine(g, await visitRemote(r.contextUrl));
    }
    pending.delete(id);
    remoteGraphs.set(id, checkGraph(g));
    return g;
  }
  function term(name: string, value: J) {
    if (name.includes(":") || name.includes("/"))
      unsupported(
        "IRI-shaped context term names are outside the bounded profile.",
      );
    const d = typeof value === "string" ? { "@id": value } : value;
    if (!obj(d)) return;
    const id = d["@id"];
    registerAlias(name, id, d["@type"]);
    if (d["@prefix"] === true && (typeof id !== "string" || !anchor(id))) {
      unsupported("Prefixes must have fixed absolute anchors.");
    }
    if (typeof value === "string" && !value.startsWith("@") && !anchor(value)) {
      // A simple alias can inherit a trailing delimiter and become a prefix.
      if (!value.includes(":") || terminal.test(value))
        unsupported("Inferred prefix chains are outside the bounded profile.");
    }
    // Explicit object aliases do not infer prefixes. Bound their recursion even
    // across separate contexts; rejecting an impossible cross-scope cycle is safe.
    for (const key of ["@id", "@reverse", "@type"]) {
      const ref = d[key];
      if (typeof ref === "string" && !ref.startsWith("@") && !anchor(ref)) {
        const target = ref.includes(":") ? ref.slice(0, ref.indexOf(":")) : ref;
        if (target !== "_" && !target.includes("/")) {
          const deps = dependencies.get(name) ?? new Set<string>();
          deps.add(target);
          dependencies.set(name, deps);
        }
      }
    }
  }
  async function context(v: J): Promise<Graph> {
    if (v === null)
      return {
        units: 1,
        definitions: 0,
        depth: 1,
        nonPropagating: false,
        serialization: 0,
        cloneUnits: 1,
      };
    if (typeof v === "string") return await visitRemote(v);
    if (typeof v !== "object") unsupported("Malformed context.");
    const cached = inlineGraphs.get(v);
    if (cached) return cached;
    // The JSON snapshots have no accessors, cycles, or relative context URLs.
    // Identical lexical contexts contribute the same possible definitions;
    // their occurrence weight is still charged by every caller's graph.
    const structure = JSON.stringify(v);
    const equivalent = structuralGraphs.get(structure);
    if (equivalent) {
      inlineGraphs.set(v, equivalent);
      return equivalent;
    }
    let g: Graph = {
      units: Array.isArray(v) ? 0 : 1,
      definitions: 0,
      depth: 1,
      nonPropagating: !Array.isArray(v) && v["@propagate"] === false,
      serialization: Array.isArray(v) ? 0 : syntaxWeight(v),
      cloneUnits: Array.isArray(v) ? 0 : v["@propagate"] === false ? 4 : 1,
    };
    if (Array.isArray(v)) {
      for (const x of v) g = combine(g, await context(x));
    } else {
      if ("@context" in v)
        unsupported(
          "Nested local-context wrappers are outside the bounded profile.",
        );
      strings(v, checkString);
      // ContextResolver serializes inline contexts as cache keys even on hits.
      // Two units here times the fourfold work reserve cover JSON escaping.
      resolutionWeight = add(resolutionWeight, mul(syntaxWeight(v), 2));
      if ("@base" in v && v["@base"] !== null)
        unsupported("Non-null @base is outside the bounded profile.");
      if (
        "@vocab" in v &&
        v["@vocab"] !== null &&
        (typeof v["@vocab"] !== "string" || !anchor(v["@vocab"]))
      ) {
        unsupported("@vocab must be a fixed absolute anchor.");
      }
      if ("@import" in v) {
        url(v["@import"]);
        g = combine(g, await visitRemote(v["@import"]));
      }
      for (const [name, value] of Object.entries(v)) {
        if (name.startsWith("@")) continue;
        term(name, value);
        definitionCount = add(definitionCount, 1, UNFOLDED_LIMIT);
        cloneWeight = add(cloneWeight, 24 + structuralNodes(value));
        g.definitions = add(g.definitions, 1, UNFOLDED_LIMIT);
        // Includes every scoped syntax tree retained inside a mapping. Counting
        // nested definitions again deliberately overestimates clone costs.
        mappingWeight = add(
          mappingWeight,
          64 + name.length + syntaxWeight(value),
        );
        if (obj(value) && "@context" in value) {
          const child = await context(value["@context"]);
          const choices = scoped.get(name) ?? [];
          choices.push(child);
          scoped.set(name, choices);
          g = combine(g, child, true); // eager validation does not activate the scope
        }
      }
    }
    checkGraph(g);
    inlineGraphs.set(v, g);
    structuralGraphs.set(structure, g);
    return g;
  }
  function rejectPayloadContexts(v: J): void {
    if (Array.isArray(v)) for (const x of v) rejectPayloadContexts(x);
    else if (obj(v)) {
      if ("@context" in v)
        unsupported(
          "Context-shaped opaque JSON payloads are outside the bounded profile.",
        );
      for (const x of Object.values(v)) rejectPayloadContexts(x);
    }
  }
  async function gather(v: J): Promise<void> {
    if (Array.isArray(v)) for (const x of v) await gather(x);
    else if (obj(v)) {
      // JSON member order must not decide whether an opaque payload gets loaded.
      if ("@context" in v) await context(v["@context"]);
      for (const [k, x] of Object.entries(v)) {
        if (k === "@context") continue;
        if (opaqueTerms.has(k)) {
          // The sets deliberately over-approximate scope. Do not silently skip
          // a hidden inline context that could be active in a different scope.
          // Reject context-shaped opaque payloads before following their URLs.
          rejectPayloadContexts(x);
        } else await gather(x);
      }
    }
  }
  await gather(raw);
  const completed = new Map<string, number>();
  const visiting = new Set<string>();
  function dependency(name: string, stackDepth = 0): number {
    if (stackDepth > DEPTH_LIMIT) reject("Term dependency chain is too deep.");
    if (visiting.has(name))
      unsupported("Cyclic term dependencies are outside the bounded profile.");
    const cached = completed.get(name);
    if (cached !== undefined) return cached;
    visiting.add(name);
    let depth = 0;
    for (const d of dependencies.get(name) ?? [])
      depth = Math.max(depth, 1 + dependency(d, stackDepth + 1));
    if (depth > DEPTH_LIMIT) reject("Term dependency chain is too deep.");
    visiting.delete(name);
    completed.set(name, depth);
    return depth;
  }
  for (const name of dependencies.keys()) dependency(name);
  const mappedIri = 2 * longestContextString;
  mappingWeight = add(
    add(mappingWeight, resolutionWeight),
    mul(definitionCount, mappedIri * 2),
  );
  let spent = 0;
  function graphOf(v: J): Graph {
    if (v === null)
      return {
        units: 1,
        definitions: 0,
        depth: 1,
        nonPropagating: false,
        serialization: 0,
        cloneUnits: 1,
      };
    const g =
      typeof v === "string"
        ? remoteGraphs.get(v)
        : typeof v === "object"
          ? inlineGraphs.get(v)
          : undefined;
    if (!g) unsupported("Diagnostic pass changed a context after preflight.");
    return g;
  }
  function estimate(value: J) {
    let applications = 0,
      outputChars = 0,
      outputNodes = 0,
      cloningObjects = 0,
      definitionApplications = 0,
      serializationApplications = 0,
      cloneApplications = 0;
    function charge(g: Graph, count = 1, cloning = true) {
      cloneApplications = add(
        cloneApplications,
        mul(cloning ? mul(g.units, 4) : g.cloneUnits, count),
      );
      applications = add(applications, mul(g.units, count));
      definitionApplications = add(
        definitionApplications,
        mul(g.definitions, count),
      );
      serializationApplications = add(
        serializationApplications,
        mul(g.serialization, count),
      );
    }
    function chargeScope(name: string, count = 1) {
      for (const g of scoped.get(name) ?? []) charge(g, count);
    }
    // Type values may use any keyword alias. Match immediate strings/arrays
    // without interpreting their key, but never inspect nested objects here.
    function selectsScope(v: J): boolean {
      if (typeof v === "string") return scoped.has(v);
      return Array.isArray(v) && v.some(selectsScope);
    }
    function walk(
      v: J,
      inheritedCloning = false,
    ): { nodes: number; objects: number } {
      let nodes = 1,
        objects = obj(v) ? 1 : 0;
      if (typeof v === "string") {
        outputChars = add(outputChars, v.length + mappedIri + 32);
        chargeScope(v); // possible type-scoped use
      } else if (Array.isArray(v)) {
        for (const x of v) {
          const c = walk(x, inheritedCloning);
          nodes += c.nodes;
          objects += c.objects;
        }
      } else if (obj(v)) {
        const entries = Object.entries(v);
        // A matching key can activate a property scope or a type-index-map
        // scope. Mark the entire containing object, covering subsequent map
        // entries as well as that key's value. Matching immediate strings can
        // activate a type scope under any alias for @type.
        const cloning =
          inheritedCloning ||
          ("@context" in v && graphOf(v["@context"]).nonPropagating) ||
          entries.some(
            ([k, x]) => k !== "@context" && (scoped.has(k) || selectsScope(x)),
          );
        if (cloning) cloningObjects = add(cloningObjects, 1);
        for (const [k, x] of entries) {
          if (k === "@context") {
            charge(graphOf(x), 1, cloning);
            continue;
          }
          const c = walk(x, cloning);
          nodes += c.nodes;
          objects += c.objects;
          // Covers property-scoped processing before recursion, its reapplication
          // to every possible node, and type-index-map processing of this key.
          chargeScope(k, c.objects + 2);
          outputChars = add(
            outputChars,
            mul(c.nodes + 1, k.length + mappedIri + 32),
          );
          outputNodes = add(outputNodes, c.nodes + 1);
        }
      }
      return { nodes, objects };
    }
    const counts = walk(value);
    // Full mapping copies are needed while a scope or non-propagating context
    // may be active. An unused scoped definition is validated (applications)
    // but cannot cause descendant reversion. Ordinary objects get a constant
    // traversal reserve; the output estimate below still charges all contents.
    const contextWork = add(
      add(
        mul(cloneApplications, cloneWeight),
        mul(cloningObjects, mul(mappingWeight, 4)),
      ),
      add(
        add(
          mul(definitionApplications, mappedIri * 2),
          mul(serializationApplications, 6),
        ),
        mul(counts.objects - cloningObjects, 64),
      ),
    );
    const outputWork = mul(
      add(outputChars, add(outputNodes, counts.nodes)),
      16,
    );
    const pass = add(contextWork, outputWork);
    spent = add(spent, pass);
    return {
      applications,
      cloneApplications,
      definitionApplications,
      serializationApplications,
      cloneWeight,
      cloningObjects,
      ordinaryObjects: counts.objects - cloningObjects,
      mappingWeight,
      contextWork,
      outputWork,
      cumulative: spent,
    };
  }
  const closedLoader: Loader = async (id) => {
    const r = remote.get(id);
    if (!r)
      unsupported(
        "Expansion requested a context outside the preflight closure.",
      );
    // Delegate back to the memoized snapshot loader so jsonld can mutate its copy.
    return await loader(id);
  };
  return { estimate, loader: closedLoader, contexts: remote.size, mappedIri };
}
