/**
 * Serializes custom-task payloads with [devalue], bridging Activity
 * Vocabulary objects (`Note`, `Create`, `Person`, `Link`, and so on) through
 * JSON-LD.
 *
 * Vocabulary objects keep their state in private fields, so devalue cannot
 * serialize them directly.  devalue's custom-type hook (a reducer on encode,
 * a reviver on decode) carries each object as JSON-LD without writing a
 * marker into the payload.  Encoding uses the *expand* JSON-LD form, which
 * has no `@context`, so decoding dereferences nothing and never touches the
 * network.
 *
 * [devalue]: https://github.com/sveltejs/devalue
 *
 * @module
 */
import { Link, Object as APObject } from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { TracerProvider } from "@opentelemetry/api";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { parse, stringifyAsync } from "devalue";

/** Which `fromJsonLd` entry point rebuilds a given vocabulary object. */
type VocabKind = "object" | "link";

/** A vocabulary object reduced to its wire form: a kind tag plus JSON-LD. */
interface VocabWire {
  readonly kind: VocabKind;
  readonly jsonLd: unknown;
}

/**
 * The loaders a worker {@link Context} already exposes; both decode passes
 * use them.
 * @internal
 */
export interface TaskCodecLoaders {
  readonly contextLoader?: DocumentLoader;
  readonly documentLoader?: DocumentLoader;
  readonly tracerProvider?: TracerProvider;
  readonly baseUrl?: URL;
}

const isVocab = (value: unknown): value is APObject | Link =>
  value instanceof APObject || value instanceof Link;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value === null || typeof value !== "object"
    ? false
    : globalThis.Object.getPrototypeOf(value) ===
      globalThis.Object.prototype;

/** Reduce a vocabulary object to expanded JSON-LD (no `@context`). */
const vocabToJsonLd = async (
  value: APObject | Link,
  contextLoader: DocumentLoader,
): Promise<VocabWire> => ({
  kind: value instanceof Link ? "link" : "object",
  jsonLd: await value.toJsonLd({ format: "expand", contextLoader }),
});

/** Rebuild a vocabulary object from its wire form. */
const vocabFromJsonLd = (
  { kind, jsonLd }: VocabWire,
  loaders: TaskCodecLoaders,
): Promise<APObject | Link> =>
  kind === "link"
    ? Link.fromJsonLd(jsonLd, loaders)
    : APObject.fromJsonLd(jsonLd, loaders);

/**
 * Encodes a task payload to a devalue string.
 *
 * The reducer is deliberately a plain function, not an `async` one:
 * `stringifyAsync` treats a truthy return as a match and awaits it.  An
 * `async` reducer would return a promise for *every* node, which is always
 * truthy, so it would "match" non-vocab values too.  The plain
 * `isVocab(v) && …` form returns a synchronous `false` for non-vocab nodes
 * and the `toJsonLd()` promise only for vocab ones.
 *
 * @internal
 */
export const serializeTaskData = (
  data: unknown,
  contextLoader: DocumentLoader,
): Promise<string> =>
  stringifyAsync(data, {
    Vocab: (value: unknown) =>
      isVocab(value) && vocabToJsonLd(value, contextLoader),
  });

/**
 * A vocabulary object parked by the synchronous decode reviver, held until
 * the async {@link reviveVocab} pass can `fromJsonLd()` it back into an
 * instance.
 */
class VocabHolder implements VocabWire {
  constructor(readonly kind: VocabKind, readonly jsonLd: unknown) {}
  static from = ({ kind, jsonLd }: VocabWire) => new VocabHolder(kind, jsonLd);
}

/**
 * Second decode pass: replace every parked holder with a real instance.
 *
 * devalue preserves circular and repeated references, so the walker keeps
 * a `seen` map from each visited container to its revived counterpart.
 * Containers are registered *before* their contents are walked; a cycle
 * therefore resolves to the (still-filling) revived container instead of
 * recursing forever, and a repeated reference revives to the same instance.
 */
function reviveVocab(
  loaders: TaskCodecLoaders,
): (node: unknown) => Promise<unknown> {
  const seen = new Map<object, unknown>();
  return async function inner(node: unknown): Promise<unknown> {
    if (node === null || typeof node !== "object") return node;
    if (seen.has(node)) return seen.get(node);
    if (node instanceof VocabHolder) {
      const revived = await vocabFromJsonLd(node, loaders);
      seen.set(node, revived);
      return revived;
    }
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      seen.set(node, out);
      out.push(...await Array.fromAsync(node, inner));
      return out;
    }
    if (node instanceof Map) {
      const out = new Map();
      seen.set(node, out);
      for (const [k, v] of node) out.set(await inner(k), await inner(v));
      return out;
    }
    if (node instanceof Set) {
      const out = new Set<unknown>();
      seen.set(node, out);
      for (const v of await Array.fromAsync(node, inner)) out.add(v);
      return out;
    }
    if (isPlainObject(node)) {
      const out: Record<string, unknown> = {};
      seen.set(node, out);
      for (const [k, v] of globalThis.Object.entries(node)) {
        out[k] = await inner(v);
      }
      return out;
    }
    return node; // Date / URL / RegExp and the like — devalue handled them
  };
}

/**
 * Decodes a devalue string back to a task payload.
 *
 * Two passes are unavoidable: `parse` revivers are synchronous while
 * `fromJsonLd()` is async.  The reviver only parks each object;
 * {@link reviveVocab} then walks the result and awaits `fromJsonLd()`.
 *
 * @internal
 */
export const deserializeTaskData = (
  raw: string,
  loaders: TaskCodecLoaders,
): Promise<unknown> =>
  reviveVocab(loaders)(
    parse(raw, {
      Vocab: ({ kind, jsonLd }: VocabWire) => new VocabHolder(kind, jsonLd),
    }),
  );

/**
 * Validates `data` through the vendor-agnostic
 * [Standard Schema](https://standardschema.dev/) interface.
 * @internal
 */
export const validateTaskData = async <S extends StandardSchemaV1>(
  schema: S,
  data: unknown,
): Promise<StandardSchemaV1.InferOutput<S>> => {
  const result = await schema["~standard"].validate(data);
  if (result.issues) {
    throw new TypeError(
      `Task data failed schema validation: ${JSON.stringify(result.issues)}`,
    );
  }
  return result.value;
};
