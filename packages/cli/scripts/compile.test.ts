import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { compileWithDownloadRetries } from "./compile.ts";

const failure = {
  success: false,
  code: 1,
  stderr:
    "\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Failed caching npm package '@rollup/rollup-darwin-arm64@4.60.1'\r\n    0: error reading a body from connection",
};

test("retries an interrupted npm download and accepts a successful compile", async () => {
  let calls = 0;
  const delays: number[] = [];
  const warnings: string[] = [];
  await compileWithDownloadRetries(
    () =>
      Promise.resolve(
        ++calls === 1 ? failure : { success: true, code: 0, stderr: "" },
      ),
    "aarch64-apple-darwin",
    {
      sleep: (delay) => {
        delays.push(delay);
        return Promise.resolve();
      },
      warn: (message) => {
        warnings.push(message);
      },
    },
  );
  strictEqual(calls, 2);
  deepStrictEqual(delays, [2_000]);
  strictEqual(warnings.length, 1);
});

test("stops after three interrupted download attempts", async () => {
  let calls = 0;
  const delays: number[] = [];
  await rejects(
    compileWithDownloadRetries(
      () => {
        calls++;
        return Promise.resolve(failure);
      },
      "aarch64-apple-darwin",
      {
        sleep: (delay) => {
          delays.push(delay);
          return Promise.resolve();
        },
        warn: () => {},
      },
    ),
    /aarch64-apple-darwin.*exit code 1/,
  );
  strictEqual(calls, 3);
  deepStrictEqual(delays, [2_000, 4_000]);
});

test("does not retry deterministic compile failures or unrelated connection errors", async () => {
  for (const stderr of [
    "error: TS2307 Cannot find module './missing.ts'",
    "error: Failed caching npm package 'missing-package'\npackage not found",
    "error: error reading a body from connection",
    "error: Failed caching npm package 'missing-package'\npackage not found\nunrelated: error reading a body from connection",
    failure.stderr + "\nerror: TS2307 Cannot find module './missing.ts'",
  ]) {
    let calls = 0;
    await rejects(
      compileWithDownloadRetries(
        () => {
          calls++;
          return Promise.resolve({ ...failure, stderr });
        },
        "x86_64-unknown-linux-gnu",
        {
          sleep: () => {
            throw new Error("must not wait");
          },
          warn: () => {
            throw new Error("must not warn about a retry");
          },
        },
      ),
      /x86_64-unknown-linux-gnu.*exit code 1/,
    );
    strictEqual(calls, 1);
  }
});

test("does not retry a signaled compiler despite earlier download diagnostics", async () => {
  let calls = 0;
  await rejects(
    compileWithDownloadRetries(
      () => {
        calls++;
        return Promise.resolve({ ...failure, signal: "SIGTERM" });
      },
      "x86_64-unknown-linux-gnu",
      {
        sleep: () => {
          throw new Error("must not wait");
        },
      },
    ),
    /exit code 1/,
  );
  strictEqual(calls, 1);
});

test("propagates subprocess setup failures without retrying", async () => {
  let calls = 0;
  const failure = new Error("compiler executable not found");
  await rejects(
    compileWithDownloadRetries(
      () => {
        calls++;
        throw failure;
      },
      "x86_64-unknown-linux-gnu",
      {
        sleep: () => {
          throw new Error("must not wait");
        },
      },
    ),
    (error) => error === failure,
  );
  strictEqual(calls, 1);
});
