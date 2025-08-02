import { Command, CompletionsCommand, HelpCommand } from "@cliffy/command";
import { getFileSink } from "@logtape/file";
import { configure, getConsoleSink } from "@logtape/logtape";
import { setColorEnabled } from "@std/fmt/colors";
import { AsyncLocalStorage } from "node:async_hooks";
import metadata from "../deno.json" with { type: "json" };
import { DEFAULT_CACHE_DIR, setCacheDir } from "./cache.ts";
import { loadConfig } from "./config.ts";
import { command as inbox } from "./inbox.tsx";
import { command as init } from "./init.ts";
import { logFile, recordingSink } from "./log.ts";
import { command as lookup } from "./lookup.ts";
import { command as nodeinfo } from "./nodeinfo.ts";
import { command as tunnel } from "./tunnel.ts";
import { colorEnabled } from "./utils.ts";
import { command as webfinger } from "./webfinger.ts";

setColorEnabled(colorEnabled);

async function main() {
  const command = new Command()
    .name("fedify")
    .version(metadata.version)
    .globalEnv(
      "FEDIFY_LOG_FILE=<file:file>",
      "An optional file to write logs to.  " +
        "Regardless of -d/--debug option, " +
        "all levels of logs are written to this file.  " +
        "Note that this does not mute console logs.",
    )
    .globalOption("-d, --debug", "Enable debug mode.", {
      async action() {
        await configure({
          sinks: {
            console: getConsoleSink(),
            recording: recordingSink,
            file: logFile == null ? () => undefined : getFileSink(logFile),
          },
          filters: {},
          loggers: [
            {
              category: "fedify",
              lowestLevel: "debug",
              sinks: ["console", "recording", "file"],
            },
            {
              category: "localtunnel",
              lowestLevel: "debug",
              sinks: ["console", "file"],
            },
            {
              category: ["logtape", "meta"],
              lowestLevel: "warning",
              sinks: ["console", "file"],
            },
          ],
          reset: true,
          contextLocalStorage: new AsyncLocalStorage(),
        });
      },
    })
    .globalOption("-c, --cache-dir=<dir:file>", "Set the cache directory.")
    .globalOption(
      "-u, --user-agent <value:string>",
      "Set the User-Agent header for requests.",
    )
    .globalOption(
      "--timeout <ms:number>",
      "Set the request timeout in milliseconds.",
    )
    .globalOption(
      "--follow-redirects [flag:boolean]",
      "Follow HTTP redirects.",
    )
    .globalOption("--verbose [flag:boolean]", "Enable verbose output.")
    .globalOption("--format <format:string>", "The default output format.")
    .globalOption("--no-config [flag:boolean]", "Disable loading config file.")
    .globalAction(async (options) => {
      if (options.noConfig) {
        await setCacheDir(DEFAULT_CACHE_DIR);
        return;
      }

      const config = await loadConfig();

      options.cacheDir = options.cacheDir ?? config.cacheDir ??
        DEFAULT_CACHE_DIR;
      await setCacheDir(options.cacheDir);

      options.userAgent = options.userAgent ?? config.http?.userAgent;
      options.timeout = options.timeout ?? config.http?.timeout;
      options.followRedirects = options.followRedirects ??
        config.http?.followRedirects ?? false;
      options.verbose = options.verbose ?? config.verbose ?? false;
      options.format = options.format ?? config.format?.default;
    })
    .default("help")
    .command("init", init)
    .command("lookup", lookup)
    .command("inbox", inbox)
    .command("nodeinfo", nodeinfo)
    .command("tunnel", tunnel)
    .command("completions", new CompletionsCommand())
    .command("webfinger", webfinger)
    .command(
      "help",
      new HelpCommand().global().description(
        "Supports .fedifyrc or fedify.config.json for defaults (use --no-config to ignore).",
      ),
    );

  await command.parse(Deno.args);
}

if (import.meta.main) {
  await main();
}
