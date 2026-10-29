/** An OS request to stop the initializer matrix after cleaning up its server. */
export class TestInterruptedError extends Error {
  readonly exitCode: number;

  constructor(readonly signal: "SIGINT" | "SIGTERM") {
    super(`Initializer tests interrupted by ${signal}`);
    this.name = "TestInterruptedError";
    this.exitCode = signal === "SIGINT" ? 130 : 143;
  }
}
