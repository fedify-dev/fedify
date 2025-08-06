import { expandGlob } from "@std/fs";
import { joinGlobs, resolve, SEPARATOR } from "@std/path";

const files = expandGlob(
  joinGlobs(
    [
      import.meta.dirname ?? ".",
      "..",
      "src",
      "cfworkers",
      "dist",
      "**",
      "*.test.js",
    ],
    { globstar: true },
  ),
  { includeDirs: false, canonicalize: true, globstar: true },
);

const baseDir = resolve(import.meta.dirname ?? ".", "..", "src", "cfworkers");

for await (const file of files) {
  let path = file.path;
  if (path.startsWith(baseDir + SEPARATOR)) {
    path = path.slice(baseDir.length + SEPARATOR.length);
  }
  if (path.startsWith(`src${SEPARATOR}codegen${SEPARATOR}`)) continue;
  const relPath = `./${path.replaceAll(SEPARATOR, "/")}`;
  console.log(`import "${relPath}";`);
}
