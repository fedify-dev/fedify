import type { DocumentLoader } from "./docloader.ts";
import type { TracerProvider } from "@opentelemetry/api";

/**
 * JSON value shape passed to property preprocessors.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

/**
 * Runtime context provided to property preprocessors.
 */
export interface PropertyPreprocessorContext {
  /** Loader for remote JSON-LD documents. */
  documentLoader?: DocumentLoader;
  /** Loader for remote JSON-LD contexts. */
  contextLoader?: DocumentLoader;
  /** OpenTelemetry tracer provider for instrumentation. */
  tracerProvider?: TracerProvider;
  /** Base URL for resolving relative references. */
  baseUrl?: URL;
}

/**
 * Function signature for schema-configured property preprocessors.
 *
 * Receives an expanded JSON-LD property value and returns a vocabulary
 * object when the value is handled, `undefined` when the value should
 * fall through to the normal range decoder, or an `Error` when the value
 * is recognized but cannot be converted.
 */
export type PropertyPreprocessor<T = unknown> = (
  value: Json,
  context: PropertyPreprocessorContext,
) => T | undefined | Error | Promise<T | undefined | Error>;
