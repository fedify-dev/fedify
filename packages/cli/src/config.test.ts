import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { Config } from "./config.ts";
import { loadConfig } from "./config.ts";

async function withTempEnv(
  testFn: (
    tempDir: string,
    homeDir: string,
  ) => Promise<void> | void,
) {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalHome = Deno.env.get("HOME");
  const originalXdgConfigHome = Deno.env.get("XDG_CONFIG_HOME");
  const originalAppData = Deno.env.get("APPDATA");
  const originalUserProfile = Deno.env.get("USERPROFILE");

  const homeDir = join(tempDir, "home");
  await Deno.mkdir(homeDir, { recursive: true });
  Deno.env.set("HOME", homeDir);
  Deno.env.set("USERPROFILE", homeDir);

  const xdgConfigDir = join(homeDir, ".config");
  await Deno.mkdir(xdgConfigDir, { recursive: true });
  Deno.env.set("XDG_CONFIG_HOME", xdgConfigDir);

  const appDataDir = join(homeDir, "AppData", "Roaming");
  await Deno.mkdir(appDataDir, { recursive: true });
  Deno.env.set("APPDATA", appDataDir);

  try {
    Deno.chdir(tempDir);
    await testFn(tempDir, homeDir);
  } finally {
    Deno.chdir(originalCwd);
    if (originalHome) {
      Deno.env.set("HOME", originalHome);
    } else {
      Deno.env.delete("HOME");
    }
    if (originalXdgConfigHome) {
      Deno.env.set("XDG_CONFIG_HOME", originalXdgConfigHome);
    } else {
      Deno.env.delete("XDG_CONFIG_HOME");
    }
    if (originalAppData) {
      Deno.env.set("APPDATA", originalAppData);
    } else {
      Deno.env.delete("APPDATA");
    }
    if (originalUserProfile) {
      Deno.env.set("USERPROFILE", originalUserProfile);
    } else {
      Deno.env.delete("USERPROFILE");
    }
    await Deno.remove(tempDir, { recursive: true });
  }
}

async function createConfigFile(
  dir: string,
  filename: string,
  config: Config | string,
) {
  const content = typeof config === "string" ? config : JSON.stringify(config);
  await Deno.writeTextFile(join(dir, filename), content);
}

Deno.test("loadConfig()", async (t) => {
  await t.step(
    "should return an empty object if no config file is found",
    async () => {
      await withTempEnv(async () => {
        const config = await loadConfig();
        assertEquals(config, {});
      });
    },
  );

  await t.step(
    "should load config from .fedifyrc in current directory",
    async () => {
      await withTempEnv(async (tempDir) => {
        const testConfig: Config = { http: { timeout: 5000 } };
        await createConfigFile(tempDir, ".fedifyrc", testConfig);
        const config = await loadConfig();
        assertEquals(config, testConfig);
      });
    },
  );

  await t.step(
    "should load config from fedify.config.json in current directory",
    async () => {
      await withTempEnv(async (tempDir) => {
        const testConfig: Config = { verbose: true };
        await createConfigFile(
          tempDir,
          "fedify.config.json",
          testConfig,
        );
        const config = await loadConfig();
        assertEquals(config, testConfig);
      });
    },
  );

  await t.step(
    "should prioritize .fedifyrc over fedify.config.json in current directory",
    async () => {
      await withTempEnv(async (tempDir) => {
        const rcConfig: Config = { http: { userAgent: "test-rc" } };
        const jsonConfig: Config = { http: { userAgent: "test-json" } };
        await createConfigFile(tempDir, ".fedifyrc", rcConfig);
        await createConfigFile(
          tempDir,
          "fedify.config.json",
          jsonConfig,
        );
        const config = await loadConfig();
        assertEquals(config, rcConfig);
      });
    },
  );

  await t.step(
    "should load config from .fedifyrc in home directory (XDG)",
    async () => {
      await withTempEnv(async () => {
        const testConfig: Config = { format: { default: "yaml" } };
        const configPath = join(
          Deno.env.get("XDG_CONFIG_HOME")!,
          "fedify",
        );
        await Deno.mkdir(configPath, { recursive: true });
        await createConfigFile(configPath, ".fedifyrc", testConfig);
        const config = await loadConfig("linux");
        assertEquals(config, testConfig);
      });
    },
  );

  await t.step(
    "should load config from .fedifyrc in home directory (Windows)",
    async () => {
      await withTempEnv(async () => {
        const testConfig: Config = { format: { default: "yaml" } };
        const configPath = join(Deno.env.get("APPDATA")!, "fedify");
        await Deno.mkdir(configPath, { recursive: true });
        await createConfigFile(configPath, ".fedifyrc", testConfig);
        const config = await loadConfig("windows");
        assertEquals(config, testConfig);
      });
    },
  );

  await t.step(
    "should prioritize current directory over home directory",
    async () => {
      await withTempEnv(async (tempDir) => {
        const currentDirConfig: Config = { cacheDir: "./current" };
        const homeDirConfig: Config = { cacheDir: "./home" };
        const homeConfigPath = join(
          Deno.env.get("XDG_CONFIG_HOME")!,
          "fedify",
        );
        await Deno.mkdir(homeConfigPath, { recursive: true });
        await createConfigFile(tempDir, ".fedifyrc", currentDirConfig);
        await createConfigFile(homeConfigPath, ".fedifyrc", homeDirConfig);
        const config = await loadConfig("linux");
        assertEquals(config, currentDirConfig);
      });
    },
  );

  await t.step(
    "should ignore malformed config and continue searching",
    async () => {
      await withTempEnv(async (tempDir) => {
        const jsonConfig: Config = { verbose: false };
        await createConfigFile(tempDir, ".fedifyrc", "not json");
        await createConfigFile(
          tempDir,
          "fedify.config.json",
          jsonConfig,
        );
        const config = await loadConfig();
        assertEquals(config, jsonConfig);
      });
    },
  );
});

Deno.test("loadConfig() applies cacheDir correctly", async () => {
  await withTempEnv(async (tempDir) => {
    const testConfig = { cacheDir: "./test-cache" };
    await createConfigFile(tempDir, "fedify.config.json", testConfig);
    const config = await loadConfig();
    assertEquals(config.cacheDir, "./test-cache");
  });
});

Deno.test("loadConfig() applies verbose correctly", async () => {
  await withTempEnv(async (tempDir) => {
    const testConfig = { verbose: true };
    await createConfigFile(tempDir, "fedify.config.json", testConfig);
    const config = await loadConfig();
    assertEquals(config.verbose, true);
  });
});
