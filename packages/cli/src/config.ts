import { join } from "@std/path";

interface HttpConfig {
  /** http header User-Agent */
  userAgent?: string;
  /** http request timeout */
  timeout?: number;
  /** auto follow redirects mode */
  followRedirects?: boolean;
}

interface FormatConfig {
  /** default output format */
  default?: string;
}

/**
 * @description config for cli
 * @example
 * {
 *   "http": {
 *     "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
 *     "timeout": 10000,
 *     "followRedirects": true
 *   },
 *   "format": {
 *     "default": "json"
 *   },
 *   "cacheDir": "./cache",
 *   "verbose": true
 * }
 */
export interface Config {
  /** HTTP related configuration */
  http?: HttpConfig;
  /** Output format configuration */
  format?: FormatConfig;
  /** cache directory */
  cacheDir?: string;
  /** verbose mode */
  verbose?: boolean;
}

export async function loadConfig(): Promise<Config> {
  const currentDir = Deno.cwd();
  const homeDir = Deno.env.get("HOME");

  // search config file in current directory, priority arrays
  const paths = [
    join(currentDir, ".fedifyrc"),
    join(currentDir, "fedify.config.json"),
  ];
  if (homeDir) {
    paths.push(join(homeDir, ".fedifyrc"));
    paths.push(join(homeDir, "fedify.config.json"));
  }

  for (const path of paths) {
    try {
      const text = await Deno.readTextFile(path);
      const config = JSON.parse(text);
      return config;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        continue;
      }

      console.error(`Malformed config at ${path}: ${error}`);
    }
  }

  return {};
}
