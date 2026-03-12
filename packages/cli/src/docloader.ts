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

/**
 * Returns a cache prefix that separates document-loader entries by user agent
 * and private-address policy.
 */
export function getDocumentLoaderCachePrefix(
  userAgent: string | undefined,
  allowPrivateAddress: boolean,
): readonly [string, ...string[]] {
  return [
    "_fedify",
    "remoteDocument",
    "cli",
    userAgent ?? "",
    allowPrivateAddress ? "allow-private" : "deny-private",
  ];
}

export async function getDocumentLoader(
  { userAgent, allowPrivateAddress = false }: DocumentLoaderOptions = {},
): Promise<DocumentLoader> {
  const cacheKey = `${userAgent ?? ""}:${allowPrivateAddress}`;
  if (documentLoaders[cacheKey]) return documentLoaders[cacheKey];
  const kv = await getKvStore();
  return documentLoaders[cacheKey] = kvCache({
    kv,
    prefix: getDocumentLoaderCachePrefix(userAgent, allowPrivateAddress),
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
