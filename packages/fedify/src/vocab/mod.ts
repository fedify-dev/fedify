/**
 * A set of type-safe object mappings for the [Activity
 * Vocabulary](https://www.w3.org/TR/activitystreams-vocabulary/).
 *
 * Each class in this module represents a type of object in the Activity
 * Vocabulary.  For example, the {@link Note} class represents the
 * [`Note` type](https://www.w3.org/TR/activitystreams-vocabulary/#dfn-note)
 * in the Activity Vocabulary.
 *
 * There are two ways to instantiate an object of a class in this module.
 * The first way is to use the constructor of the class.  For example:
 *
 * ``` typescript
 * const note = new Note({
 *   attributedTo: new URL("https://example.com/user"),
 *   content: "Hello, world!",
 * });
 * const create = new Create({
 *   actor: new URL("https://example.com/user"),
 *   object: note,
 * });
 * ```
 *
 * The second way is to deserialize an object from a JSON-LD document using
 * the `fromJsonLd()` method of the class.  For example:
 *
 * ``` typescript
 * const create = await Create.fromJsonLd({
 *   "@context": "https://www.w3.org/ns/activitystreams",
 *   "type": "Create",
 *   "actor": "https://example.com/user",
 *   "object": {
 *     "type": "Note",
 *     "attributedTo": "https://example.com/user",
 *     "content": "Hello, world!",
 *   },
 * });
 * ```
 *
 * In order to serialize an object to a JSON-LD document, use the `toJsonLd()`
 * method of the object.  For example:
 *
 * ``` typescript
 * const jsonLd = await create.toJsonLd();
 * ```
 *
 * Note that both `fromJsonLd()` and `toJsonLd()` are asynchronous methods
 * that return a `Promise`.
 *
 * @module
 */
export * from "./actor.ts";
export * from "./constants.ts";
export * from "./handle.ts";
export * from "./lookup.ts";
export * from "./type.ts";
