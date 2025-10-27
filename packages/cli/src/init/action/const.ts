import { join as joinPath } from "node:path";

export const PACKAGES_PATH = joinPath(
  import.meta.dirname!, // action
  "..", // init
  "..", // src
  "..", // cli
  "..", // packages
);
