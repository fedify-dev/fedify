import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ExportResultCode } from "@opentelemetry/core";
import type {
  Attributes,
  BatchObservableCallback,
  Context,
  Counter,
  Gauge,
  Histogram,
  Meter,
  MeterOptions,
  MeterProvider,
  MetricAttributes,
  MetricOptions,
  Observable,
  ObservableCallback,
  ObservableCounter,
  ObservableGauge,
  ObservableUpDownCounter,
  UpDownCounter,
} from "@opentelemetry/api";

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

/**
 * A metric measurement captured by {@link TestMetricRecorder}.
 * @since 2.3.0
 */
export interface TestMetricMeasurement {
  /**
   * The metric instrument name.
   * @since 2.3.0
   */
  readonly name: string;

  /**
   * The instrument type that recorded the measurement.
   * @since 2.3.0
   */
  readonly type: "counter" | "histogram" | "gauge" | "upDownCounter";

  /**
   * The recorded metric value.
   * @since 2.3.0
   */
  readonly value: number;

  /**
   * The attributes recorded with the measurement.
   * @since 2.3.0
   */
  readonly attributes: Attributes;
}

/**
 * A test recorder for OpenTelemetry metric measurements.
 * @since 2.3.0
 */
export class TestMetricRecorder {
  /**
   * The captured metric measurements.
   * @since 2.3.0
   */
  public measurements: TestMetricMeasurement[] = [];

  /**
   * Records a metric measurement.
   * @since 2.3.0
   */
  record(measurement: TestMetricMeasurement): void {
    this.measurements.push(measurement);
  }

  /**
   * Gets all measurements with the given metric name.
   * @since 2.3.0
   */
  getMeasurements(name: string): TestMetricMeasurement[] {
    return this.measurements.filter((measurement) => measurement.name === name);
  }

  /**
   * Gets the first measurement with the given metric name.
   * @since 2.3.0
   */
  getMeasurement(name: string): TestMetricMeasurement | undefined {
    return this.measurements.find((measurement) => measurement.name === name);
  }

  /**
   * Clears all captured measurements.
   * @since 2.3.0
   */
  clear(): void {
    this.measurements = [];
  }
}

class TestCounter<AttributesTypes extends MetricAttributes = MetricAttributes>
  implements Counter<AttributesTypes> {
  constructor(
    private readonly name: string,
    private readonly recorder: TestMetricRecorder,
    private readonly type: TestMetricMeasurement["type"] = "counter",
  ) {
  }

  add(value: number, attributes?: AttributesTypes, _context?: Context): void {
    this.recorder.record({
      name: this.name,
      type: this.type,
      value,
      attributes: { ...(attributes ?? {}) },
    });
  }
}

class TestHistogram<
  AttributesTypes extends MetricAttributes = MetricAttributes,
> implements Histogram<AttributesTypes>, Gauge<AttributesTypes> {
  constructor(
    private readonly name: string,
    private readonly recorder: TestMetricRecorder,
    private readonly type: TestMetricMeasurement["type"] = "histogram",
  ) {
  }

  record(
    value: number,
    attributes?: AttributesTypes,
    _context?: Context,
  ): void {
    this.recorder.record({
      name: this.name,
      type: this.type,
      value,
      attributes: { ...(attributes ?? {}) },
    });
  }
}

class TestObservable<
  AttributesTypes extends MetricAttributes = MetricAttributes,
> implements Observable<AttributesTypes> {
  readonly callbacks = new Set<ObservableCallback<AttributesTypes>>();

  addCallback(callback: ObservableCallback<AttributesTypes>): void {
    this.callbacks.add(callback);
  }

  removeCallback(callback: ObservableCallback<AttributesTypes>): void {
    this.callbacks.delete(callback);
  }
}

class TestMeter implements Meter {
  constructor(private readonly recorder: TestMetricRecorder) {
  }

  createCounter<AttributesTypes extends MetricAttributes = MetricAttributes>(
    name: string,
    _options?: MetricOptions,
  ): Counter<AttributesTypes> {
    return new TestCounter(name, this.recorder);
  }

  createUpDownCounter<
    AttributesTypes extends MetricAttributes = MetricAttributes,
  >(
    name: string,
    _options?: MetricOptions,
  ): UpDownCounter<AttributesTypes> {
    return new TestCounter(name, this.recorder, "upDownCounter");
  }

  createHistogram<AttributesTypes extends MetricAttributes = MetricAttributes>(
    name: string,
    _options?: MetricOptions,
  ): Histogram<AttributesTypes> {
    return new TestHistogram(name, this.recorder);
  }

  createGauge<AttributesTypes extends MetricAttributes = MetricAttributes>(
    name: string,
    _options?: MetricOptions,
  ): Gauge<AttributesTypes> {
    return new TestHistogram(name, this.recorder, "gauge");
  }

  createObservableCounter<
    AttributesTypes extends MetricAttributes = MetricAttributes,
  >(
    _name: string,
    _options?: MetricOptions,
  ): ObservableCounter<AttributesTypes> {
    return new TestObservable();
  }

  createObservableUpDownCounter<
    AttributesTypes extends MetricAttributes = MetricAttributes,
  >(
    _name: string,
    _options?: MetricOptions,
  ): ObservableUpDownCounter<AttributesTypes> {
    return new TestObservable();
  }

  createObservableGauge<
    AttributesTypes extends MetricAttributes = MetricAttributes,
  >(
    _name: string,
    _options?: MetricOptions,
  ): ObservableGauge<AttributesTypes> {
    return new TestObservable();
  }

  addBatchObservableCallback<
    AttributesTypes extends MetricAttributes = MetricAttributes,
  >(
    _callback: BatchObservableCallback<AttributesTypes>,
    _observables: Observable<AttributesTypes>[],
  ): void {
  }

  removeBatchObservableCallback<
    AttributesTypes extends MetricAttributes = MetricAttributes,
  >(
    _callback: BatchObservableCallback<AttributesTypes>,
    _observables: Observable<AttributesTypes>[],
  ): void {
  }
}

class TestMeterProvider implements MeterProvider {
  constructor(private readonly recorder: TestMetricRecorder) {
  }

  getMeter(
    _name: string,
    _version?: string,
    _options?: MeterOptions,
  ): Meter {
    return new TestMeter(this.recorder);
  }
}

/**
 * Creates a test meter provider with a test recorder.
 * @returns A tuple of [meterProvider, testRecorder].
 * @since 2.3.0
 */
export function createTestMeterProvider(): [
  MeterProvider,
  TestMetricRecorder,
] {
  const recorder = new TestMetricRecorder();
  return [new TestMeterProvider(recorder), recorder];
}
