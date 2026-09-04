import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";
import {
  temporalPolyfillCjsBanner,
  temporalPolyfillCjsDeps,
  temporalPolyfillEsmBanner,
  temporalPolyfillImportPlugin,
} from "../../scripts/tsdown/temporal.mts";

const emscriptenReference = '/// <reference types="emscripten" />\n';

async function addEmscriptenReference(
  outDir: string,
  fileName: string,
): Promise<void> {
  const path = join(outDir, fileName);
  const declaration = await readFile(path, "utf8");
  if (declaration.includes(emscriptenReference.trim())) return;
  await writeFile(path, emscriptenReference + declaration);
}

export default defineConfig({
  entry: ["src/mod.ts", "src/kv.ts"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  unbundle: true,
  format: {
    esm: {
      banner: temporalPolyfillEsmBanner(),
    },
    cjs: {
      deps: temporalPolyfillCjsDeps(),
      plugins: [temporalPolyfillImportPlugin],
      banner: temporalPolyfillCjsBanner(),
    },
  },
  platform: "node",
  hooks: {
    "build:done": async (ctx) => {
      await Promise.all(
        ctx.chunks
          .filter((chunk) => /\.d\.(?:c|m)?ts$/.test(chunk.fileName))
          .map((chunk) =>
            addEmscriptenReference(ctx.options.outDir, chunk.fileName)
          ),
      );
    },
  },
  outExtensions({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
      dts: format === "cjs" ? ".d.cts" : ".d.ts",
    };
  },
});
