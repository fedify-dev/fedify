/** One pull-driven response reader with an absolute lifetime and no extra queue. */
export class ResponseBodyPump {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  #expiresAt: number;
  readonly #deadline: Promise<undefined>;
  #timer: ReturnType<typeof setTimeout>;
  #expireDeadline!: () => void;
  #pending:
    | Promise<ReadableStreamReadResult<Uint8Array> | undefined>
    | undefined;
  #timedOut = false;
  #closed = false;
  #ended = false;

  constructor(body: ReadableStream<Uint8Array>, timeoutMs: number) {
    this.#reader = body.getReader();
    this.#expiresAt = performance.now() + timeoutMs;
    this.#deadline = new Promise((resolve) => {
      this.#expireDeadline = () => resolve(undefined);
    });
    this.#timer = setTimeout(() => this.#expire(), timeoutMs);
  }

  /** Undefined means the absolute lifetime expired, independently of EOF. */
  read(): Promise<ReadableStreamReadResult<Uint8Array> | undefined> {
    if (this.#closed) {
      return Promise.resolve(
        this.#timedOut ? undefined : { done: true, value: undefined },
      );
    }
    if (performance.now() >= this.#expiresAt) {
      this.#expire();
      return Promise.resolve(undefined);
    }
    // Concurrent consumers share this read instead of issuing another one.
    this.#pending ??= Promise.race([this.#reader.read(), this.#deadline]).then(
      (result) => {
        this.#pending = undefined;
        // A continuously ready stream can keep timers from running. Check the
        // same monotonic deadline on every read, including empty chunks.
        if (this.#timedOut || performance.now() >= this.#expiresAt) {
          this.#expire();
          return undefined;
        }
        if (this.#closed) return { done: true as const, value: undefined };
        if (result?.done) {
          this.#ended = true;
          this.close();
        }
        return result;
      },
      (error) => {
        this.#pending = undefined;
        this.close();
        throw error;
      },
    );
    return this.#pending;
  }

  /** Shorten the remaining lifetime when ownership passes to diagnostic cleanup. */
  limitLifetime(timeoutMs: number): void {
    if (this.#closed) return;
    this.#expiresAt = Math.min(
      this.#expiresAt,
      performance.now() + Math.max(0, timeoutMs),
    );
    clearTimeout(this.#timer);
    if (performance.now() >= this.#expiresAt) this.#expire();
    else {
      this.#timer = setTimeout(
        () => this.#expire(),
        this.#expiresAt - performance.now(),
      );
    }
  }

  /** Stop pulling and release ownership without awaiting arbitrary cancellation. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#timer);
    try {
      if (!this.#ended) this.#reader.cancel().catch(() => {});
    } finally {
      // Pending read rejection and late cancellation rejection are both observed.
      this.#reader.releaseLock();
    }
  }

  #expire(): void {
    if (this.#timedOut) return;
    this.#timedOut = true;
    this.#expireDeadline();
    this.close();
  }
}
