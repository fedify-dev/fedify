import { execFile } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import {
  access,
  chmod,
  constants,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const platforms = {
  darwin: {
    arm64: "macos-aarch64.tar.xz",
    x64: "macos-x86_64.tar.xz",
  },
  linux: {
    arm64: "linux-aarch64.tar.xz",
    x64: "linux-x86_64.tar.xz",
  },
  win32: {
    arm64: "windows-x86_64.zip",
    x64: "windows-x86_64.zip",
  },
};

export async function main(version) {
  const filename = fileURLToPath(import.meta.url);
  const dirName = dirname(dirname(filename));
  const packageJson = await readFile(join(dirName, "package.json"), {
    encoding: "utf8",
  });
  const pkg = JSON.parse(packageJson);
  const binDir = join(dirName, "bin");
  await mkdir(binDir, { recursive: true });
  await install(version ?? pkg.version, binDir);
}

async function install(version, targetDir) {
  const downloadUrl = getDownloadUrl(version);
  const downloadPath = await download(downloadUrl);
  if (downloadPath == null) {
    throw new Error(`Failed to download from ${downloadUrl}`);
  }
  let extractPath;
  if (downloadPath.endsWith(".zip")) {
    extractPath = await extractZip(downloadPath);
  } else {
    extractPath = await extractTar(downloadPath);
  }
  const exePath = join(extractPath, "fedify.exe");
  if (await isFile(exePath)) {
    const targetPath = join(targetDir, "fedify.exe");
    await copyFile(exePath, targetPath);
    return targetPath;
  }
  const binPath = join(extractPath, "fedify");
  if (await isFile(binPath)) {
    const targetPath = join(targetDir, "fedify");
    await copyFile(binPath, targetPath);
    await chmod(targetPath, 0o755);
    return targetPath;
  }
  throw new Error("Executable not found in the archive");
}

function getDownloadUrl(version) {
  const platform = platforms[process.platform];
  if (!platform) {
    console.error("Unsupported platform:", process.platform);
    return;
  }
  const suffix = platform[process.arch];
  if (!suffix) {
    console.error("Unsupported architecture:", process.arch);
    return;
  }
  const filename = `fedify-cli-${version}-${suffix}`;
  const url =
    `https://github.com/fedify-dev/fedify/releases/download/${version}/${filename}`;
  return url;
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    console.error("Download failed:", response.statusText);
    return;
  }
  const tmpDir = await mkdtemp(join(tmpdir(), `fedify-`));
  const filename = url.substring(url.lastIndexOf("/") + 1);
  const downloadPath = join(tmpDir, filename);
  const fileStream = createWriteStream(downloadPath);
  const readable = Readable.fromWeb(response.body);
  await new Promise((resolve, reject) => {
    readable.pipe(fileStream);
    readable.on("error", reject);
    fileStream.on("finish", resolve);
  });
  return downloadPath;
}

async function extractZip(path) {
  const dir = await mkdtemp(join(tmpdir(), "fedify-"));
  await new Promise((resolve, reject) => {
    execFile("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Import-Module Microsoft.PowerShell.Archive;\
      Expand-Archive -LiteralPath '${path}' -DestinationPath '${dir}'`,
    ], (error, _, stderr) => {
      if (error) {
        console.error("Extraction failed:", error);
        reject(error);
        return;
      }
      if (stderr) console.warn(stderr);
      resolve();
    });
  });
  return dir;
}

async function extractTar(path) {
  const switches = {
    ".tar": "",
    ".tar.gz": "z",
    ".tgz": "z",
    ".tar.bz2": "j",
    ".tbz2": "j",
    ".tar.xz": "J",
    ".txz": "J",
  };
  let switch_ = "";
  for (const ext in switches) {
    if (path.endsWith(ext)) {
      switch_ = switches[ext];
      break;
    }
  }
  path = await realpath(path);
  const dir = await mkdtemp(join(tmpdir(), "fedify-"));
  await execTar(`xvf${switch_}`, dir, path);
  return dir;
}

function execTar(switch_, dir, path) {
  return new Promise((resolve, reject) => {
    execFile("tar", [switch_, path], { cwd: dir }, (error, _, stderr) => {
      if (error) {
        console.error("Extraction failed:", error);
        reject(error);
        return;
      }
      if (stderr) console.warn(stderr);
      resolve();
    });
  });
}

export async function isFile(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  if (existsSync(join(dirname(dirname(fileURLToPath(import.meta.url))), "deno.json"))) {
    console.error(
      "This post-install script is not intended to be run within a workspace; " +
      "skipping installation.",
    );
  } else {
    await main(process.argv[2]);
  }
}
