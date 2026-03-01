import { join as joinPath } from "node:path";

/**
 * Absolute path to the monorepo *packages/* directory.
 * Used in test mode to resolve local `@fedify/*` package paths.
 */
export const PACKAGES_PATH = joinPath(
  import.meta.dirname!, // action
  "..", // src
  "..", // init
  "..", // packages
);
