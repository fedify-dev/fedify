import type { DocumentLoader } from "./docloader.ts";
import type { TracerProvider } from "@opentelemetry/api";

export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

export interface PropertyPreprocessorContext {
  documentLoader?: DocumentLoader;
  contextLoader?: DocumentLoader;
  tracerProvider?: TracerProvider;
  baseUrl?: URL;
}

export type PropertyPreprocessor<T = unknown> = (
  value: Json,
  context: PropertyPreprocessorContext,
) => T | undefined | Error | Promise<T | undefined | Error>;
