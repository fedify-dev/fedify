import $ from "@david/dax";
import { dirname, join } from "@std/path";
import metadata from "../deno.json" with { type: "json" };

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
  await $`deno compile --allow-all --target=${target} --output=${into} ${
    join(dirname(import.meta.dirname!), "src", "mod.ts")
  }`;
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

const promises: Promise<void>[] = [];
for (const osKey in triplets) {
  const os = osKey as OS;
  for (const arch in triplets[os]) {
    const promise = pack(os, arch as Arch);
    promises.push(promise);
  }
}
await Promise.all(promises);

// cSpell: ignore cfvz
