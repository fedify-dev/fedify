import { Link, Object as APObject } from "@fedify/vocab";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { TracerProvider } from "@opentelemetry/api";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { parse, stringifyAsync } from "devalue";

export default class TaskCodec {
  constructor(readonly options: TaskCodecLoaders) {}

  serialize = (data: unknown): Promise<string> =>
    stringifyAsync(data, { Vocab: this.#stringifyVocab });

  deserialize = (raw: string): Promise<unknown> =>
    this.#revive(new Map())(parse(raw, { Vocab: VocabHolder.from }));

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

  #revive = (seen: Seen): Revive => async (node: unknown): Promise<unknown> => {
    if (node === null || typeof node !== "object") return node;
    if (seen.has(node)) return seen.get(node);
    const reviver = this.#classRevivers.find(([filter]) => filter(node));
    // devalue can handle non-container objects.
    if (reviver == null) return node;
    const [, init, set] = reviver;
    // @ts-ignore tsc faults
    const out: Revived = await init(node);
    seen.set(node, out);
    // @ts-ignore tsc faults
    await set(this.#revive(seen), node, out);
    return out;
  };

  #classRevivers = [
    [
      isInstanceOf(VocabHolder),
      ({ kind, jsonLd }: VocabWire): Promise<APObject | Link> =>
        kind === "link"
          ? Link.fromJsonLd(jsonLd, this.options)
          : APObject.fromJsonLd(jsonLd, this.options),
      () => Promise.resolve(),
    ],
    [
      isInstanceOf(Array),
      (): unknown[] => [],
      async (revive: Revive, node: unknown[], arr: typeof node) => {
        arr.push(...await Array.fromAsync(node, revive));
      },
    ],
    [
      isInstanceOf(Map),
      () => new Map(),
      async (revive: Revive, node: Map<unknown, unknown>, map: typeof node) => {
        for (const [k, v] of node) map.set(await revive(k), await revive(v));
      },
    ],
    [
      isInstanceOf(Set),
      () => new Set(),
      async (revive: Revive, node: Set<unknown>, set: typeof node) => {
        for (const v of await Array.fromAsync(node, revive)) set.add(v);
      },
    ],
    [
      isPlainObject,
      () => ({}),
      async (
        revive: Revive,
        node: Record<string, unknown>,
        obj: typeof node,
      ) => {
        for (const [k, v] of globalThis.Object.entries(node)) {
          obj[k] = await revive(v);
        }
      },
    ],
  ] as const;
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

type Container =
  | VocabHolder
  | Map<unknown, unknown>
  | Set<unknown>
  | Array<unknown>
  | Record<string, unknown>;
type Revived = Exclude<Container, VocabHolder> | APObject | Link;
// deno-lint-ignore no-explicit-any
type Constructor<T> = new (...arg: any[]) => T;
