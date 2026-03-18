import { join as joinPath } from "node:path";

export const getPackagesPath = (): string =>
  joinPath(
    import.meta.dirname!, // action
    "..", // src
    "..", // init
    "..", // packages
  );
