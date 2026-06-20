import { Link, Object as APObject } from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { TracerProvider } from "@opentelemetry/api";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { parse, stringifyAsync } from "devalue";

/**
 * Serializes and deserializes task payloads for the queue, preserving
 * `@fedify/vocab` objects across the wire by reducing them to JSON-LD and
 * rebuilding them on the worker with the bound {@link TaskCodecLoaders}.
 * @internal
 */
export default class TaskCodec {
  constructor(readonly options: TaskCodecLoaders) {}

  /** Serializes `data`, encoding any vocabulary object as its JSON-LD. */
  serialize = (data: unknown): Promise<string> =>
    stringifyAsync(data, { Vocab: this.#stringifyVocab });

  deserialize = async (raw: string): Promise<unknown> =>
    await this.#revive(new Map())(parse(raw, { Vocab: VocabHolder.from }));

  /** Validates `data` against `schema`, then serializes it. */
  encode = async <S extends StandardSchemaV1>(
    schema: S,
    data: StandardSchemaV1.InferInput<S>,
  ): Promise<string> => this.serialize(await TaskCodec.validate(schema, data));

  /** Deserializes `raw`, then validates the result against `schema`. */
  decode = async <S extends StandardSchemaV1>(
    schema: S,
    raw: string,
  ): Promise<StandardSchemaV1.InferOutput<S>> =>
    TaskCodec.validate(schema, await this.deserialize(raw));

  /**
   * Validates an already-deserialized `data` against `schema`.  An instance
   * wrapper over {@link TaskCodec.validate} so the dispatch site can split
   * {@link decode} into its deserialize and validate phases—telling a
   * deserialization failure apart from a validation failure—without importing
   * the class.
   */
  validate = <S extends StandardSchemaV1>(
    schema: S,
    data: unknown,
  ): Promise<StandardSchemaV1.InferOutput<S>> =>
    TaskCodec.validate(schema, data);

  static validate = async <S extends StandardSchemaV1>(
    schema: S,
    data: unknown,
  ): Promise<StandardSchemaV1.InferOutput<S>> =>
    getValueIfSchema(await schema["~standard"].validate(data));

  #stringifyVocab = (value: unknown) => isVocab(value) && this.#toWire(value);

  #toWire = async (value: APObject | Link): Promise<VocabWire> => ({
    kind: value instanceof Link ? "link" : "object",
    jsonLd: await value.toJsonLd({ format: "expand", ...this.options }),
  });

  #revive = (seen: Seen): Revive => {
    const inner: Revive = async (node) => {
      if (node === null || typeof node !== "object") return node;
      if (seen.has(node)) return seen.get(node);
      for (const reviver of this.#classRevivers) {
        const out = reviver(seen, inner, node);
        if (out !== undefined) return await out;
      }
      // devalue can handle non-container objects.
      return node;
    };
    return inner;
  };

  #classRevivers: readonly ClassReviver[] = [
    classReviver(
      isInstanceOf(VocabHolder),
      ({ kind, jsonLd }): Promise<APObject | Link> =>
        kind === "link"
          ? Link.fromJsonLd(jsonLd, this.options)
          : APObject.fromJsonLd(jsonLd, this.options),
      () => {},
    ),
    classReviver(
      isInstanceOf(Array),
      (): unknown[] => [],
      async (revive, node, arr) => {
        for (const item of await Array.fromAsync(node, revive)) arr.push(item);
      },
    ),
    classReviver(
      isInstanceOf(Map),
      () => new Map<unknown, unknown>(),
      async (revive, node, map) => {
        for (const [k, v] of node) map.set(await revive(k), await revive(v));
      },
    ),
    classReviver(
      isInstanceOf(Set),
      () => new Set<unknown>(),
      async (revive, node, set) => {
        for (const v of await Array.fromAsync(node, revive)) set.add(v);
      },
    ),
    classReviver(
      isPlainObject,
      (): Record<string, unknown> => ({}),
      async (revive, node, obj) => {
        for (const [k, v] of globalThis.Object.entries(node)) {
          obj[k] = await revive(v);
        }
      },
    ),
  ];
}

const isVocab = (value: unknown): value is APObject | Link =>
  value instanceof APObject || value instanceof Link;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value === null || typeof value !== "object"
    ? false
    : isObjectPrototype(globalThis.Object.getPrototypeOf(value));

const isObjectPrototype = (proto: unknown): boolean =>
  proto === null || proto === globalThis.Object.prototype;

const isInstanceOf = <T>(cls: Constructor<T>) => (v: unknown): v is T =>
  v instanceof cls;

function getValueIfSchema(result: StandardSchemaV1.Result<unknown>) {
  assertSchema(result);
  return result.value;
}

function assertSchema(
  result: StandardSchemaV1.Result<unknown>,
): asserts result is StandardSchemaV1.SuccessResult<unknown> {
  if (result.issues && result.issues.length > 0) {
    throw new TypeError(
      `Task data failed schema validation: ${JSON.stringify(result.issues)}`,
    );
  }
}

/**
 * The loaders a worker {@link Context} already exposes; both decode passes
 * use them.
 * @internal
 */
interface TaskCodecLoaders {
  readonly contextLoader?: DocumentLoader;
  readonly documentLoader?: DocumentLoader;
  readonly tracerProvider?: TracerProvider;
  readonly baseUrl?: URL;
}

/** Which `fromJsonLd` entry point rebuilds a given vocabulary object. */
type VocabKind = "object" | "link";

/** A vocabulary object reduced to its wire form: a kind tag plus JSON-LD. */
interface VocabWire {
  readonly kind: VocabKind;
  readonly jsonLd: unknown;
}

/**
 * A vocabulary object parked by the synchronous decode reviver, held until
 * the async revive pass can `fromJsonLd()` it back into an instance.
 */
class VocabHolder implements VocabWire {
  constructor(readonly kind: VocabKind, readonly jsonLd: unknown) {}
  static from = ({ kind, jsonLd }: VocabWire) => new VocabHolder(kind, jsonLd);
}

/** Per-decode map from each visited container to its revived counterpart. */
type Seen = Map<object, unknown>;

/** Revives one node, sharing the per-decode {@link Seen} map via closure. */
type Revive = (node: unknown) => Promise<unknown>;

/** Revives one matched container, or `undefined` when the node isn't its kind. */
type ClassReviver = (
  seen: Seen,
  revive: Revive,
  node: object,
) => Promise<unknown> | undefined;

/**
 * Ties a container filter to its empty-shell `init` and child-filling `set`
 * through one type parameter—a correlation the heterogeneous reviver list
 * cannot carry, which previously forced `@ts-ignore` at the dispatch site.
 */
const classReviver = <TNode extends object, TOut>(
  filter: (v: unknown) => v is TNode,
  init: (node: TNode) => TOut | Promise<TOut>,
  set: (revive: Revive, node: TNode, out: TOut) => void | Promise<void>,
): ClassReviver =>
(seen, revive, node) => {
  if (!filter(node)) return undefined;
  return (async () => {
    const out = await init(node);
    seen.set(node, out);
    await set(revive, node, out);
    return out;
  })();
};

// deno-lint-ignore no-explicit-any
type Constructor<T> = new (...arg: any[]) => T;
