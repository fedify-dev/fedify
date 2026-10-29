import { message, object, option, optionNames } from "@optique/core";
import { run } from "@optique/run";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isNotFound } from "./tooling_fs.ts";
import { parse } from "yaml";
import workspaceMetadata from "../deno.json" with { type: "json" };
import fedifyMetadata from "../packages/fedify/deno.json" with { type: "json" };

const { fix, skipNext } = run(
  object("Options", {
    fix: option("-f", "--fix", {
      description:
        message`Fix package metadata version mismatches automatically.`,
    }),
    skipNext: option("--skip-next", {
      description:
        message`Skip checking the Sacho next version in changes.d/next.txt.`,
    }),
  }),
  {
    programName: "check-versions",
    brief: message`Check package and changelog versions for consistency.`,
    description:
      message`Checks that all workspace package versions match.  The Sacho next version in changes.d/next.txt is also checked when present unless ${
        optionNames(["--skip-next"])
      } is specified.`,
    help: "option",
  },
);

const workspaceMembers = [...workspaceMetadata.workspace];
const pnpmWorkspace = await readFile(
  fileURLToPath(import.meta.resolve("../pnpm-workspace.yaml")),
  "utf8",
);
const projectRoot = dirname(import.meta.dirname!);
const normalizedWorkspaceMembers = workspaceMembers.map((member) =>
  normalize(resolve(projectRoot, member))
);
for (const pkg of (parse(pnpmWorkspace) as { packages: string[] }).packages) {
  const normalizedPkg = normalize(resolve(projectRoot, pkg));
  if (normalizedWorkspaceMembers.includes(normalizedPkg)) continue;
  workspaceMembers.push(pkg);
}

let version = fedifyMetadata.version;
let mismatched = 0;
let fixed = 0;
for (const member of workspaceMembers) {
  const memberPath = join(dirname(import.meta.dirname!), member);

  // deno.json
  const denoJsonPath = join(memberPath, "deno.json");
  let denoJson: string | undefined;
  try {
    denoJson = await readFile(denoJsonPath, "utf8");
  } catch {
    denoJson = undefined;
  }
  if (denoJson != null) {
    const deno = JSON.parse(denoJson);
    if (deno.version) {
      if (version == null) version = deno.version;
      else if (version !== deno.version) {
        mismatched++;
        console.error(
          "Version mismatch in %o: expected %o, found %o",
          join(member, "deno.json"),
          version,
          deno.version,
        );
        if (fix) {
          deno.version = version;
          await writeFile(
            denoJsonPath,
            JSON.stringify(deno, null, 2) + "\n",
          );
          fixed++;
          console.error("Fixed version in %o", denoJsonPath);
        }
      }
    }
  }

  // package.json
  const pkgJsonPath = join(memberPath, "package.json");
  let pkgJson: string;
  try {
    pkgJson = await readFile(pkgJsonPath, "utf8");
  } catch {
    continue;
  }
  const pkg = JSON.parse(pkgJson);
  if (pkg.version && !pkg.private) {
    if (version == null) version = pkg.version;
    else if (version !== pkg.version) {
      mismatched++;
      console.error(
        "Version mismatch in %o: expected %o, found %o",
        join(member, "package.json"),
        version,
        pkg.version,
      );
      if (fix) {
        pkg.version = version;
        await writeFile(
          pkgJsonPath,
          JSON.stringify(pkg, null, 2) + "\n",
        );
        fixed++;
        console.error("Fixed version in %o", pkgJsonPath);
      }
    }
  }
}

if (!skipNext) {
  const nextVersionPath = join(projectRoot, "changes.d", "next.txt");
  let nextVersion: string | undefined;
  try {
    nextVersion = (await readFile(nextVersionPath, "utf8")).trim();
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  if (nextVersion != null && version !== nextVersion) {
    mismatched++;
    console.error(
      "Version mismatch in %o: expected %o, found %o",
      "changes.d/next.txt",
      version,
      nextVersion,
    );
  }
}

if (fixed > 0) {
  if (fixed === 1) {
    console.error(
      "Fixed %d version mismatch. Please commit the changes.",
      fixed,
    );
  } else {
    console.error(
      "Fixed %d version mismatches. Please commit the changes.",
      fixed,
    );
  }
}

if (mismatched > fixed) process.exitCode = 1;
