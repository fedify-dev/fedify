import { Command, CompletionsCommand, HelpCommand } from "@cliffy/command";
import { getFileSink } from "@logtape/file";
import { configure, getConsoleSink } from "@logtape/logtape";
import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_CACHE_DIR, setCacheDir } from "./cache.ts";
import metadata from "./deno.json" with { type: "json" };
import { command as debug } from "./debug.tsx";
import { command as inbox } from "./inbox.tsx";
import { command as init } from "./init.ts";
import { logFile, recordingSink } from "./log.ts";
import { command as lookup } from "./lookup.ts";
import { command as node } from "./node.ts";
import { command as tunnel } from "./tunnel.ts";
import { command as webfinger } from "./webfinger.ts";

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
  .globalOption("-c, --cache-dir=<dir:file>", "Set the cache directory.", {
    default: DEFAULT_CACHE_DIR,
    async action(options) {
      await setCacheDir(options.cacheDir);
    },
  })
  .default("help")
  .command("debug", debug)
  .command("init", init)
  .command("lookup", lookup)
  .command("inbox", inbox)
  .command("node", node)
  .command("tunnel", tunnel)
  .command("completions", new CompletionsCommand())
  .command("webfinger", webfinger)
  .command("help", new HelpCommand().global());

if (import.meta.main) {
  await command.parse(Deno.args);
}
