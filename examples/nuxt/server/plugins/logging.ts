import { configure, getConsoleSink } from "@logtape/logtape";
import { AsyncLocalStorage } from "node:async_hooks";

export default defineNitroPlugin(async () => {
  await configure({
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: {
      console: getConsoleSink(),
    },
    filters: {},
    loggers: [
      {
        category: ["default", "example"],
        lowestLevel: "debug",
        sinks: ["console"],
      },
      { category: "fedify", lowestLevel: "info", sinks: ["console"] },
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"],
      },
    ],
  });
});
