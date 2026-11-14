import type { PortableObjectVerifier } from "@fedify/vocab-runtime";

/**
 * Gets the default FEP-ef61 portable object verifier of a vocabulary object,
 * so that Fedify can pass it on to a clone of the object explicitly, since
 * `clone()` does not inherit it.
 *
 * This reads the protected `_verifyPortableObject` accessor of generated
 * vocabulary classes, which is an internal cross-package contract with
 * `@fedify/vocab-tools`.
 *
 * @param object The vocabulary object.
 * @returns The object's default verifier, or `undefined` if it has none.
 * @internal
 */
export function getDefaultPortableObjectVerifier(
  object: object,
): PortableObjectVerifier | undefined {
  const verifier: unknown = Reflect.get(object, "_verifyPortableObject");
  return typeof verifier === "function"
    ? verifier as PortableObjectVerifier
    : undefined;
}
