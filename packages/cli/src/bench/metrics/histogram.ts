/**
 * A lightweight HdrHistogram-style log-linear histogram for recording latency
 * samples and computing percentiles with bounded relative error.
 *
 * Values are bucketed by octave (a power-of-two band) and then split into a
 * fixed number of linear sub-buckets within each octave, which keeps the
 * relative error roughly constant across the whole range.  The structure is
 * sparse (only non-empty buckets are stored), mergeable, and serializable, so
 * percentiles from several runs can be re-aggregated without coordinated-
 * omission error.
 * @since 2.3.0
 * @module
 */

/** The default number of linear sub-buckets per octave. */
export const DEFAULT_SUB_BUCKET_COUNT = 128;

/**
 * The serialized form of a {@link LogLinearHistogram}.
 * @since 2.3.0
 */
export interface SerializedHistogram {
  /** The serialization format version. */
  readonly version: 1;
  /** The number of linear sub-buckets per octave. */
  readonly subBucketCount: number;
  /** The total number of recorded samples, including zeros. */
  readonly count: number;
  /** The number of recorded samples that were less than or equal to zero. */
  readonly zeroCount: number;
  /** The smallest recorded value, or `0` when empty. */
  readonly min: number;
  /** The largest recorded value, or `0` when empty. */
  readonly max: number;
  /** The exact sum of all recorded values. */
  readonly sum: number;
  /** The sorted bucket indices that have a non-zero count. */
  readonly indices: readonly number[];
  /** The per-bucket counts, parallel to {@link SerializedHistogram.indices}. */
  readonly counts: readonly number[];
}

/**
 * Options for constructing a {@link LogLinearHistogram}.
 * @since 2.3.0
 */
export interface LogLinearHistogramOptions {
  /**
   * The number of linear sub-buckets per octave.  Higher values reduce the
   * relative error at the cost of memory.  Defaults to
   * {@link DEFAULT_SUB_BUCKET_COUNT}.
   */
  readonly subBucketCount?: number;
}

/**
 * A sparse log-linear histogram.
 * @since 2.3.0
 */
export class LogLinearHistogram {
  readonly subBucketCount: number;
  #buckets: Map<number, number> = new Map();
  #count = 0;
  #zeroCount = 0;
  #sum = 0;
  #min = Number.POSITIVE_INFINITY;
  #max = Number.NEGATIVE_INFINITY;

  constructor(options: LogLinearHistogramOptions = {}) {
    const subBucketCount = options.subBucketCount ?? DEFAULT_SUB_BUCKET_COUNT;
    if (!Number.isInteger(subBucketCount) || subBucketCount < 1) {
      throw new RangeError(
        `subBucketCount must be a positive integer; got ${subBucketCount}.`,
      );
    }
    this.subBucketCount = subBucketCount;
  }

  /** The total number of recorded samples, including zeros. */
  get count(): number {
    return this.#count;
  }

  /** The smallest recorded value, or `0` when the histogram is empty. */
  get min(): number {
    return this.#count === 0 ? 0 : this.#min;
  }

  /** The largest recorded value, or `0` when the histogram is empty. */
  get max(): number {
    return this.#count === 0 ? 0 : this.#max;
  }

  /** The arithmetic mean of all recorded values, or `0` when empty. */
  get mean(): number {
    return this.#count === 0 ? 0 : this.#sum / this.#count;
  }

  /** The exact sum of all recorded values. */
  get sum(): number {
    return this.#sum;
  }

  /**
   * Records a single sample.
   * @param value The value to record.  Non-finite values are ignored; any
   *              non-positive value (negatives, `0`, and `-0`) is normalized to
   *              `0` and recorded in the zero bucket, since latency samples are
   *              never negative.
   */
  record(value: number): void {
    if (!Number.isFinite(value)) return;
    const v = value <= 0 ? 0 : value;
    this.#count++;
    this.#sum += v;
    if (v < this.#min) this.#min = v;
    if (v > this.#max) this.#max = v;
    if (v === 0) {
      this.#zeroCount++;
      return;
    }
    const index = this.#indexOf(v);
    this.#buckets.set(index, (this.#buckets.get(index) ?? 0) + 1);
  }

  /**
   * Computes an estimated percentile.
   * @param p The percentile to compute, between 0 and 100 inclusive.
   * @returns The estimated value at the given percentile, or `0` when the
   *          histogram is empty.
   */
  percentile(p: number): number {
    if (this.#count === 0) return 0;
    if (p <= 0) return this.#min;
    if (p >= 100) return this.#max;
    const target = Math.ceil((p / 100) * this.#count);
    let accumulated = this.#zeroCount;
    if (accumulated >= target) return 0;
    const indices = [...this.#buckets.keys()].sort((a, b) => a - b);
    for (const index of indices) {
      accumulated += this.#buckets.get(index)!;
      if (accumulated >= target) {
        return this.#clamp(this.#representativeValue(index));
      }
    }
    return this.#max;
  }

  /**
   * Merges another histogram into this one.  Both histograms must use the same
   * {@link LogLinearHistogram.subBucketCount}.
   * @param other The histogram to merge in.
   */
  merge(other: LogLinearHistogram): void {
    if (other.subBucketCount !== this.subBucketCount) {
      throw new TypeError(
        "Cannot merge histograms with different subBucketCount " +
          `(${this.subBucketCount} vs ${other.subBucketCount}).`,
      );
    }
    if (other.#count === 0) return;
    for (const [index, count] of other.#buckets) {
      this.#buckets.set(index, (this.#buckets.get(index) ?? 0) + count);
    }
    this.#count += other.#count;
    this.#zeroCount += other.#zeroCount;
    this.#sum += other.#sum;
    if (other.#min < this.#min) this.#min = other.#min;
    if (other.#max > this.#max) this.#max = other.#max;
  }

  /** Serializes the histogram to a plain JSON-compatible object. */
  toJSON(): SerializedHistogram {
    const indices = [...this.#buckets.keys()].sort((a, b) => a - b);
    return {
      version: 1,
      subBucketCount: this.subBucketCount,
      count: this.#count,
      zeroCount: this.#zeroCount,
      min: this.min,
      max: this.max,
      sum: this.#sum,
      indices,
      counts: indices.map((index) => this.#buckets.get(index)!),
    };
  }

  /** Reconstructs a histogram from its serialized form. */
  static fromJSON(json: SerializedHistogram): LogLinearHistogram {
    if (json.indices.length !== json.counts.length) {
      throw new TypeError(
        "Serialized histogram indices and counts must have equal length.",
      );
    }
    const histogram = new LogLinearHistogram({
      subBucketCount: json.subBucketCount,
    });
    for (let i = 0; i < json.indices.length; i++) {
      histogram.#buckets.set(json.indices[i], json.counts[i]);
    }
    histogram.#count = json.count;
    histogram.#zeroCount = json.zeroCount;
    histogram.#sum = json.sum;
    histogram.#min = json.count === 0 ? Number.POSITIVE_INFINITY : json.min;
    histogram.#max = json.count === 0 ? Number.NEGATIVE_INFINITY : json.max;
    return histogram;
  }

  #indexOf(value: number): number {
    const octave = Math.floor(Math.log2(value));
    // Use the mantissa ratio (value / 2**octave is in [1, 2)) rather than
    // dividing by a sub-bucket width, which would underflow to 0 for denormal
    // values and yield a NaN index.
    let sub = Math.floor((value / 2 ** octave - 1) * this.subBucketCount);
    // Guard against floating-point drift pushing the sub-bucket out of range.
    if (sub < 0) sub = 0;
    else if (sub >= this.subBucketCount) sub = this.subBucketCount - 1;
    return octave * this.subBucketCount + sub;
  }

  #representativeValue(index: number): number {
    const octave = Math.floor(index / this.subBucketCount);
    const sub = index - octave * this.subBucketCount;
    return 2 ** octave * (1 + (sub + 0.5) / this.subBucketCount);
  }

  #clamp(value: number): number {
    if (value < this.#min) return this.#min;
    if (value > this.#max) return this.#max;
    return value;
  }
}
