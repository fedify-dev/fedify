import { configure, getConsoleSink } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    {
      category: "fedify",
      lowestLevel: "debug",
      sinks: ["console"],
      filters: [],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
      filters: [],
    },
  ],
});
