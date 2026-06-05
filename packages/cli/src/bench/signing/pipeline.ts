/**
 * The signing pipeline that keeps RSA signing out of the send critical path.
 *
 * Three lookahead modes, all reusing the same per-request signing factory:
 *
 *  -  `jit`: sign in the send path (the only valid mode against a strict
 *     time-window target); rate-capped.
 *  -  `pipeline` (default): background signers keep a bounded buffer filled and
 *     senders pull from it; if the buffer starves, that is the client-bound
 *     signal, surfaced via `starvationCount`.
 *  -  `presign`: the whole run is signed up front, so the achievable rate is
 *     not bounded by real-time signing throughput.
 * @since 2.3.0
 * @module
 */

import type { SigningMode } from "../scenario/types.ts";

/** A factory that signs and returns one request. */
export type SignFactory = () => Promise<Request>;

/** A running signing pipeline. */
export interface SigningPipeline {
  /** Returns the next signed request, awaiting one if none is buffered. */
  next(): Promise<Request>;
  /** Pre-fills the buffer to its target before the timed window opens. */
  prime(): Promise<void>;
  /** The number of times `next()` found the buffer empty (client-bound). */
  readonly starvationCount: number;
  /** Stops background signing and releases pending consumers. */
  close(): Promise<void>;
}

/** Options for {@link createSigningPipeline}. */
export interface SigningPipelineOptions {
  /** The bounded buffer size for `pipeline` mode. */
  readonly bufferSize?: number;
  /** The total number of requests for `presign` mode. */
  readonly total?: number;
  /** The number of concurrent background signers. */
  readonly signers?: number;
}

/** An error used to release consumers waiting on a closed pipeline. */
export class PipelineClosedError extends Error {}

const DEFAULT_BUFFER_SIZE = 256;
const DEFAULT_SIGNERS = 4;
/**
 * After this many signing failures with no successful sign in between, the
 * pipeline gives up so a deterministic signing error fails fast instead of
 * spinning forever.
 */
const FATAL_FAILURE_THRESHOLD = 8;

/**
 * Creates a signing pipeline for the given mode.
 * @param mode The lookahead mode.
 * @param factory The per-request signing factory.
 * @param options Buffer, total, and concurrency options.
 * @returns The signing pipeline.
 */
export function createSigningPipeline(
  mode: SigningMode,
  factory: SignFactory,
  options: SigningPipelineOptions = {},
): SigningPipeline {
  if (mode === "jit") return createJit(factory);
  const signers = options.signers ?? DEFAULT_SIGNERS;
  if (mode === "presign") {
    const total = options.total ?? DEFAULT_BUFFER_SIZE;
    return createBuffered(factory, {
      bufferSize: total,
      fillTarget: total,
      signers,
      countStarvation: false,
      // Sign the whole run up front and then stop: the background signers must
      // not refill as the buffer drains, or signing would run during the timed
      // window and defeat the point of presigning.
      maxProduced: total,
    });
  }
  const bufferSize = options.bufferSize ?? DEFAULT_BUFFER_SIZE;
  return createBuffered(factory, {
    bufferSize,
    fillTarget: bufferSize,
    signers,
    countStarvation: true,
  });
}

function createJit(factory: SignFactory): SigningPipeline {
  return {
    next: factory,
    prime: () => Promise.resolve(),
    starvationCount: 0,
    close: () => Promise.resolve(),
  };
}

interface BufferedOptions {
  readonly bufferSize: number;
  readonly fillTarget: number;
  readonly signers: number;
  readonly countStarvation: boolean;
  /**
   * A cap on how many requests the background signers produce in total.  Used by
   * `presign` to sign the run once and then stop; omitted (unbounded) for
   * `pipeline`, which refills the buffer for the whole run.
   */
  readonly maxProduced?: number;
}

function createBuffered(
  factory: SignFactory,
  options: BufferedOptions,
): SigningPipeline {
  const ready: Request[] = [];
  const waiters: Array<{
    resolve: (request: Request) => void;
    reject: (error: unknown) => void;
  }> = [];
  const maxProduced = options.maxProduced ?? Infinity;
  let produced = 0;
  let starvationCount = 0;
  let inFlight = 0;
  let closed = false;
  let consecutiveFailures = 0;
  let fatalError: unknown = null;
  const CLOSED = Symbol("closed");
  let signalClose!: () => void;
  const closeSignal = new Promise<typeof CLOSED>((resolve) => {
    signalClose = () => resolve(CLOSED);
  });

  function deliver(request: Request): void {
    const waiter = waiters.shift();
    if (waiter != null) waiter.resolve(request);
    else ready.push(request);
  }

  function fail(error: unknown): void {
    fatalError = error;
    closed = true;
    signalClose();
    ready.length = 0; // discard buffered requests so next() rejects
    while (waiters.length > 0) waiters.shift()!.reject(error);
  }

  async function producer(): Promise<void> {
    while (!closed) {
      // Stop once the whole run is signed (presign): don't refill as the buffer
      // drains, so signing stays out of the timed window.  Unbounded for
      // `pipeline`, which keeps the buffer full for the whole run.
      if (produced + inFlight >= maxProduced) break;
      if (
        waiters.length === 0 && ready.length + inFlight >= options.bufferSize
      ) {
        await Promise.race([delay(), closeSignal]);
        continue;
      }
      inFlight++;
      try {
        // Race the sign against close so a slow/stuck factory cannot block
        // close(); the detached factory promise is swallowed if it settles
        // late.  `Promise.resolve().then(factory)` turns a synchronous throw in
        // the factory into a rejection rather than killing the producer.
        const pending = Promise.resolve().then(factory);
        pending.catch(() => {});
        const result = await Promise.race([pending, closeSignal]);
        if (result === CLOSED || closed) break;
        consecutiveFailures = 0;
        produced++;
        deliver(result);
      } catch (error) {
        // A transient failure is dropped, but a run of failures with no
        // success means signing is deterministically broken: fail fast.
        if (++consecutiveFailures >= FATAL_FAILURE_THRESHOLD) fail(error);
      } finally {
        inFlight--;
      }
    }
  }

  const producers = Array.from({ length: options.signers }, () => producer());

  return {
    get starvationCount(): number {
      return starvationCount;
    },
    next(): Promise<Request> {
      const buffered = ready.shift();
      if (buffered != null) return Promise.resolve(buffered);
      if (fatalError != null) return Promise.reject(fatalError);
      if (closed) return Promise.reject(new PipelineClosedError("closed"));
      // Presign overshoot: the run asked for more than the pre-signed total
      // (e.g. a few extra Poisson arrivals), so sign the extra on demand rather
      // than refilling the whole run in the background.
      if (produced >= maxProduced) return Promise.resolve().then(factory);
      if (options.countStarvation) starvationCount++;
      return new Promise<Request>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    async prime(): Promise<void> {
      while (!closed && ready.length < options.fillTarget) {
        await Promise.race([delay(), closeSignal]);
      }
      if (fatalError != null) throw fatalError;
    },
    async close(): Promise<void> {
      closed = true;
      signalClose();
      while (waiters.length > 0) {
        waiters.shift()!.reject(new PipelineClosedError("closed"));
      }
      await Promise.allSettled(producers);
    },
  };
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}
