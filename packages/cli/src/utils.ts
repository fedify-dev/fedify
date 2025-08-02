import { highlight } from "cli-highlight";
import type { Config } from "./config.ts";

export function printJson(json: unknown): void {
  const formatted = JSON.stringify(json, null, 2);
  console.log(highlight(formatted, { language: "json" }));
}

export const colorEnabled: boolean = Deno.stdout.isTerminal() &&
  !Deno.env.has("NO_COLOR");

export function formatCliObjectOutputWithColor(
  obj: unknown,
  colors?: boolean,
): string {
  const enableColors = colors ?? colorEnabled;
  return Deno.inspect(obj, { colors: enableColors });
}

export interface SharedOptions {
  cacheDir?: string;
  userAgent?: string;
  timeout?: number;
  followRedirects?: boolean;
  verbose?: boolean;
  format?: string;
  noConfig?: boolean;
}

const sharedOptions: SharedOptions = {};

export function setSharedOptions(config: Config): void {
  sharedOptions.cacheDir = config.cacheDir;
  sharedOptions.userAgent = config.http?.userAgent;
  sharedOptions.timeout = config.http?.timeout;
  sharedOptions.followRedirects = config.http?.followRedirects;
  sharedOptions.verbose = config.verbose;
  sharedOptions.format = config.format?.default;
}

export function getSharedOption<K extends keyof SharedOptions>(
  key: K,
): SharedOptions[K] {
  return sharedOptions[key];
}
