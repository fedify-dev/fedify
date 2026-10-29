import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  deepStrictEqual,
  notStrictEqual,
  ok,
  strictEqual,
  throws,
} from "node:assert/strict";
import { Create, Note, Translation } from "./vocab.ts";

const sparseLength = 8192;

test("sparse scalar copies preserve own indices and omit metadata", () => {
  const names = new Array<string>(sparseLength);
  globalThis.Object.defineProperty(names, 2, { value: "hidden" });
  names[6000] = "visible";
  globalThis.Object.assign(names, {
    "01": "metadata",
    "-1": "metadata",
    "4294967295": "metadata",
    extra: "metadata",
    [Symbol("metadata")]: "metadata",
  });
  const before = globalThis.Object.getOwnPropertyDescriptors(names);
  const source = new Note({ names });
  for (const copy of [source, source.clone(), source.deepClone()]) {
    strictEqual(copy.names.length, sparseLength);
    deepStrictEqual(Reflect.ownKeys(copy.names), ["2", "6000", "length"]);
    deepStrictEqual(globalThis.Object.getOwnPropertyDescriptor(copy.names, 2), {
      value: "hidden",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    strictEqual(copy.names[6000], "visible");
    strictEqual(0 in copy.names, false);
    strictEqual((sparseLength - 1) in copy.names, false);
    notStrictEqual(copy.names, names);
  }
  deepStrictEqual(globalThis.Object.getOwnPropertyDescriptors(names), before);
});

test("sparse copies preserve empty and trailing-hole arrays", () => {
  for (const index of [undefined, 0, sparseLength - 1]) {
    const names = new Array<string>(sparseLength);
    if (index != null) names[index] = "kept";
    const source = new Note({ names });
    for (const copy of [source, source.clone(), source.deepClone()]) {
      strictEqual(copy.names.length, sparseLength);
      deepStrictEqual(
        globalThis.Object.getOwnPropertyNames(copy.names),
        index == null ? ["length"] : [String(index), "length"],
      );
    }
  }
});

test("sparse inputs distinguish holes from explicit undefined", () => {
  const names = new Array<string>(sparseLength);
  new Note({ names });
  globalThis.Object.defineProperty(names, 100, { value: undefined });
  throws(() => new Note({ names }), TypeError);
  throws(() => new Note({}).clone({ names }), TypeError);
});

test("sparse URL copies preserve aliases and isolate mutable leaves", () => {
  const url = new URL("https://example.com/license");
  const licenses = new Array<URL>(sparseLength);
  licenses[0] = licenses[6000] = url;
  globalThis.Object.freeze(licenses);
  const source = new Note({ licenses });
  const shallow = source.clone();
  const deep = source.deepClone();
  const replaced = new Note({}).deepClone({ licenses });
  for (const copy of [source, shallow, deep, replaced]) {
    strictEqual(copy.licenses.length, sparseLength);
    deepStrictEqual(globalThis.Object.keys(copy.licenses), ["0", "6000"]);
    notStrictEqual(copy.licenses, licenses);
    strictEqual(copy.licenses[0], copy.licenses[6000]);
    copy.licenses[1] = new URL("https://example.com/copy-only");
  }
  strictEqual(shallow.licenses[0], url);
  notStrictEqual(deep.licenses[0], url);
  notStrictEqual(replaced.licenses[0], url);
  deep.licenses[0].pathname = "/deep-only";
  strictEqual(url.pathname, "/license");
  strictEqual(replaced.licenses[0].pathname, "/license");
  strictEqual(1 in licenses, false);
});

test("sparse non-entity arrays deep-copy aliases and nested URLs", () => {
  const url = new URL("https://example.com/original");
  const translation = new Translation({ original: url, basis: url });
  const translations = new Array<Translation>(sparseLength);
  globalThis.Object.defineProperty(translations, 0, { value: translation });
  translations[6000] = translation;
  const source = new Note({ translations });
  const shallow = source.clone();
  const copy = source.deepClone();
  const replacement = source.deepClone({ translations });
  strictEqual(shallow.translations[0], translation);
  for (const deep of [copy, replacement]) {
    strictEqual(deep.translations.length, sparseLength);
    deepStrictEqual(globalThis.Object.keys(deep.translations), ["0", "6000"]);
    strictEqual(deep.translations[0], deep.translations[6000]);
    notStrictEqual(deep.translations[0], translation);
    strictEqual(deep.translations[0].original, deep.translations[0].basis);
    notStrictEqual(deep.translations[0].original, url);
  }
  copy.translations[0].original!.pathname = "/copy-only";
  strictEqual(url.pathname, "/original");
  strictEqual(replacement.translations[0].original!.pathname, "/original");
  copy.translations.length = 1;
  strictEqual(source.translations.length, sparseLength);
});

test("sparse object arrays copy embedded graphs without fetching holes", async () => {
  const child = new Note({ content: "child" });
  const objects = new Array<Note>(sparseLength);
  objects[0] = child;
  objects[6000] = child;
  const source = new Create({ objects, attachments: [child] });
  const shallow = source.clone();
  const copy = source.deepClone();
  const copiedChild = await copy.getObject();
  ok(copiedChild instanceof Note);
  notStrictEqual(copiedChild, child);
  strictEqual(await shallow.getObject(), child);
  strictEqual((await Array.fromAsync(copy.getAttachments()))[0], copiedChild);
  // Only inspect the first two positions: accessor traversal is unchanged.
  const iterator = copy.getObjects()[Symbol.asyncIterator]();
  strictEqual((await iterator.next()).value, copiedChild);
  strictEqual((await iterator.next()).value, undefined);
  await iterator.return?.();
});

test("exposed scalar arrays recheck accessors, prototypes, and freezing", () => {
  const source = new Note({ names: new Array<string>(sparseLength) });
  let reads = 0;
  globalThis.Object.defineProperty(source.names, 2, {
    get() {
      reads++;
      return "getter";
    },
    configurable: true,
  });
  const accessorCopy = source.clone();
  strictEqual(accessorCopy.names[2], "getter");
  strictEqual(reads, 1);
  globalThis.Object.defineProperty(source.names, 2, {
    value: "own",
    writable: true,
    configurable: true,
  });
  const prototype = globalThis.Object.create(Array.prototype, {
    1: { get: () => "inherited", configurable: true },
  });
  globalThis.Object.setPrototypeOf(source.names, prototype);
  const inheritedCopy = source.clone();
  strictEqual(inheritedCopy.names[1], "inherited");
  strictEqual(globalThis.Object.hasOwn(inheritedCopy.names, 1), true);
  globalThis.Object.setPrototypeOf(source.names, Array.prototype);
  globalThis.Object.freeze(source.names);
  const frozenCopy = source.deepClone();
  frozenCopy.names[2] = "changed";
  strictEqual(source.names[2], "own");
});

test("source shallow copies retain scalar getter mutations", () => {
  const source = new Note({ names: new Array<string>(sparseLength) });
  globalThis.Object.defineProperty(source.names, 2, { get: () => 123 });
  strictEqual(source.clone().names[2], 123);
  strictEqual(source.deepClone().names[2], 123);
  throws(() => new Note({ names: source.names }), TypeError);
});

test("array subclasses, species, and own methods retain native fallback", () => {
  class Names extends Array<string> {
    static override get [Symbol.species](): ArrayConstructor {
      return Array;
    }
  }
  const names = new Names(sparseLength);
  names[2] = "kept";
  const source = new Note({ names });
  strictEqual(globalThis.Object.getPrototypeOf(source.names), Array.prototype);
  strictEqual(source.names[2], "kept");
  strictEqual(source.names.length, sparseLength);

  let everyCalls = 0;
  let sliceCalls = 0;
  const custom = new Array<string>(sparseLength);
  custom[2] = "kept";
  globalThis.Object.defineProperty(custom, "every", {
    value(
      this: string[],
      callback: (value: string, index: number, array: string[]) => unknown,
      thisArg?: unknown,
    ): boolean {
      everyCalls++;
      return Array.prototype.every.call(this, callback, thisArg);
    },
    configurable: true,
    writable: true,
  });
  custom.slice = function (start, end) {
    sliceCalls++;
    return Array.prototype.slice.call(this, start, end);
  };
  strictEqual(new Note({ names: custom }).names[2], "kept");
  strictEqual(everyCalls, 1);
  strictEqual(sliceCalls, 1);
});

test("sparse validation rejects invalid keys injected by element proxies", () => {
  for (const replace of [false, true]) {
    const licenses = new Array<URL>(sparseLength);
    licenses[0] = new Proxy(new URL("https://example.com/license"), {
      getPrototypeOf(target) {
        licenses[6000] = 123 as unknown as URL;
        return Reflect.getPrototypeOf(target);
      },
    });
    throws(
      () => replace ? new Note({}).clone({ licenses }) : new Note({ licenses }),
      TypeError,
    );
  }
});

test("sparse validation rejects keys injected by Symbol.hasInstance", () => {
  const translations = new Array<Translation>(sparseLength);
  translations[0] = new Translation({});
  const previous = globalThis.Object.getOwnPropertyDescriptor(
    Translation,
    Symbol.hasInstance,
  );
  // The hook is synchronous and restored before another test can run.
  globalThis.Object.defineProperty(Translation, Symbol.hasInstance, {
    configurable: true,
    value(value: unknown) {
      translations[6000] = 123 as unknown as Translation;
      return Function.prototype[Symbol.hasInstance].call(Translation, value);
    },
  });
  try {
    throws(() => new Note({ translations }), TypeError);
  } finally {
    if (previous == null) {
      Reflect.deleteProperty(Translation, Symbol.hasInstance);
    } else {
      globalThis.Object.defineProperty(
        Translation,
        Symbol.hasInstance,
        previous,
      );
    }
  }
});

test("sparse validation rechecks inputs that switch to native copying", () => {
  for (const transition of ["density", "accessor"] as const) {
    const licenses = new Array<URL>(sparseLength);
    const url = new URL("https://example.com/license");
    licenses[0] = new Proxy(url, {
      getPrototypeOf(target) {
        if (transition === "density") {
          licenses.fill(url, 1, sparseLength / 2 + 1);
          licenses[6000] = 123 as unknown as URL;
        } else {
          globalThis.Object.defineProperty(licenses, 6000, {
            get: () => 123,
            configurable: true,
          });
        }
        return Reflect.getPrototypeOf(target);
      },
    });
    throws(() => new Note({ licenses }), TypeError);
  }
});

test("sparse copying omits invalid keys injected after its snapshot", () => {
  const licenses = new Array<URL>(sparseLength);
  let checks = 0;
  licenses[0] = new Proxy(new URL("https://example.com/license"), {
    getPrototypeOf(target) {
      if (++checks === 2) licenses[6000] = 123 as unknown as URL;
      return Reflect.getPrototypeOf(target);
    },
  });
  const source = new Note({ licenses });
  strictEqual(licenses[6000], 123);
  strictEqual(6000 in source.licenses, false);
  strictEqual(source.licenses[0], licenses[0]);
});

test("sparse validation propagates element reflection errors", () => {
  const failure = new Error("element reflection failed");
  const licenses = new Array<URL>(sparseLength);
  licenses[0] = new Proxy(new URL("https://example.com/license"), {
    getPrototypeOf() {
      throw failure;
    },
  });
  throws(() => new Note({ licenses }), (error) => error === failure);
});

test("sparse deep traversal snapshots keys and reads later current values", () => {
  let destination: Note | undefined;
  const added = new Translation({
    original: new URL("https://example.com/new"),
  });
  const updated = new Translation({
    original: new URL("https://example.com/updated"),
  });
  class CapturesCopy extends Note {
    override clone(): Note {
      return destination = super.clone();
    }
  }
  class ChangesLaterEntries extends Translation {
    override clone(): Translation {
      destination!.translations[100] = added;
      delete destination!.translations[6000];
      destination!.translations[7000] = updated;
      return super.clone();
    }
  }
  const translations = new Array<Translation>(sparseLength);
  translations[0] = new ChangesLaterEntries({});
  translations[6000] = new Translation({});
  translations[7000] = new Translation({});
  const source = new CapturesCopy({ translations });
  const copy = source.deepClone();
  strictEqual(copy.translations.length, sparseLength);
  strictEqual(copy.translations[100], added);
  strictEqual(6000 in copy.translations, false);
  notStrictEqual(copy.translations[7000], updated);
  notStrictEqual(copy.translations[7000].original, updated.original);
  strictEqual(copy.translations[7000].original!.href, updated.original!.href);
  strictEqual(100 in source.translations, false);
  strictEqual(source.translations[6000], translations[6000]);
  strictEqual(source.translations[7000], translations[7000]);
});

test("plural getters establish trust for the array actually stored", async () => {
  let reads = 0;
  const first = new Array<Note>(2);
  const stored = new Array<Note>(3);
  stored[2] = new Note({ content: "stored" });
  const source = new Create({
    get objects() {
      reads++;
      return reads < 4 ? first : stored;
    },
  });
  strictEqual(reads, 4);
  for (const copy of [source, source.clone(), source.deepClone()]) {
    const values = await Array.fromAsync(copy.getObjects());
    strictEqual(values.length, 3);
    strictEqual(values[0], undefined);
    strictEqual(values[1], undefined);
    strictEqual(values[2].content, "stored");
  }
  strictEqual(reads, 4);
});

test("small sparse object replacements retain trusted holes", async () => {
  const child = new Note({ content: "trusted" });
  const objects = new Array<Note>(3);
  objects[1] = child;
  const source = new Create({ objects });
  for (
    const copy of [
      source,
      source.clone(),
      source.clone({ objects }),
      source.deepClone({ objects }),
    ]
  ) {
    const values = await Array.fromAsync(copy.getObjects());
    deepStrictEqual(values.map((value) => value?.content), [
      undefined,
      "trusted",
      undefined,
    ]);
  }
  deepStrictEqual(
    await Array.fromAsync(source.clone({ object: child }).getObjects()),
    [child],
  );
  deepStrictEqual(
    await Array.fromAsync(source.clone({ objects: [] }).getObjects()),
    [],
  );
});

test("decoded and warmed object trust stays local across clones", async () => {
  let fetches = 0;
  const original = await Create.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://a.example/create",
    type: "Create",
    object: {
      id: "https://b.example/note",
      type: "Note",
      content: "embedded",
    },
  }, { contextLoader: mockDocumentLoader });
  // deno-lint-ignore require-await
  const documentLoader = async (url: string) => {
    fetches++;
    return {
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: url,
        type: "Note",
        content: "fetched",
      },
    };
  };
  const options = { documentLoader, contextLoader: mockDocumentLoader };
  const cold = original.clone();
  const fetched = await original.getObject(options);
  strictEqual(fetched?.content, "fetched");
  const warmed = original.clone();
  strictEqual(await warmed.getObject(options), fetched);
  strictEqual(fetches, 1);
  strictEqual((await cold.getObject(options))?.content, "fetched");
  strictEqual(fetches, 2);
  const replacement = new Note({
    id: new URL("https://c.example/note"),
    content: "replacement",
  });
  strictEqual(
    await warmed.clone({ objects: [replacement] }).getObject(options),
    replacement,
  );
  strictEqual(fetches, 2);
});

for (const defaultKind of ["singular", "plural"] as const) {
  test(`clone trust replaces ${defaultKind} subclass constructor defaults`, async () => {
    let enableDefaults = false;
    const defaultObject = new Note({
      id: new URL("https://c.example/default"),
      content: "constructor default",
    });
    class StatefulCreate extends Create {
      constructor(
        values: ConstructorParameters<typeof Create>[0],
        options: ConstructorParameters<typeof Create>[1] = {},
      ) {
        const defaults = enableDefaults && values.object == null &&
            values.objects == null
          ? defaultKind === "singular"
            ? { object: defaultObject }
            : { objects: [defaultObject] }
          : {};
        super({ ...defaults, ...values }, options);
      }
    }
    const original = await StatefulCreate.fromJsonLd({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://a.example/create",
      type: "Create",
      object: {
        id: "https://b.example/note",
        type: "Note",
        content: "untrusted embedded",
      },
    }, { contextLoader: mockDocumentLoader });
    ok(original instanceof StatefulCreate);
    enableDefaults = true;
    strictEqual(await new StatefulCreate({}).getObject(), defaultObject);
    const copies = [original, original.clone(), original.deepClone()];
    let fetches = 0;
    // deno-lint-ignore require-await
    const documentLoader = async (url: string) => {
      fetches++;
      return {
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: url,
          type: "Note",
          content: "fetched",
        },
      };
    };
    for (const copy of copies) {
      ok(copy instanceof StatefulCreate);
      strictEqual(
        (await copy.getObject({
          documentLoader,
          contextLoader: mockDocumentLoader,
        }))?.content,
        "fetched",
      );
    }
    strictEqual(fetches, 3);
  });
}
