import type { DocumentLoader } from "@fedify/vocab-runtime";
import { normalizeAttachmentArrays as normalize } from "./outgoing-jsonld.ts";

/**
 * Applies the shared attachment workaround to served documents without
 * rewriting any document that contains a semantic proof or LD signature.
 * RDF equivalence alone cannot preserve JCS signatures.
 * @internal
 */
export function normalizeAttachmentArrays(
  document: unknown,
  contextLoader?: DocumentLoader,
): Promise<unknown> {
  return normalize(document, contextLoader, { preserveSecuredDocuments: true });
}
