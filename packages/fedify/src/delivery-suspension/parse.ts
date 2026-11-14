import {
  preloadedContexts,
  type DocumentLoader,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import {
  ContextProfileError,
  prepareExpansionBudget,
} from "./expansion-budget.ts";
import {
  getDeliverySuspensionUrlOrigin,
  parseDeliverySuspensionOrigin,
  validateHttpsUri,
} from "./origin.ts";
import { compareExactDateTimes, parseExactDateTime } from "./time.ts";
import type {
  ActorControlMetadata,
  ActorEndpointsMetadata,
  ControlLinkState,
  ControlLinkValue,
  ControlParseOptions,
  ControlledOriginValue,
  DeliverySuspensionActivityFacts,
  DeliverySuspensionFacts,
  DeliverySuspensionOrigin,
  DeliverySuspensionTarget,
  InboxControlMetadata,
  ParseOptions,
  ParseResult,
  ShapeIssue,
} from "./types.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Node = { [key: string]: Json };
const AS = "https://www.w3.org/ns/activitystreams#";
const F799 = "https://w3id.org/fep/f799#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const INBOX = "http://www.w3.org/ns/ldp#inbox";
const INBOX_OF = "https://w3id.org/fep/5711#inboxOf";
const MAX_DEPTH = 64;
const MAX_NODES = 10_000;
const MAX_STRINGS = 1024 * 1024;
const MAX_CONTEXTS = 32;
const MAX_MARKER_ATTEMPTS = 8;
interface Budget {
  nodes: number;
  strings: number;
}
interface Marker {
  readonly raw: Json;
  readonly rawPath: string;
  readonly payload: boolean;
}
interface Occurrence {
  readonly value: Json;
  readonly path: string;
  readonly rawPath?: string;
}
interface EvidenceLocation {
  readonly path: string;
  readonly rawPath?: string;
}
type EvidenceLocations = WeakMap<
  Node,
  ReadonlyMap<string, readonly EvidenceLocation[]>
>;
interface Prepared {
  readonly raw: Json;
  readonly expanded: Json;
  readonly node: Node;
  readonly markers: ReadonlyMap<string, Marker>;
  readonly warnings: ShapeIssue[];
  readonly locations: EvidenceLocations;
}
class ShapeFailure extends Error {
  readonly issue: ShapeIssue;
  constructor(code: string, path: string, message: string, rawPath?: string) {
    super(message);
    this.issue = {
      code,
      path,
      message,
      ...(rawPath === undefined ? {} : { rawPath }),
    };
  }
}
function pointer(key: string | number): string {
  return String(key).replace(/~/g, "~0").replace(/\//g, "~1");
}
function object(value: Json): value is Node {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fail(
  code: string,
  path: string,
  message: string,
  rawPath?: string,
): never {
  throw new ShapeFailure(code, path, message, rawPath);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function failure<T>(error: unknown): ParseResult<T> {
  if (error instanceof ContextProfileError)
    return freeze({
      ok: false,
      issues: [{ code: error.code, path: "", message: error.message }],
    });
  return freeze({
    ok: false,
    issues: [
      error instanceof ShapeFailure
        ? error.issue
        : {
            code: "invalid-jsonld",
            path: "",
            message: "JSON-LD expansion or context loading failed.",
          },
    ],
  });
}
function copyJson(
  value: unknown,
  budget: Budget = { nodes: 0, strings: 0 },
  path = "",
  depth = 0,
  active = new Set<object>(),
): Json {
  if (depth > MAX_DEPTH || ++budget.nodes > MAX_NODES)
    fail("resource-limit", path, "JSON exceeds the depth or node limit.");
  if (typeof value === "string") {
    if ((budget.strings += value.length) > MAX_STRINGS)
      fail("resource-limit", path, "JSON exceeds the aggregate string limit.");
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object")
    fail(
      "invalid-json",
      path,
      "Only JSON values and finite numbers are accepted.",
    );
  if (active.has(value))
    fail("invalid-json", path, "Cyclic JSON input is not accepted.");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null)
    fail("invalid-json", path, "JSON objects must be plain objects.");
  if (array && prototype !== Array.prototype)
    fail("invalid-json", path, "JSON arrays must be plain arrays.");
  active.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Node | Json[] = array ? [] : {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (array && key === "length") continue;
    if (typeof key !== "string")
      fail("invalid-json", path, "JSON cannot contain symbol properties.");
    if (key === "__proto__")
      fail(
        "unsafe-json-key",
        `${path}/${pointer(key)}`,
        "Own __proto__ keys are not accepted.",
      );
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable)
      fail(
        "invalid-json",
        `${path}/${pointer(key)}`,
        "JSON properties must be enumerable data properties; accessors are not invoked.",
      );
    if (
      array &&
      (!/^(?:0|[1-9][0-9]*)$/.test(key) ||
        Number(key) > 4294967294 ||
        Number(key) >= (value as unknown[]).length)
    )
      fail(
        "invalid-json",
        `${path}/${pointer(key)}`,
        "JSON arrays cannot contain named properties.",
      );
    if ((budget.strings += key.length) > MAX_STRINGS)
      fail("resource-limit", path, "JSON exceeds the aggregate string limit.");
    const item = copyJson(
      descriptor.value,
      budget,
      `${path}/${pointer(key)}`,
      depth + 1,
      active,
    );
    if (Array.isArray(result)) result.push(item);
    else result[key] = item;
  }
  if (array && (result as Json[]).length !== (value as unknown[]).length)
    fail("invalid-json", path, "Sparse JSON arrays are not accepted.");
  active.delete(value);
  return result;
}
function checkBase(value: Json, path = ""): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${pointer(key)}`;
    if (key === "@base" && child !== null)
      fail(
        "unsupported-base",
        childPath,
        "Non-null @base is outside this raw shape profile.",
      );
    checkBase(child, childPath);
  }
}
function containsString(value: Json, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) => key.includes(needle) || containsString(child, needle),
  );
}
function checkGraphFragments(
  expanded: Json,
  factProperties: readonly string[],
): void {
  const inspected = new Set<string>();
  const inspect = (value: Json): void => {
    if (Array.isArray(value)) {
      for (const child of value) inspect(child);
    } else if (
      object(value) &&
      !("@value" in value) &&
      typeof value["@id"] === "string"
    ) {
      inspected.add(value["@id"]);
    }
  };
  for (const root of Array.isArray(expanded) ? expanded : [expanded]) {
    inspect(root);
    if (object(root) && !("@value" in root))
      for (const property of factProperties)
        if (property in root) inspect(root[property]);
  }
  const descriptions = new Set<string>();
  const visit = (value: Json, path: string): void => {
    if (Array.isArray(value)) {
      for (const [index, child] of value.entries())
        visit(child, `${path}/${index}`);
      return;
    }
    // Literal payloads, including @json, assert no graph/node statements.
    if (!object(value) || "@value" in value) return;
    if ("@included" in value)
      fail(
        "unsupported-lossy-shape",
        `${path}/@included`,
        "Included node descriptions are outside this raw shape profile.",
      );
    const reverse = value["@reverse"];
    if (object(reverse)) {
      for (const [property, members] of Object.entries(reverse)) {
        if (!Array.isArray(members)) continue;
        for (const [index, member] of members.entries()) {
          if (
            object(member) &&
            !("@value" in member) &&
            typeof member["@id"] === "string" &&
            inspected.has(member["@id"])
          )
            fail(
              "unsupported-lossy-shape",
              `${path}/@reverse/${pointer(property)}/${index}/@id`,
              "Reverse statements about an inspected node are outside this raw shape profile.",
            );
        }
      }
    }
    const id = value["@id"];
    // Reference-only nodes (even index-annotated ones) can recur freely.
    if (
      typeof id === "string" &&
      inspected.has(id) &&
      Object.keys(value).some((key) => key !== "@id" && key !== "@index")
    ) {
      if (descriptions.has(id))
        fail(
          "unsupported-lossy-shape",
          `${path}/@id`,
          "Repeated descriptions of one expanded node identifier are outside this raw shape profile.",
        );
      descriptions.add(id);
    }
    for (const [key, child] of Object.entries(value))
      visit(child, `${path}/${pointer(key)}`);
  };
  visit(expanded, "");
}
function remoteSnapshot(value: unknown, budget?: Budget): RemoteDocument {
  const snapshot = copyJson(value, budget);
  if (
    !object(snapshot) ||
    typeof snapshot.documentUrl !== "string" ||
    !(
      snapshot.contextUrl === null || typeof snapshot.contextUrl === "string"
    ) ||
    !("document" in snapshot)
  )
    fail(
      "invalid-context",
      "",
      "A context loader must return a JSON RemoteDocument.",
    );
  if (!object(snapshot.document))
    fail(
      "invalid-context",
      "/document",
      "Context documents must be parsed JSON objects, not encoded JSON strings.",
    );
  checkBase(snapshot.document);
  return {
    document: snapshot.document,
    documentUrl: snapshot.documentUrl,
    contextUrl: snapshot.contextUrl,
  };
}

/**
 * Create an offline context-only loader that returns detached copies of the
 * preloaded JSON-LD contexts. Unknown URLs reject; no network fallback is used.
 * The parser catches loader rejections and returns shape diagnostics.
 *
 * @example
 * ```typescript
 * import { getDeliverySuspensionContextLoader } from "@fedify/fedify/delivery-suspension";
 * const contextLoader = getDeliverySuspensionContextLoader();
 * const context = await contextLoader("https://w3id.org/fep/f799");
 * ```
 * @since 2.5.0
 */
export function getDeliverySuspensionContextLoader(): DocumentLoader {
  return (url) => {
    try {
      if (!Object.hasOwn(preloadedContexts, url))
        fail(
          "unknown-context",
          "",
          "The context is not preloaded; an explicit bounded loader is required.",
        );
      const document = copyJson(preloadedContexts[url]);
      checkBase(document);
      return Promise.resolve({ document, contextUrl: null, documentUrl: url });
    } catch (error) {
      return Promise.reject(error);
    }
  };
}
const WARNING_EVENTS = new Set([
  "invalid property",
  "prepending @vocab during expansion",
  "relative @type reference",
  "relative IRI after expansion",
  "relative @id reference",
]);
async function prepare(
  input: unknown,
  options: ParseOptions,
  factProperties: readonly string[] = [],
): Promise<Prepared> {
  // The first await is deliberately after this detached JSON-only snapshot.
  const raw = copyJson(input);
  if (raw === null || typeof raw !== "object")
    fail(
      "invalid-document",
      "",
      "Supply a JSON object or array, never a remote resource URL.",
    );
  checkBase(raw);
  const sourceLoader =
    options.contextLoader ?? getDeliverySuspensionContextLoader();
  const cache = new Map<string, Promise<RemoteDocument>>();
  const snapshots: Json[] = [];
  const contextBudget: Budget = { nodes: 0, strings: 0 };
  let markerPrefix: string | undefined;
  let loaderFailure: unknown;
  const loader: DocumentLoader = async (url) => {
    try {
      let snapshot = cache.get(url);
      if (snapshot === undefined) {
        if (cache.size >= MAX_CONTEXTS)
          fail("resource-limit", "", "Too many distinct context URLs.");
        snapshot = (async () => {
          const result = remoteSnapshot(await sourceLoader(url), contextBudget);
          const document = result.document as Json;
          if (
            markerPrefix !== undefined &&
            containsString(document, markerPrefix)
          )
            fail(
              "diagnostic-collision",
              "",
              "A loaded context collides with diagnostic occurrence markers.",
            );
          snapshots.push(document);
          return result;
        })();
        cache.set(url, snapshot);
      }
      // Strip arbitrary loader properties, including jsonld's global-cache tag.
      const result = await snapshot;
      return { ...result, document: copyJson(result.document) };
    } catch (error) {
      loaderFailure = error;
      throw error;
    }
  };
  const warnings: ShapeIssue[] = [];
  let expansionLoader: DocumentLoader = loader;
  // jsonld() is the library's API-instance factory. A private instance prevents
  // ambient static-tagged context caches from bypassing this call's loader.
  const processor = (jsonld as typeof jsonld & (() => typeof jsonld))();
  const expand = async (value: Json, diagnostic: boolean): Promise<Json> => {
    let result: unknown;
    try {
      result = await processor.expand(
        value as Parameters<typeof jsonld.expand>[0],
        {
          base: null,
          documentLoader: expansionLoader,
          eventHandler: ({
            event,
          }: {
            event: { code: string; message: string };
          }) => {
            // Explicit null @value occurrences are classified through the second
            // pass rather than disappearing from metadata diagnostics.
            if (!diagnostic && event.code === "null @value value") return;
            if (!WARNING_EVENTS.has(event.code))
              fail(
                "unsupported-lossy-shape",
                "",
                `JSON-LD event outside the conservative profile: ${event.code}.`,
              );
            if (!diagnostic)
              warnings.push({
                code: "jsonld-warning",
                path: "",
                message: `${event.code}: ${event.message}`,
              });
          },
        } as Parameters<typeof jsonld.expand>[1],
      );
    } catch (error) {
      throw loaderFailure ?? error;
    }
    return copyJson(result);
  };
  const expansionBudget = await prepareExpansionBudget(raw, loader);
  expansionLoader = async (url) => {
    try {
      return await expansionBudget.loader(url);
    } catch (error) {
      loaderFailure = error;
      throw error;
    }
  };
  let attempt = 0;
  do {
    if (attempt >= MAX_MARKER_ATTEMPTS)
      fail(
        "resource-limit",
        "",
        "Diagnostic marker selection exceeded eight collision attempts.",
      );
    markerPrefix = `\u0000fedify-f799-occurrence-${attempt++}:`;
  } while (
    containsString(raw, markerPrefix) ||
    snapshots.some((context) => containsString(context, markerPrefix!))
  );
  const markers = new Map<string, Marker>();
  const diagnosticClone = (value: Json, path = "", payload = false): Json => {
    if (value === null || (Array.isArray(value) && value.length === 0)) {
      const key = `${markerPrefix}${markers.size}`;
      markers.set(key, { raw: value, rawPath: path, payload });
      return payload
        ? key
        : value === null
          ? { "@value": key }
          : [{ "@value": key }];
    }
    if (Array.isArray(value))
      return value.map((child, index) =>
        diagnosticClone(child, `${path}/${index}`),
      );
    if (!object(value)) return value;
    const result: Node = {};
    for (const [key, child] of Object.entries(value))
      result[key] =
        key === "@context"
          ? child
          : diagnosticClone(child, `${path}/${pointer(key)}`, key === "@value");
    return result;
  };
  const diagnosticInput = diagnosticClone(raw);
  // Reserve both passes before either one can materialize expanded IRIs.
  expansionBudget.estimate(raw);
  expansionBudget.estimate(diagnosticInput);
  const expanded = await expand(raw, false);
  checkGraphFragments(expanded, factProperties);
  const diagnostic = await expand(diagnosticInput, true);
  const counts = new Map<string, number>();
  const count = (value: Json): void => {
    if (typeof value === "string" && markers.has(value))
      counts.set(value, (counts.get(value) ?? 0) + 1);
    else if (value !== null && typeof value === "object")
      for (const child of Object.values(value)) count(child);
  };
  count(diagnostic);
  for (const [marker, original] of markers)
    if (counts.get(marker) !== 1)
      fail(
        "unsupported-lossy-shape",
        "",
        "A null or empty occurrence did not survive exactly once under JSON-LD expansion.",
        original.rawPath,
      );
  if (
    !Array.isArray(expanded) ||
    expanded.length !== 1 ||
    !object(expanded[0]) ||
    !Array.isArray(diagnostic) ||
    diagnostic.length !== 1 ||
    !object(diagnostic[0])
  )
    fail(
      "invalid-document",
      "",
      "Exactly one expanded top-level node is required.",
    );
  return {
    raw,
    expanded,
    node: diagnostic[0],
    markers,
    warnings,
    locations: evidenceLocations(diagnostic, expanded, markers),
  };
}
/** Build locations against ORIGINAL expanded evidence. Throws on unexplained drift.
 * `diagnostic` and `expanded` are complete expanded arrays, not their first nodes.
 */
function evidenceLocations(
  diagnostic: Json,
  expanded: Json,
  markers: ReadonlyMap<string, Marker>,
): EvidenceLocations {
  const locations: EvidenceLocations = new WeakMap();
  const isNode = (value: Json | undefined): value is Node =>
    value !== undefined && object(value);
  const entry = (v: Json): Marker | undefined =>
    typeof v === "string"
      ? markers.get(v)
      : isNode(v) && typeof v["@value"] === "string"
        ? markers.get(v["@value"])
        : undefined;
  const restore = (v: Json): Json => {
    const m = entry(v);
    if (m && (!m.payload || typeof v === "string")) return m.raw;
    if (Array.isArray(v)) {
      if (v.length === 1) {
        const wrapped = entry(v[0]);
        if (
          wrapped &&
          !wrapped.payload &&
          Array.isArray(wrapped.raw) &&
          wrapped.raw.length === 0
        )
          return [];
      }
      return v.map(restore);
    }
    if (isNode(v))
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, restore(x)]),
      );
    return v;
  };
  // An @json literal preserves null/[] payloads in original expansion. Other
  // null @value literals disappear. Registered whole-occurrence markers disappear.
  const dropped = (v: Json): boolean => {
    const m = entry(v);
    return (
      m !== undefined && !(isNode(v) && m.payload && v["@type"] === "@json")
    );
  };
  const mismatch = (): never =>
    fail(
      "unsupported-lossy-shape",
      "",
      "Diagnostic occurrences cannot be matched to original expanded evidence.",
    );
  const walk = (d: Json, e: Json | undefined, path: string): void => {
    if (Array.isArray(d)) {
      if (e !== undefined && !Array.isArray(e)) mismatch();
      const originals = e === undefined ? [] : (e as Json[]);
      let index = 0;
      for (const child of d) {
        if (dropped(child)) continue;
        if (index >= originals.length) mismatch();
        walk(child, originals[index], `${path}/${index++}`);
      }
      if (index !== originals.length) mismatch();
      return;
    }
    if (isNode(d)) {
      if (!isNode(e)) mismatch();
      const originalNode = e as Node;
      if (d["@type"] === "@json") {
        if (JSON.stringify(restore(d)) !== JSON.stringify(e)) mismatch();
        return;
      }
      const props = new Map<string, readonly EvidenceLocation[]>();
      locations.set(d, props);
      for (const key of Object.keys(originalNode))
        if (!Object.hasOwn(d, key)) mismatch();
      for (const [key, value] of Object.entries(d)) {
        const childPath = `${path}/${pointer(key)}`;
        const originalValue = originalNode[key];
        if (Array.isArray(value)) {
          if (originalValue !== undefined && !Array.isArray(originalValue))
            mismatch();
          const originals =
            originalValue === undefined ? [] : (originalValue as Json[]);
          const fallback = originalValue === undefined ? path : childPath;
          const memberLocations: EvidenceLocation[] = [];
          let index = 0;
          for (const child of value) {
            if (dropped(child)) {
              const m = entry(child)!;
              memberLocations.push({ path: fallback, rawPath: m.rawPath });
            } else {
              if (index >= originals.length) mismatch();
              const memberPath = `${childPath}/${index}`;
              // A retained @json payload marker still carries provenance.
              const m = entry(child);
              memberLocations.push({
                path: memberPath,
                ...(m ? { rawPath: m.rawPath } : {}),
              });
              walk(child, originals[index++], memberPath);
            }
          }
          if (index !== originals.length) mismatch();
          props.set(key, memberLocations);
        } else {
          if (originalValue === undefined) mismatch();
          walk(value, originalValue, childPath);
        }
      }
      return;
    }
    const restored = restore(d);
    if (Array.isArray(restored) || isNode(restored)) {
      // JSON literal marker payload [] is atomic at this point.
      if (JSON.stringify(restored) !== JSON.stringify(e)) mismatch();
    } else if (restored !== e) mismatch();
  };
  walk(diagnostic, expanded, "");
  return locations;
}

function marker(value: Json, prepared: Prepared): Marker | undefined {
  if (typeof value === "string") return prepared.markers.get(value);
  if (object(value) && typeof value["@value"] === "string")
    return prepared.markers.get(value["@value"]);
  return undefined;
}
function original(value: Json, prepared: Prepared): Json {
  const entry = marker(value, prepared);
  if (entry !== undefined && (!entry.payload || typeof value === "string"))
    return entry.raw;
  if (Array.isArray(value)) {
    const only = value.length === 1 ? marker(value[0], prepared) : undefined;
    if (
      only !== undefined &&
      !only.payload &&
      Array.isArray(only.raw) &&
      only.raw.length === 0
    )
      return [];
    return value.map((child) => original(child, prepared));
  }
  if (!object(value)) return value;
  const result: Node = {};
  for (const [key, child] of Object.entries(value))
    result[key] = original(child, prepared);
  return result;
}
function occurrences(
  node: Node,
  property: string,
  path: string,
  prepared: Prepared,
): Occurrence[] {
  if (!(property in node)) return [];
  const values = Array.isArray(node[property])
    ? (node[property] as Json[])
    : [node[property]];
  return values.map((value, index) => {
    const location = prepared.locations.get(node)?.get(property)?.[index];
    if (location === undefined)
      fail(
        "unsupported-lossy-shape",
        path,
        "An occurrence has no original evidence location.",
      );
    return { value, ...location };
  });
}
function single(
  node: Node,
  property: string,
  path: string,
  prepared: Prepared,
  required = true,
): Occurrence | undefined {
  const values = occurrences(node, property, path, prepared);
  if (values.length === 0 && !required) return undefined;
  if (values.length !== 1)
    fail(
      "invalid-cardinality",
      `${path}/${pointer(property)}`,
      `Expected ${required ? "exactly one" : "at most one"} value.`,
    );
  return values[0];
}
function issue(
  code: string,
  occurrence: Occurrence,
  message: string,
): ShapeIssue {
  return {
    code,
    path: occurrence.path,
    message,
    ...(occurrence.rawPath === undefined
      ? {}
      : { rawPath: occurrence.rawPath }),
  };
}
function bad(code: string, occurrence: Occurrence, message: string): never {
  throw new ShapeFailure(code, occurrence.path, message, occurrence.rawPath);
}
function literal(
  occurrence: Occurrence,
  datatype: string | undefined,
  prepared: Prepared,
  nativeInteger = false,
): string | number {
  const value = occurrence.value;
  if (
    marker(value, prepared) !== undefined ||
    !object(value) ||
    !("@value" in value) ||
    Object.keys(value).some((key) => key !== "@value" && key !== "@type")
  )
    bad(
      "invalid-literal",
      occurrence,
      "A single literal without language, index, list, JSON, or other annotations is required.",
    );
  if (
    datatype === XSD + "dateTime"
      ? value["@type"] !== datatype
      : value["@type"] !== undefined && value["@type"] !== datatype
  )
    bad("invalid-datatype", occurrence, "The literal has the wrong datatype.");
  if (nativeInteger) {
    if (
      typeof value["@value"] !== "number" ||
      !Number.isSafeInteger(value["@value"]) ||
      value["@value"] < 1
    )
      bad(
        "invalid-revision",
        occurrence,
        "Revision must be a positive JSON safe integer, without string coercion.",
      );
    return value["@value"];
  }
  if (
    typeof value["@value"] !== "string" ||
    prepared.markers.has(value["@value"])
  )
    bad("invalid-literal", occurrence, "A string literal is required.");
  if (
    datatype === XSD + "dateTime" &&
    parseExactDateTime(value["@value"]) === null
  )
    bad(
      "invalid-time",
      occurrence,
      "An XSD 1.1 dateTime with an explicit timezone and at most 4096 code units is required.",
    );
  return value["@value"];
}
function link(
  occurrence: Occurrence,
  prepared: Prepared,
  strictOrigin: boolean,
): string {
  const value = occurrence.value;
  if (
    marker(value, prepared) !== undefined ||
    !object(value) ||
    Object.keys(value).length !== 1 ||
    typeof value["@id"] !== "string"
  )
    bad("invalid-link", occurrence, "A reference-only @id node is required.");
  const uri = value["@id"];
  const error = validateHttpsUri(uri);
  if (error !== null) bad("invalid-https-uri", occurrence, error);
  const origin = getDeliverySuspensionUrlOrigin(uri);
  if (!origin.ok) {
    if (strictOrigin)
      bad(
        "invalid-origin",
        occurrence,
        "The claimed identifier requires a strict HTTPS origin.",
      );
    prepared.warnings.push(
      issue(
        "unavailable-origin",
        occurrence,
        "The exact HTTPS link is retained, but its strict origin is invalid; no origin scope is implied.",
      ),
    );
  }
  return uri;
}
function id(
  node: Node,
  path: string,
  prepared: Prepared,
  strictOrigin: boolean,
): string {
  const occurrence: Occurrence = {
    value: { "@id": node["@id"] ?? null },
    path: `${path}/@id`,
  };
  return link(occurrence, prepared, strictOrigin);
}
function types(node: Node, path: string): string[] {
  const value = node["@type"];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    fail(
      "invalid-type",
      `${path}/@type`,
      "Expanded RDF types must be strings.",
    );
  return value as string[];
}
function originOf(value: string): DeliverySuspensionOrigin {
  const parsed = getDeliverySuspensionUrlOrigin(value);
  if (!parsed.ok)
    fail(
      "invalid-origin",
      "",
      "A strict claimed identifier origin is required.",
    );
  return parsed.value;
}
function sameOrigin(a: string, b: string, path: string): void {
  if (originOf(a).normalized !== originOf(b).normalized)
    fail(
      "inconsistent-origin",
      path,
      "Claimed identity origins must match the controller; this is not ownership verification.",
    );
}
function notice(
  node: Node,
  path: string,
  prepared: Prepared,
  raw: Json,
  expanded: Json,
): DeliverySuspensionFacts {
  const rdfTypes = types(node, path);
  if (!rdfTypes.includes(F799 + "DeliverySuspension"))
    fail(
      "not-applicable",
      `${path}/@type`,
      "This node is not a DeliverySuspension.",
    );
  const identifier = id(node, path, prepared, true);
  const controller = link(
    single(node, AS + "attributedTo", path, prepared)!,
    prepared,
    true,
  );
  const published = literal(
    single(node, AS + "published", path, prepared)!,
    XSD + "dateTime",
    prepared,
  ) as string;
  const statusOccurrence = single(node, F799 + "status", path, prepared)!;
  const status = literal(statusOccurrence, XSD + "string", prepared);
  if (status !== "active" && status !== "cancelled")
    bad(
      "invalid-status",
      statusOccurrence,
      "FEP-f799 status must be active or cancelled.",
    );
  const revision = literal(
    single(node, F799 + "revision", path, prepared)!,
    XSD + "integer",
    prepared,
    true,
  ) as number;
  const endTime = literal(
    single(node, AS + "endTime", path, prepared)!,
    XSD + "dateTime",
    prepared,
  ) as string;
  const startOccurrence = single(node, AS + "startTime", path, prepared, false);
  const startTime =
    startOccurrence === undefined
      ? undefined
      : (literal(startOccurrence, XSD + "dateTime", prepared) as string);
  if (
    startTime !== undefined &&
    compareExactDateTimes(
      parseExactDateTime(endTime)!,
      parseExactDateTime(startTime)!,
    ) <= 0
  )
    fail(
      "invalid-interval",
      `${path}/${pointer(AS + "endTime")}`,
      "endTime must be strictly later than startTime.",
    );
  const announcementOccurrence = single(
    node,
    F799 + "announcement",
    path,
    prepared,
    false,
  );
  const announcement =
    announcementOccurrence === undefined
      ? undefined
      : link(announcementOccurrence, prepared, true);
  const inboxes = occurrences(node, F799 + "targetInbox", path, prepared);
  const origins = occurrences(node, F799 + "targetOrigin", path, prepared);
  if (inboxes.length + origins.length !== 1)
    fail(
      "invalid-target",
      path,
      "Exactly one targetInbox or targetOrigin occurrence is required, including null and empty occurrences.",
    );
  let target: DeliverySuspensionTarget;
  let normalizedTargetOrigin: DeliverySuspensionOrigin | undefined;
  if (inboxes.length === 1)
    target = { kind: "inbox", inbox: link(inboxes[0], prepared, false) };
  else {
    const origin = literal(origins[0], XSD + "string", prepared) as string;
    const normalized = parseDeliverySuspensionOrigin(origin);
    if (!normalized.ok)
      bad(
        "invalid-origin",
        origins[0],
        "targetOrigin must be a strict HTTPS root origin.",
      );
    target = { kind: "origin", origin };
    normalizedTargetOrigin = normalized.value;
  }
  sameOrigin(identifier, controller, `${path}/@id`);
  if (announcement !== undefined)
    sameOrigin(announcement, controller, announcementOccurrence!.path);
  return {
    id: identifier,
    controller,
    published,
    suspensionStatus: status,
    target,
    ...(normalizedTargetOrigin === undefined ? {} : { normalizedTargetOrigin }),
    revision,
    ...(announcement === undefined ? {} : { announcement }),
    ...(startTime === undefined ? {} : { startTime }),
    endTime,
    types: rdfTypes,
    raw,
    expanded,
  };
}

/**
 * Inspect an untrusted raw DeliverySuspension using JSON-LD semantics. Exact
 * expanded IRI claims (including compact-IRI/@vocab expansion), lexical times,
 * detached input, and original expansion are retained without RDF deduplication.
 * Embedded activity notices retain the containing source document as raw evidence.
 * Origin normalization evidence is separate in normalizedTargetOrigin; the target
 * itself remains a reusable description containing its original string claim.
 * Success checks shape and claimed identity consistency only, never authority,
 * authenticity, currentness, history, or complete signed-state equality.
 *
 * This conservative profile rejects non-null @base, lossy expansion events and
 * null/empty occurrences that cannot survive diagnostic expansion exactly once,
 * even on unrelated properties. Such failures precede metadata diagnostics.
 * JSON input is bounded to depth 64, 10000 value nodes, and 1048576 aggregate
 * string code units. Contexts have a separate shared budget with the same
 * bounds, and at most 32 distinct context URLs are allowed.
 * Before either expansion, the complete context closure is checked and both
 * passes reserve a shared conservative work budget. Context strings and term
 * names are at most 2048 code units. Prefix and `@vocab` anchors must be fixed
 * hierarchical absolute IRIs or `_:`; context URLs must be absolute and
 * hierarchical.
 * Chained prefixes, IRI-shaped context term names, nested context wrappers,
 * relative context URLs, and objects containing `@context` in positions that
 * may hold opaque JSON payloads are outside this profile. Each context graph is limited to depth 64 and 4096 unfolded
 * objects or definitions. Marker selection allows at most eight collision attempts.
 * The work budget is an admission estimate, not an exact heap or time limit.
 * Expanded `@included` outside `@value` literals is rejected. Repeated
 * descriptions of an inspected `@id` are also rejected across the document,
 * including named graphs. Properties asserted through `@reverse` for inspected
 * IDs are rejected too. Inspected IDs belong to the root node and, depending
 * on the parser, the nodes directly under an activity's `object` or an actor's
 * `endpoints`. Descriptions of other IDs may repeat, as may references with
 * only `@id` and an optional `@index`. `@value` payloads are opaque to this
 * check; other profile limits still apply.
 * Timestamp lexemes are bounded to 4096 code units, with arbitrary fractional
 * precision within that bound. Only plain JSON data properties are accepted;
 * own __proto__ keys, accessors, cycles, sparse arrays and nonfinite numbers fail.
 * Copying precedes asynchronous loading. Unknown default contexts never fetch;
 * an explicit contextLoader opts into caller-owned, bounded context I/O.
 *
 * An already parsed unknown value cannot reveal duplicate JSON member names or
 * distinguish numeric lexemes such as 1, 1.0 and 1e0. Integrity verification must
 * retain its original signing input. Malformed input and loader failures return
 * ok:false rather than rejecting this promise. Returned evidence is deep frozen.
 *
 * @example
 * ```typescript
 * import { parseDeliverySuspensionDocument } from "@fedify/fedify/delivery-suspension";
 * async function inspectNotice(rawJson: unknown) {
 *   const result = await parseDeliverySuspensionDocument(rawJson);
 *   if (result.ok) console.log(result.value.target); // An unverified claim.
 * }
 * ```
 * @since 2.5.0
 */
export async function parseDeliverySuspensionDocument(
  raw: unknown,
  options: ParseOptions = {},
): Promise<ParseResult<DeliverySuspensionFacts>> {
  try {
    const prepared = await prepare(raw, options);
    return freeze({
      ok: true,
      value: notice(
        prepared.node,
        "/0",
        prepared,
        prepared.raw,
        prepared.expanded,
      ),
      warnings: prepared.warnings,
    });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Inspect Create/Update with an embedded complete notice, or an Undo's unverified
 * original-Create reference. No resource is fetched. Matching extra RDF types
 * are retained; Create(Note) returns not-applicable. Success is not authenticity,
 * authority, prior publication, replay admission or a delivery-hold exemption.
 * In particular an Undo reference does not prove its target was an FEP-f799
 * Create. Uses the same bounded conservative JSON-LD profile as
 * {@link parseDeliverySuspensionDocument}.
 *
 * @example
 * ```typescript
 * import { parseDeliverySuspensionActivityDocument } from "@fedify/fedify/delivery-suspension";
 * async function inspectActivity(rawActivity: unknown) {
 *   const result = await parseDeliverySuspensionActivityDocument(rawActivity);
 *   if (result.ok && result.value.kind === "undo") console.log(result.value.undoneActivity);
 * }
 * ```
 * @since 2.5.0
 */
export async function parseDeliverySuspensionActivityDocument(
  raw: unknown,
  options: ParseOptions = {},
): Promise<ParseResult<DeliverySuspensionActivityFacts>> {
  try {
    const prepared = await prepare(raw, options, [AS + "object"]);
    const node = prepared.node;
    const path = "/0";
    const rdfTypes = types(node, path);
    const controlTypes = ["Create", "Update", "Undo"].filter((type) =>
      rdfTypes.includes(AS + type),
    );
    if (controlTypes.length === 0)
      fail(
        "not-applicable",
        "/0/@type",
        "This is not a supported control-activity shape.",
      );
    if (controlTypes.length !== 1)
      fail(
        "invalid-type",
        "/0/@type",
        "Exactly one recognized control-activity type is required.",
      );
    const value = single(node, AS + "object", path, prepared)!;
    if (
      controlTypes[0] !== "Undo" &&
      object(value.value) &&
      marker(value.value, prepared) === undefined &&
      !types(value.value, value.path).includes(F799 + "DeliverySuspension")
    )
      fail(
        "not-applicable",
        `${value.path}/@type`,
        "This node is not a DeliverySuspension.",
      );
    const identifier = id(node, path, prepared, true);
    const actor = link(
      single(node, AS + "actor", path, prepared)!,
      prepared,
      true,
    );
    const published = literal(
      single(node, AS + "published", path, prepared)!,
      XSD + "dateTime",
      prepared,
    ) as string;
    sameOrigin(identifier, actor, "/0/@id");
    const common = {
      id: identifier,
      actor,
      published,
      types: rdfTypes,
      raw: prepared.raw,
      expanded: prepared.expanded,
    };
    if (controlTypes[0] === "Undo") {
      if (!object(value.value) || marker(value.value, prepared) !== undefined)
        bad("invalid-object", value, "Undo must identify one Create activity.");
      const embedded = value.value;
      let undoneActivity: string;
      let embeddedCreate:
        | { id: string; actor: string; types: readonly string[] }
        | undefined;
      if (
        Object.keys(embedded).length === 1 &&
        typeof embedded["@id"] === "string"
      )
        undoneActivity = link(value, prepared, true);
      else {
        const embeddedTypes = types(embedded, value.path);
        if (
          !embeddedTypes.includes(AS + "Create") ||
          embeddedTypes.some(
            (type) => type === AS + "Update" || type === AS + "Undo",
          )
        )
          bad(
            "invalid-object",
            value,
            "An embedded Undo object must claim Create without another control type.",
          );
        undoneActivity = id(embedded, value.path, prepared, true);
        const embeddedActor = link(
          single(embedded, AS + "actor", value.path, prepared)!,
          prepared,
          true,
        );
        if (embeddedActor !== actor)
          bad(
            "inconsistent-actor",
            value,
            "Embedded Create actor must exactly equal the Undo actor.",
          );
        embeddedCreate = {
          id: undoneActivity,
          actor: embeddedActor,
          types: embeddedTypes,
        };
      }
      if (undoneActivity === identifier)
        bad(
          "invalid-activity-id",
          value,
          "Undo must have its own distinct id.",
        );
      sameOrigin(undoneActivity, actor, value.path);
      return freeze({
        ok: true,
        value: {
          ...common,
          kind: "undo",
          undoneActivity,
          ...(embeddedCreate === undefined ? {} : { embeddedCreate }),
        },
        warnings: prepared.warnings,
      });
    }
    if (!object(value.value) || marker(value.value, prepared) !== undefined)
      bad(
        "invalid-object",
        value,
        "Create/Update requires an embedded DeliverySuspension.",
      );
    const actualNode = (prepared.expanded as Json[])[0] as Node;
    const actualObjects = actualNode[AS + "object"];
    const actualObject = Array.isArray(actualObjects) ? actualObjects[0] : null;
    const suspension = notice(
      value.value,
      value.path,
      prepared,
      prepared.raw,
      actualObject ?? null,
    );
    if (suspension.id === identifier)
      bad(
        "invalid-activity-id",
        value,
        "An activity must have an id distinct from its notice.",
      );
    if (controlTypes[0] === "Update" && suspension.announcement === identifier)
      bad(
        "invalid-activity-id",
        value,
        "Update must not reuse the original Create announcement id.",
      );
    if (suspension.controller !== actor)
      bad(
        "inconsistent-actor",
        value,
        "Activity actor must exactly equal the notice attributedTo.",
      );
    if (controlTypes[0] === "Create") {
      if (suspension.revision !== 1)
        bad("invalid-create-revision", value, "Create must carry revision 1.");
      if (suspension.announcement !== identifier)
        bad(
          "inconsistent-announcement",
          value,
          "Create id must exactly equal the required notice announcement.",
        );
    }
    return freeze({
      ok: true,
      value: {
        ...common,
        kind: controlTypes[0] === "Create" ? "create" : "update",
        suspension,
      },
      warnings: prepared.warnings,
    });
  } catch (error) {
    return failure(error);
  }
}
function linkState(values: readonly ControlLinkValue[]): ControlLinkState {
  return {
    state:
      values.length === 0
        ? "absent"
        : values.length > 1
          ? "multiple"
          : values[0].valid
            ? "single"
            : "invalid",
    values,
  };
}
function controlLinks(
  values: Occurrence[],
  prepared: Prepared,
): ControlLinkState {
  const entries: ControlLinkValue[] = values.map((occurrence) => {
    const evidence = {
      raw: original(occurrence.value, prepared),
      path: occurrence.path,
      ...(occurrence.rawPath === undefined
        ? {}
        : { rawPath: occurrence.rawPath }),
    };
    try {
      return {
        ...evidence,
        valid: true,
        value: link(occurrence, prepared, false),
        issues: [],
      };
    } catch (error) {
      const diagnostic = failure<never>(error);
      const issues = diagnostic.ok ? [] : diagnostic.issues;
      prepared.warnings.push(...issues);
      return { ...evidence, valid: false, issues };
    }
  });
  const state = linkState(entries);
  if (state.state === "multiple")
    prepared.warnings.push({
      code: "multiple-links",
      path: entries[0].path,
      message:
        "Multiple link occurrences are retained, including invalid members.",
    });
  return state;
}
function metadataId(prepared: Prepared, options: ControlParseOptions): string {
  const identifier = id(prepared.node, "/0", prepared, false);
  if (options.expectedId !== undefined && identifier !== options.expectedId)
    fail(
      "unexpected-id",
      "/0/@id",
      "The exact expanded representation id does not match expectedId.",
    );
  return identifier;
}

/**
 * Inspect actor inbox, endpoints/sharedInbox and controlled-origin claims without
 * fetching linked representations or inferring control from actor type. Every
 * link occurrence remains visible: multiplicity takes precedence over invalid
 * members. Referenced `endpoints` values, including those with an `@index`
 * annotation, remain unresolved; multiple embedded parents retain parent
 * ambiguity and all `sharedInbox` occurrences. controlledOrigins
 * preserves each literal and its independent strict normalization result.
 * Malformed extension claims are diagnostic facts; malformed document IDs,
 * expectedId mismatch and conservative-profile failures return ok:false.
 * Uses {@link parseDeliverySuspensionDocument}'s limits and JSON-LD semantics.
 *
 * @example
 * ```typescript
 * import { parseActorControlMetadata } from "@fedify/fedify/delivery-suspension";
 * async function inspectActor(rawActor: unknown, actorId: string) {
 *   const actor = await parseActorControlMetadata(rawActor, { expectedId: actorId });
 *   if (actor.ok) console.log(actor.value.inbox.state);
 * }
 * ```
 * @since 2.5.0
 */
export async function parseActorControlMetadata(
  raw: unknown,
  options: ControlParseOptions = {},
): Promise<ParseResult<ActorControlMetadata>> {
  try {
    const controlOptions: ControlParseOptions = {
      expectedId: options.expectedId,
      contextLoader: options.contextLoader,
    };
    const prepared = await prepare(raw, controlOptions, [AS + "endpoints"]);
    const identifier = metadataId(prepared, controlOptions);
    const inbox = controlLinks(
      occurrences(prepared.node, INBOX, "/0", prepared),
      prepared,
    );
    const endpoints: ActorEndpointsMetadata[] = [];
    const sharedValues: ControlLinkValue[] = [];
    for (const occurrence of occurrences(
      prepared.node,
      AS + "endpoints",
      "/0",
      prepared,
    )) {
      const evidence = {
        raw: original(occurrence.value, prepared),
        path: occurrence.path,
        ...(occurrence.rawPath === undefined
          ? {}
          : { rawPath: occurrence.rawPath }),
      };
      if (
        object(occurrence.value) &&
        marker(occurrence.value, prepared) === undefined
      ) {
        const endpoint = occurrence.value;
        if (
          Object.hasOwn(endpoint, "@id") &&
          Object.keys(endpoint).every(
            (key) => key === "@id" || key === "@index",
          )
        ) {
          // Index annotations do not describe an embedded node. Validate only
          // the reference; evidence above retains its original index and path.
          const state = controlLinks(
            [{ ...occurrence, value: { "@id": endpoint["@id"] } }],
            prepared,
          );
          endpoints.push({
            ...evidence,
            kind: state.values[0].valid ? "unresolved" : "invalid",
            ...(state.values[0].value === undefined
              ? {}
              : { reference: state.values[0].value }),
            sharedInbox: linkState([]),
            issues: state.values[0].issues,
          });
        } else if (
          !Object.keys(endpoint).some((key) =>
            ["@value", "@list", "@graph", "@set"].includes(key),
          )
        ) {
          const sharedInbox = controlLinks(
            occurrences(
              endpoint,
              AS + "sharedInbox",
              occurrence.path,
              prepared,
            ),
            prepared,
          );
          sharedValues.push(...sharedInbox.values);
          endpoints.push({
            ...evidence,
            kind: "embedded",
            sharedInbox,
            issues: [],
          });
        } else {
          const problem = issue(
            "invalid-endpoints",
            occurrence,
            "An endpoints value must be an embedded node or unresolved HTTPS reference.",
          );
          prepared.warnings.push(problem);
          endpoints.push({
            ...evidence,
            kind: "invalid",
            sharedInbox: linkState([]),
            issues: [problem],
          });
        }
      } else {
        const problem = issue(
          "invalid-endpoints",
          occurrence,
          "An endpoints value must be an embedded node or unresolved HTTPS reference.",
        );
        prepared.warnings.push(problem);
        endpoints.push({
          ...evidence,
          kind: "invalid",
          sharedInbox: linkState([]),
          issues: [problem],
        });
      }
    }
    if (endpoints.length > 1)
      prepared.warnings.push({
        code: "multiple-endpoints",
        path: `/0/${pointer(AS + "endpoints")}`,
        message:
          "Multiple endpoints parents are retained; no unique parent is selected.",
      });
    const controlledOrigins: ControlledOriginValue[] = occurrences(
      prepared.node,
      F799 + "controlledOrigin",
      "/0",
      prepared,
    ).map((occurrence) => {
      const evidence = {
        raw: original(occurrence.value, prepared),
        path: occurrence.path,
        ...(occurrence.rawPath === undefined
          ? {}
          : { rawPath: occurrence.rawPath }),
      };
      try {
        const value = literal(occurrence, XSD + "string", prepared) as string;
        const normalization = parseDeliverySuspensionOrigin(value);
        if (!normalization.ok)
          prepared.warnings.push(
            ...normalization.issues.map((problem) => ({
              ...problem,
              path: occurrence.path,
            })),
          );
        return { ...evidence, value, normalization };
      } catch (error) {
        const normalization = failure<DeliverySuspensionOrigin>(error);
        if (!normalization.ok) prepared.warnings.push(...normalization.issues);
        return { ...evidence, normalization };
      }
    });
    return freeze({
      ok: true,
      value: {
        id: identifier,
        types: types(prepared.node, "/0"),
        inbox,
        endpoints,
        endpointsAmbiguous: endpoints.length > 1,
        sharedInbox: linkState(sharedValues),
        controlledOrigins,
        raw: prepared.raw,
        expanded: prepared.expanded,
      },
      warnings: prepared.warnings,
    });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Inspect inboxOf and deliveryController reverse-link claims without fetching or
 * deciding authority. Absence, a single valid link, a single invalid occurrence,
 * and multiple occurrences (including invalid members) remain distinct.
 * Uses {@link parseDeliverySuspensionDocument}'s bounded conservative profile;
 * malformed IDs and expectedId mismatches fail instead of becoming metadata.
 *
 * @example
 * ```typescript
 * import { parseInboxControlMetadata } from "@fedify/fedify/delivery-suspension";
 * async function inspectInbox(rawInbox: unknown, inboxId: string) {
 *   const inbox = await parseInboxControlMetadata(rawInbox, { expectedId: inboxId });
 *   if (inbox.ok) console.log(inbox.value.deliveryController.state);
 * }
 * ```
 * @since 2.5.0
 */
export async function parseInboxControlMetadata(
  raw: unknown,
  options: ControlParseOptions = {},
): Promise<ParseResult<InboxControlMetadata>> {
  try {
    const controlOptions: ControlParseOptions = {
      expectedId: options.expectedId,
      contextLoader: options.contextLoader,
    };
    const prepared = await prepare(raw, controlOptions);
    const identifier = metadataId(prepared, controlOptions);
    return freeze({
      ok: true,
      value: {
        id: identifier,
        types: types(prepared.node, "/0"),
        inboxOf: controlLinks(
          occurrences(prepared.node, INBOX_OF, "/0", prepared),
          prepared,
        ),
        deliveryController: controlLinks(
          occurrences(
            prepared.node,
            F799 + "deliveryController",
            "/0",
            prepared,
          ),
          prepared,
        ),
        raw: prepared.raw,
        expanded: prepared.expanded,
      },
      warnings: prepared.warnings,
    });
  } catch (error) {
    return failure(error);
  }
}
