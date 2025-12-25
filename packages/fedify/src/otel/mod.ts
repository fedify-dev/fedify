/**
 * OpenTelemetry integration utilities for Fedify.
 *
 * This module provides utilities for integrating Fedify with OpenTelemetry,
 * including a {@link FedifySpanExporter} that persists trace data to a
 * {@link KvStore} for distributed tracing support.
 *
 * @example Basic usage
 * ```typescript ignore
 * import { MemoryKvStore } from "@fedify/fedify";
 * import { FedifySpanExporter } from "@fedify/fedify/otel";
 * import {
 *   BasicTracerProvider,
 *   SimpleSpanProcessor,
 * } from "@opentelemetry/sdk-trace-base";
 *
 * const kv = new MemoryKvStore();
 * const exporter = new FedifySpanExporter(kv, {
 *   ttl: Temporal.Duration.from({ hours: 1 }),
 * });
 *
 * const provider = new BasicTracerProvider();
 * provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
 * ```
 *
 * @module
 * @since 1.10.0
 */
export {
  type ActivityDirection,
  FedifySpanExporter,
  type FedifySpanExporterOptions,
  type GetRecentTracesOptions,
  type SignatureVerificationDetails,
  type TraceActivityRecord,
  type TraceSummary,
} from "./exporter.ts";
