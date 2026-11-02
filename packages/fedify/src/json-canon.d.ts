// json-canon ships no type declarations.  Deno treats the untyped npm module
// as `any`, but the Node.js-based type check reports it under noImplicitAny.
declare module "json-canon" {
  /**
   * Serializes a value as canonical JSON (RFC 8785, JSON Canonicalization
   * Scheme).
   * @param value The value to serialize.
   * @returns The canonical JSON text.
   */
  export default function serialize(value: unknown): string;
}
