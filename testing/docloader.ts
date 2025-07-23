import type { DocumentLoader } from "@fedify/fedify/runtime";

export const mockDocumentLoader: DocumentLoader = async (url: string) => ({
  contextUrl: null,
  document: {},
  documentUrl: url,
});
