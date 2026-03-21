import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { defineConfig } from "tsdown";

async function copyFileSafely(
  source: string,
  destination: string,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(source));
}

export default [
  defineConfig({
    entry: ["src/mod.ts"],
    dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
    format: ["esm", "cjs"],
    platform: "neutral",
    external: [/^node:/],
    hooks: {
      "build:done": async (ctx) => {
        for await (const file of glob("src/fixtures/**/*.json")) {
          await copyFileSafely(
            file,
            join(ctx.options.outDir, file.replace(`src${sep}`, "")),
          );
        }
      },
    },
  }),
  defineConfig({
    outDir: "dist-tests",
    entry: (await Array.fromAsync(glob(`src/**/*.test.ts`)))
      .map((f) => f.replace(sep, "/")),
    dts: false,
    format: ["esm", "cjs"],
    platform: "node",
    external: [
      /^node:/,
      "@fedify/vocab-runtime",
    ],
  }),
];

// cSpell: ignore onwarn
