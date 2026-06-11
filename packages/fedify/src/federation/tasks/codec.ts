import { Link, Object as APObject } from "@fedify/vocab";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { parse, stringifyAsync } from "devalue";
import type { TaskCodecLoaders } from "./codec-fn.ts";

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

  // The explicit return type breaks the inference cycle between #revive and
  // #classRevivers (whose `set` callbacks call back into #revive).
  //
  // Every node walked here belongs to the throwaway tree that devalue's
  // `parse` just built from the wire string, not to any caller-shared graph,
  // so the revived containers are always fresh: there is nothing to clone
  // lazily and no external identity to preserve.  A recursion-depth cap is
  // likewise unnecessary: this pass recurses with `await`, which unwinds the
  // synchronous stack at each level, and the binding limit on nesting is
  // devalue's own synchronous, recursive `stringify`/`parse`, which would
  // overflow long before this pass — capping depth here would add nothing.
  #revive = (seen: Seen): Revive => async (node: unknown): Promise<unknown> => {
    if (node === null || typeof node !== "object") return node;
    if (seen.has(node)) return seen.get(node);
    // The class filters are mutually exclusive, so find the single matching
    // reviver instead of running all of them against every node.
    const reviver = this.#classRevivers.find(([filter]) => filter(node));
    // Date / URL / RegExp and the like — devalue already handled them.
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

/**
 * One row of {@link TaskCodec.#classRevivers}: a type guard, a factory
 * that makes the empty revived container, and a filler that walks the source
 * into it using the supplied per-node {@link Revive}.  `#reviveByClass`
 * cannot annotate its parameter as `typeof this.#classRevivers[number]`
 * because a `typeof` query on a private field does not parse, so this loose
 * structural shape stands in; the `init` and `set` calls are reconciled with
 * `@ts-ignore` at the call site.
 */
type ClassReviver = readonly [
  (value: unknown) => boolean,
  (node: never) => unknown,
  (revive: Revive, node: never, out: never) => Promise<void>,
];

type Container =
  | VocabHolder
  | Map<unknown, unknown>
  | Set<unknown>
  | Array<unknown>
  | Record<string, unknown>;
type Revived = Exclude<Container, VocabHolder> | APObject | Link;
// deno-lint-ignore no-explicit-any
type Constructor<T> = new (...arg: any[]) => T;
