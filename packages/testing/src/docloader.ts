import type { DocumentLoader } from "@fedify/vocab-runtime";

// oxlint-disable-next-line eslint/require-await
export const mockDocumentLoader: DocumentLoader = async (url: string) => ({
  contextUrl: null,
  document: {},
  documentUrl: url,
});
