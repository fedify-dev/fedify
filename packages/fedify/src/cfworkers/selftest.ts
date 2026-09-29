import type { TestDefinition } from "./runner.ts";

// Synthetic failures exercise the real runner without entering the normal suite.
export const selfTests: TestDefinition[] = [
  { name: "pass", fn() {} },
  {
    name: "ignored test",
    ignore: true,
    fn() { throw new Error("Ignored test ran"); },
  },
  {
    name: "ignored step",
    async fn(t) {
      const result = await t.step({
        name: "ignored",
        ignore: true,
        fn() { throw new Error("Ignored step ran"); },
      });
      if (result !== false) throw new Error("Ignored step must return false");
    },
  },
  ...[undefined, null, new Error("SELFTEST_FAILURE")].flatMap((error, i) => [
    { name: `throw ${i}`, fn() { throw error; } },
    {
      name: `step ${i}`,
      async fn(t: Parameters<TestDefinition["fn"]>[0]) {
        await t.step("failure", () => { throw error; });
        await t.step("success after failure", () => {});
      },
    },
    {
      name: `nested ${i}`,
      async fn(t: Parameters<TestDefinition["fn"]>[0]) {
        await t.step("outer", async (outer: typeof t) => {
          await outer.step("failure", () => { throw error; });
        });
      },
    },
  ]),
];
