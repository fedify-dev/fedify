import { test } from "@fedify/fixture";
import { assertEquals } from "@std/assert/assert-equals";
import { assertNotEquals } from "@std/assert/assert-not-equals";
import { AssertionError } from "@std/assert/assertion-error";
import { createExponentialBackoffPolicy } from "./retry.ts";

test("createExponentialBackoffPolicy()", () => {
  const policy = createExponentialBackoffPolicy({
    maxAttempts: 4,
  });
  const noMatter = Temporal.Duration.from({ seconds: 0 });
  for (let i = 0; i < 10; i++) {
    assertDurationRange(
      policy({ elapsedTime: noMatter, attempts: 0 }),
      { seconds: 1 },
      { seconds: 2 },
    );
  }
  for (let i = 0; i < 10; i++) {
    assertDurationRange(
      policy({ elapsedTime: noMatter, attempts: 1 }),
      { seconds: 2 },
      { seconds: 4 },
    );
  }
  for (let i = 0; i < 10; i++) {
    assertDurationRange(
      policy({ elapsedTime: noMatter, attempts: 2 }),
      { seconds: 4 },
      { seconds: 8 },
    );
  }
  for (let i = 0; i < 10; i++) {
    assertDurationRange(
      policy({ elapsedTime: noMatter, attempts: 3 }),
      { seconds: 8 },
      { seconds: 16 },
    );
  }
  assertEquals(policy({ elapsedTime: noMatter, attempts: 4 }), null);
});

function assertDurationRange(
  actual: Temporal.Duration | null,
  min: Temporal.DurationLike,
  max: Temporal.DurationLike,
) {
  assertNotEquals(actual, null);
  if (actual == null) return;
  const minDuration = Temporal.Duration.from(min);
  const maxDuration = Temporal.Duration.from(max);
  if (
    Temporal.Duration.compare(actual, minDuration) < 0 ||
    Temporal.Duration.compare(actual, maxDuration) > 0
  ) {
    throw new AssertionError(
      `Expected ${actual} to be between ${min} and ${max}`,
    );
  }
}
