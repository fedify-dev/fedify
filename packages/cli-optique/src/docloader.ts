import {
  type DocumentLoader,
  getDocumentLoader as getDefaultDocumentLoader,
  kvCache,
} from "@fedify/fedify";
import { DenoKvStore } from "@fedify/fedify/x/denokv";
import { join } from "@std/path";
import { getCacheDir } from "./cache.ts";

const documentLoaders: Record<string, DocumentLoader> = {};

export interface DocumentLoaderOptions {
  userAgent?: string;
}

export async function getDocumentLoader(
  { userAgent }: DocumentLoaderOptions = {},
): Promise<DocumentLoader> {
  if (documentLoaders[userAgent ?? ""]) return documentLoaders[userAgent ?? ""];
  const path = join(await getCacheDir(), "kv");
  const kv = new DenoKvStore(await Deno.openKv(path));
  return documentLoaders[userAgent ?? ""] = kvCache({
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
        Temporal.Duration.from({ seconds: 0 }),
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
        Temporal.Duration.from({ seconds: 0 }),
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
        Temporal.Duration.from({ seconds: 0 }),
      ],
    ],
    loader: getDefaultDocumentLoader({
      allowPrivateAddress: true,
      userAgent,
    }),
  });
}

export function getContextLoader(
  options: DocumentLoaderOptions = {},
): Promise<DocumentLoader> {
  return getDocumentLoader(options);
}
