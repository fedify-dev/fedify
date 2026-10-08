// Checks the published peer dependency range on `@cloudflare/workers-types`.
// npm refuses to install packages whose peer ranges do not overlap, so the
// range has to accept every major version users can reasonably install
// alongside current Wrangler releases.  See also:
// https://github.com/fedify-dev/fedify/issues/1255
import { ok } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import semver from "semver";

const PACKAGE_NAME = "@cloudflare/workers-types";

async function getPeerRange() {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf-8"),
  );
  const range = manifest.peerDependencies[PACKAGE_NAME];
  if (range !== "catalog:") return range;
  // pnpm replaces `catalog:` with the range from the default catalog when
  // the package is published, so resolve it the same way:
  const workspace = await readFile(
    new URL("../../../pnpm-workspace.yaml", import.meta.url),
    "utf-8",
  );
  const pattern = new RegExp(
    `^\\s+["']?${PACKAGE_NAME.replaceAll("/", "\\/")}["']?:\\s*(.+?)\\s*$`,
    "m",
  );
  const match = workspace.match(pattern);
  ok(match != null, `${PACKAGE_NAME} is not found in the pnpm catalog.`);
  return match[1].replace(/^(["'])(.*)\1$/, "$2");
}

test(`peer dependency on ${PACKAGE_NAME}`, async () => {
  const range = await getPeerRange();
  ok(semver.validRange(range) != null, `Invalid range: ${range}`);
  for (
    const version of [
      "4.20250906.0", // The minimum version that we support.
      "4.20260702.1", // The last v4 release.
      "5.20260703.1", // The first v5 release.
      "5.20261006.1",
    ]
  ) {
    ok(
      semver.satisfies(version, range),
      `${PACKAGE_NAME}@${version} should satisfy ${range}.`,
    );
  }
  for (const version of ["4.20250905.0", "6.0.0"]) {
    ok(
      !semver.satisfies(version, range),
      `${PACKAGE_NAME}@${version} should not satisfy ${range}.`,
    );
  }
});
