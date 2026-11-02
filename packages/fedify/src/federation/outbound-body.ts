/** One pull-driven response reader with an absolute lifetime and no extra queue. */
export class ResponseBodyPump {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #expiresAt: number;
  readonly #deadline: Promise<undefined>;
  readonly #timer: ReturnType<typeof setTimeout>;
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
