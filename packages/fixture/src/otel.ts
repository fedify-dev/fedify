import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ExportResultCode } from "@opentelemetry/core";

/**
 * A test spy for OpenTelemetry spans that captures all spans and events.
 */
export class TestSpanExporter implements SpanExporter {
  public spans: ReadableSpan[] = [];

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: ExportResultCode }) => void,
  ): void {
    this.spans.push(...spans);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  async forceFlush(): Promise<void> {
    // No-op
  }

  shutdown(): Promise<void> {
    this.spans = [];
    return Promise.resolve();
  }

  /**
   * Gets all spans with the given name.
   */
  getSpans(name: string): ReadableSpan[] {
    return this.spans.filter((span) => span.name === name);
  }

  /**
   * Gets the first span with the given name.
   */
  getSpan(name: string): ReadableSpan | undefined {
    return this.spans.find((span) => span.name === name);
  }

  /**
   * Gets all events from spans with the given name.
   */
  getEvents(spanName: string, eventName?: string): ReadableSpan["events"] {
    const spans = this.getSpans(spanName);
    const events = spans.flatMap((span) => span.events);
    if (eventName) {
      return events.filter((event) => event.name === eventName);
    }
    return events;
  }

  /**
   * Clears all captured spans.
   */
  clear(): void {
    this.spans = [];
  }
}

/**
 * Creates a test tracer provider with a test exporter.
 * @returns A tuple of [tracerProvider, testExporter]
 */
export function createTestTracerProvider(): [
  BasicTracerProvider,
  TestSpanExporter,
] {
  const exporter = new TestSpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  return [provider, exporter];
}
