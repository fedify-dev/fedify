import { getFieldName } from "./field.ts";
import type { PropertySchema, TypeSchema } from "./schema.ts";
import { getTypeName } from "./type.ts";

function needsCopy(
  property: PropertySchema,
  types: Record<string, TypeSchema>,
): boolean {
  return property.range.some((uri) =>
    uri in types || ["URL", "Uint8Array"].includes(getTypeName(uri, types))
  );
}

/** Emits module-private graph-copy support, shared by all generated classes. */
export function generateDeepCloneHelpers(): string {
  return `
interface DeepCloneContext {
  value<T>(value: T): T;
}

interface DeepCloneDescriptor {
  create(source: object): object;
  copy(destination: object, context: DeepCloneContext): void;
}

const deepCloneDescriptors = new Map<object, DeepCloneDescriptor>();

function getDeepCloneDescriptor(value: object): DeepCloneDescriptor | undefined {
  let prototype: object | null = globalThis.Object.getPrototypeOf(value);
  while (prototype != null) {
    const descriptor = deepCloneDescriptors.get(prototype);
    if (descriptor != null) return descriptor;
    prototype = globalThis.Object.getPrototypeOf(prototype);
  }
  return undefined;
}

function deepCloneGraph<T extends object>(source: object, root: T): T {
  const memo = new Map<object, object>();
  const destinations = new Set<object>();
  const shells: object[] = [];
  let next = 0;

  function enqueue(original: object, destination: object): void {
    if (destination == null || typeof destination !== "object" ||
        original === destination || destinations.has(destination) ||
        !globalThis.Object.prototype.isPrototypeOf.call(
          globalThis.Object.getPrototypeOf(original), destination
        ) || getDeepCloneDescriptor(destination) == null) {
      throw new TypeError("clone() must return a fresh, compatible instance.");
    }
    destinations.add(destination);
    shells.push(destination);
  }

  const context: DeepCloneContext = {
    value<V>(value: V): V {
      if (value == null || typeof value !== "object") return value;
      const existing = memo.get(value);
      if (existing != null) return existing as V;
      if (value instanceof URL) {
        const copy = new URL(value.href);
        memo.set(value, copy);
        return copy as V;
      }
      if (value instanceof Uint8Array) {
        const copy = new Uint8Array(value);
        memo.set(value, copy);
        return copy as V;
      }
      const descriptor = getDeepCloneDescriptor(value);
      // Other supported scalars (Temporal, LanguageString, Intl.Locale,
      // CryptoKey and class constructors) are shared as immutable values.
      if (descriptor == null) return value;
      const copy = descriptor.create(value);
      enqueue(value, copy);
      memo.set(value, copy);
      return copy as V;
    },
  };

  function drain(): void {
    while (next < shells.length) {
      const shell = shells[next++];
      getDeepCloneDescriptor(shell)!.copy(shell, context);
    }
  }

  // The effective root includes replacements. References to the source root
  // instead receive a separate copy of its pre-update values.
  enqueue(source, root);
  drain();

  // Discover historical root ancestry without substituting replacement values
  // into it. The resolver deliberately returns undefined in this first pass.
  const count = shells.length;
  for (let i = 0; i < count; i++) {
    retargetPortableReferrer(shells[i], (original) => {
      if (original === source) context.value(source);
      return undefined;
    });
  }
  drain();
  for (const shell of shells) {
    retargetPortableReferrer(shell, (original) => memo.get(original));
  }
  return root;
}
`;
}

/** Emits private-field copiers inside static blocks, keeping them out of d.ts. */
export async function* generateDeepCloneDescriptor(
  typeUri: string,
  types: Record<string, TypeSchema>,
): AsyncIterable<string> {
  const type = types[typeUri];
  const properties = type.properties.filter((p) => needsCopy(p, types));
  if (type.extends != null && properties.length < 1) return;
  yield `static {\n`;
  if (type.extends == null) {
    yield `deepCloneDescriptors.set(this.prototype, {
      create(value: object): object {
        const source = value as ${type.name};
        const options = {
          documentLoader: source.#documentLoader,
          contextLoader: source.#contextLoader,
          tracerProvider: source.#tracerProvider,
          verifyPortableObject: source.#verifyPortableObject,
          baseUrl: source.#_baseUrl,
        };
        return source.clone({}, options);
      },
      copy(value: object, context: DeepCloneContext): void {
        const node = value as ${type.name};
        const identified = node as { id: URL | null };
        identified.id = context.value(identified.id);
    `;
  } else {
    yield `const base = getDeepCloneDescriptor(this.prototype)!;
      deepCloneDescriptors.set(this.prototype, {
        create: base.create,
        copy(value: object, context: DeepCloneContext): void {
          base.copy(value, context);
          const node = value as ${type.name};
    `;
  }
  for (const property of properties) {
    const field = await getFieldName(property.uri);
    yield `
      for (let i = 0; i < node.${field}.length; i++) {
        const value = node.${field}[i];
        if (value != null && typeof value === "object") {
          node.${field}[i] = context.value(value);
        }
      }
    `;
  }
  yield `} }); }\n`;
}
