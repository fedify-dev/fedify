import type { DocumentLoader } from "@fedify/fedify/runtime";

// deno-lint-ignore require-await
export const mockDocumentLoader: DocumentLoader = async (url: string) => ({
  contextUrl: null,
  document: {},
  documentUrl: url,
});
