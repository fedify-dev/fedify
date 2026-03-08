import { kvCache } from "@fedify/fedify";
import {
  type DocumentLoader,
  getDocumentLoader as getDefaultDocumentLoader,
} from "@fedify/vocab-runtime";
import { getKvStore } from "#kv";

const documentLoaders: Record<string, DocumentLoader> = {};

export interface DocumentLoaderOptions {
  userAgent?: string;
  allowPrivateAddress?: boolean;
}

export async function getDocumentLoader(
  { userAgent, allowPrivateAddress = true }: DocumentLoaderOptions = {},
): Promise<DocumentLoader> {
  const cacheKey = `${userAgent ?? ""}:${allowPrivateAddress}`;
  if (documentLoaders[cacheKey]) return documentLoaders[cacheKey];
  const kv = await getKvStore();
  return documentLoaders[cacheKey] = kvCache({
    kv,
    rules: [
      [
        new URLPattern({
          protocol: "http{s}?",
          hostname: "localhost",
          port: "*",
          pathname: "/*",
          search: "*",
          hash: "*",
        }),
        { seconds: 0 },
      ],
      [
        new URLPattern({
          protocol: "http{s}?",
          hostname: "127.0.0.1",
          port: "*",
          pathname: "/*",
          search: "*",
          hash: "*",
        }),
        { seconds: 0 },
      ],
      [
        new URLPattern({
          protocol: "http{s}?",
          hostname: "\\[\\:\\:1\\]",
          port: "*",
          pathname: "/*",
          search: "*",
          hash: "*",
        }),
        { seconds: 0 },
      ],
    ],
    loader: getDefaultDocumentLoader({
      allowPrivateAddress,
      userAgent,
    }),
  });
}

export function getContextLoader(
  options: DocumentLoaderOptions = {},
): Promise<DocumentLoader> {
  return getDocumentLoader(options);
}
