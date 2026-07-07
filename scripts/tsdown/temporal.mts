import { sep } from "node:path";

// Shared tsdown helpers for packages that use Temporal in published output.
//
// ESM builds can import temporal-polyfill normally, but CommonJS builds cannot
// require temporal-polyfill directly because its package exports are ESM-first.
// For CJS, the build injects a local Temporal binding into source chunks and
// bundles temporal-polyfill and temporal-utils so consumers do not need either
// @js-temporal/polyfill or a global Temporal at runtime.

export function isTemporalPolyfillDependency(id: string): boolean {
  return /^temporal-polyfill(\/.*)?$/.test(id) ||
    /^temporal-utils(\/.*)?$/.test(id);
}

export const temporalPolyfillImportPlugin = {
  name: "fedify-temporal-polyfill-import",
  transform(code: string, id: string) {
    if (!id.replaceAll(sep, "/").includes("/src/")) return null;
    if (!/\.[cm]?[jt]sx?$/.test(id)) return null;
    if (!/\bTemporal\./.test(code)) return null;
    if (code.includes(`from "temporal-polyfill"`)) return null;
    return {
      code: [
        `import { Temporal as __FedifyTemporal } from "temporal-polyfill";`,
        `const Temporal: typeof globalThis.Temporal = __FedifyTemporal;`,
        code,
      ].join("\n"),
      map: null,
    };
  },
};

export function temporalPolyfillEsmBanner(extraJs?: string): {
  js: string;
  dts: string;
} {
  return {
    js: [
      `import { Temporal } from "temporal-polyfill";`,
      extraJs,
    ].filter((line) => line != null && line !== "").join("\n"),
    dts: `/// <reference lib="esnext.temporal" />`,
  };
}

export function temporalPolyfillCjsBanner(extraJs?: string): {
  js?: string;
  dts: string;
} {
  return {
    js: extraJs,
    dts: `/// <reference lib="esnext.temporal" />`,
  };
}

export const temporalPolyfillIntro = `
      import { Temporal } from "temporal-polyfill";
    `;
