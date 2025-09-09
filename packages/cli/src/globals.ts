import { message, object, option } from "@optique/core";
import { configure, getConsoleSink } from "@logtape/logtape";
import { getFileSink } from "@logtape/file";
import { recordingSink } from "./log.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import process from "node:process";

export const debugOption = object("Global options", {
  debug: option("-d", "--debug", {
    description: message`Enable debug mode.`,
  }),
});

export async function configureLogging() {
  const logFile = process.env["FEDIFY_LOG_FILE"];
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
        sinks: ["console", "recording", "file"],
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
}
