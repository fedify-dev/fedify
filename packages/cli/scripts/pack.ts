import $ from "@david/dax";
import { dirname, join } from "@std/path";
import metadata from "../deno.json" with { type: "json" };
import { compileWithDownloadRetries } from "./compile.ts";

type OS = "linux" | "macos" | "windows";
type Arch = "x86_64" | "aarch64";

const triplets: Record<OS, Partial<Record<Arch, string>>> = {
  linux: {
    x86_64: "x86_64-unknown-linux-gnu",
    aarch64: "aarch64-unknown-linux-gnu",
  },
  macos: {
    x86_64: "x86_64-apple-darwin",
    aarch64: "aarch64-apple-darwin",
  },
  windows: {
    x86_64: "x86_64-pc-windows-msvc",
  },
};

async function compile(os: OS, arch: Arch, into: string): Promise<void> {
  const target = triplets[os][arch];
  if (!target) {
    throw new Error(`Unsupported os/arch: ${os}/${arch}`);
  }
  await compileWithDownloadRetries(async () => {
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "compile",
        "--allow-all",
        `--include=${join("..", "init", "src", "templates")}`,
        "--node-modules-dir=none",
        `--target=${target}`,
        `--output=${into}`,
        join(dirname(import.meta.dirname!), "src", "mod.ts"),
      ],
      stdout: "inherit",
      stderr: "piped",
    }).spawn();
    try {
      const decoder = new TextDecoder();
      let stderr = "";
      for await (const chunk of child.stderr) {
        let offset = 0;
        while (offset < chunk.length) {
          const written = await Deno.stderr.write(chunk.subarray(offset));
          if (written === 0)
            throw new Error("Cannot write CLI compiler diagnostic");
          offset += written;
        }
        // Keep enough of the final diagnostic to classify the failure, without
        // retaining the complete dependency listing from concurrent compilers.
        stderr = (stderr + decoder.decode(chunk, { stream: true })).slice(
          -65_536,
        );
      }
      stderr += decoder.decode();
      const status = await child.status;
      return { ...status, stderr };
    } catch (error) {
      try {
        child.kill("SIGKILL");
      } catch (killError) {
        if (
          !(killError instanceof Deno.errors.NotFound) &&
          !(killError instanceof Deno.errors.BadResource)
        ) {
          throw new AggregateError(
            [error, killError],
            "Cannot stop CLI compiler",
          );
        }
      }
      await child.status;
      throw error;
    }
  }, target);
}

async function pack(os: OS, arch: Arch): Promise<void> {
  const dir = await Deno.makeTempDir();
  await compile(os, arch, join(dir, "fedify"));
  await Deno.copyFile(
    join(dirname(import.meta.dirname!), "README.md"),
    join(dir, "README.md"),
  );
  await Deno.copyFile(
    join(dirname(dirname(dirname(import.meta.dirname!))), "LICENSE"),
    join(dir, "LICENSE"),
  );
  if (os === "windows") {
    const zipName = `fedify-cli-${metadata.version}-${os}-${arch}.zip`;
    await $`7z a ${zipName} fedify.exe README.md LICENSE`.cwd(dir);
    await Deno.copyFile(join(dir, zipName), zipName);
  } else {
    const tarName = `fedify-cli-${metadata.version}-${os}-${arch}.tar.xz`;
    await $`tar cfvJ ${tarName} fedify README.md LICENSE`.cwd(dir);
    await Deno.copyFile(join(dir, tarName), tarName);
  }
}

const osFilter = Deno.env.get("OS")?.toLowerCase();
const archFilter = Deno.env.get("ARCH")?.toLowerCase();

const tasks: Array<() => Promise<void>> = [];
for (const osKey in triplets) {
  const os = osKey as OS;
  if (osFilter != null && osFilter !== os) continue;
  for (const arch in triplets[os]) {
    if (archFilter != null && archFilter !== arch) continue;
    tasks.push(() => pack(os, arch as Arch));
  }
}
const maxConcurrency = parseInt(
  Deno.env.get("CONCURRENCY") ?? `${tasks.length}`,
);
const executing = new Set<Promise<void>>();
for (const task of tasks) {
  const p = task().then(() => {
    executing.delete(p);
  });
  executing.add(p);
  if (executing.size >= maxConcurrency) {
    await Promise.race(executing);
  }
}
await Promise.all(executing);

// cSpell: ignore cfvz
