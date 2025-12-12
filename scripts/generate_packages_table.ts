import { dirname, join, normalize, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import workspaceMetadata from "../deno.json" with { type: "json" };

interface PackageInfo {
  name: string;
  hasJsr: boolean;
  hasNpm: boolean;
}

async function getPackages(): Promise<PackageInfo[]> {
  const packages: PackageInfo[] = [];
  const projectRoot = dirname(import.meta.dirname!);

  // Collect all workspace members from both deno.json and pnpm-workspace.yaml
  const workspaceMembers = [...workspaceMetadata.workspace];
  const normalizedMembers = new Set(
    workspaceMembers.map((m) => normalize(resolve(projectRoot, m))),
  );

  // Add pnpm workspace packages not already in deno.json workspace
  try {
    const pnpmWorkspace = await Deno.readTextFile(
      join(projectRoot, "pnpm-workspace.yaml"),
    );
    const pnpmConfig = parseYaml(pnpmWorkspace) as { packages?: string[] };
    if (pnpmConfig.packages) {
      for (const pkg of pnpmConfig.packages) {
        const normalizedPkg = normalize(resolve(projectRoot, pkg));
        if (!normalizedMembers.has(normalizedPkg)) {
          workspaceMembers.push(pkg);
          normalizedMembers.add(normalizedPkg);
        }
      }
    }
  } catch {
    // No pnpm-workspace.yaml or parse error
  }

  for (const member of workspaceMembers) {
    // Skip examples and docs
    if (member.includes("examples") || member === "docs") continue;

    const memberPath = join(projectRoot, member);
    const denoJsonPath = join(memberPath, "deno.json");
    const packageJsonPath = join(memberPath, "package.json");

    let name: string | null = null;
    let hasJsr = false;
    let hasNpm = false;

    // Check deno.json (for JSR publishing)
    try {
      const denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath));
      if (denoJson.name) {
        name = denoJson.name;
        hasJsr = true;
      }
    } catch {
      // No deno.json
    }

    // Check package.json (for npm publishing)
    try {
      const packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));
      if (packageJson.name && !packageJson.private) {
        hasNpm = true;
        // Use package.json name if deno.json doesn't have one
        if (!name) {
          name = packageJson.name;
        }
      }
    } catch {
      // No package.json
    }

    if (name) {
      packages.push({ name, hasJsr, hasNpm });
    }
  }

  // Sort packages: @fedify/fedify and @fedify/cli first, then alphabetically
  const priority = ["@fedify/fedify", "@fedify/cli"];
  packages.sort((a, b) => {
    const aIndex = priority.indexOf(a.name);
    const bIndex = priority.indexOf(b.name);

    // Both are priority packages
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }
    // Only a is priority
    if (aIndex !== -1) return -1;
    // Only b is priority
    if (bIndex !== -1) return 1;
    // Neither is priority, sort alphabetically
    return a.name.localeCompare(b.name);
  });

  return packages;
}

function generateTable(packages: PackageInfo[], version: string): string {
  const lines = [
    "| Package | Version | JSR | npm |",
    "| ------- | ------- | --- | --- |",
  ];

  for (const pkg of packages) {
    const linkName = pkg.name.replace("@", "").replace("/", "-");
    const jsrLink = pkg.hasJsr ? `[JSR][jsr:${linkName}]` : "";
    const npmLink = pkg.hasNpm ? `[npm][npm:${linkName}]` : "";
    lines.push(`| ${pkg.name} | ${version} | ${jsrLink} | ${npmLink} |`);
  }

  return lines.join("\n");
}

function generateLinks(
  packages: PackageInfo[],
  version: string,
  shortVersion: string,
): string {
  const lines: string[] = [];

  for (const pkg of packages) {
    const linkName = pkg.name.replace("@", "").replace("/", "-");
    if (pkg.hasJsr) {
      lines.push(`[jsr:${linkName}]: https://jsr.io/${pkg.name}@${version}`);
    }
    if (pkg.hasNpm) {
      lines.push(
        `[npm:${linkName}]: https://www.npmjs.com/package/${pkg.name}/v/${shortVersion}`,
      );
    }
  }

  return lines.join("\n");
}

if (import.meta.main) {
  const args = Deno.args;

  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: deno run -A scripts/generate_packages_table.ts [--format=<table|links|all>] <version> [short_version]",
    );
    console.log("");
    console.log("Generates a Markdown table of packages for PR comments.");
    console.log("");
    console.log("Options:");
    console.log("  --format=table   Output only the table");
    console.log("  --format=links   Output only the reference links");
    console.log("  --format=all     Output both table and links (default)");
    console.log("");
    console.log("Arguments:");
    console.log(
      "  version          Full version string (e.g., 1.0.0-pr.123.1+abc123)",
    );
    console.log(
      "  short_version    Version without build metadata (optional, derived from version if not provided)",
    );
    Deno.exit(0);
  }

  // Parse format option
  let format = "all";
  const formatArg = args.find((arg) => arg.startsWith("--format="));
  if (formatArg) {
    format = formatArg.split("=")[1];
    if (!["table", "links", "all"].includes(format)) {
      console.error(`Invalid format: ${format}`);
      Deno.exit(1);
    }
  }

  // Get positional arguments (excluding options)
  const positionalArgs = args.filter((arg) => !arg.startsWith("--"));

  if (positionalArgs.length < 1) {
    console.error("Error: version argument is required");
    console.error(
      "Usage: deno run -A scripts/generate_packages_table.ts [--format=<table|links|all>] <version> [short_version]",
    );
    Deno.exit(1);
  }

  const version = positionalArgs[0];
  const shortVersion = positionalArgs[1] ?? version.replace(/\+.*$/, "");

  const packages = await getPackages();

  if (format === "table" || format === "all") {
    console.log(generateTable(packages, version));
  }

  if (format === "all") {
    console.log("");
  }

  if (format === "links" || format === "all") {
    console.log(generateLinks(packages, version, shortVersion));
  }
}
