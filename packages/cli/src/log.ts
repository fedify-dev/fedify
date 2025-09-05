import { getFileSink } from "@logtape/file";
import {
  configure,
  getConsoleSink,
  type LogRecord,
  type Sink,
} from "@logtape/logtape";
import { dirname } from "node:path";
import process from "node:process";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir } from "node:fs/promises";

export interface RecordingSink extends Sink {
  startRecording(): void;
  stopRecording(): void;
  getRecords(): LogRecord[];
}

export function getRecordingSink(): RecordingSink {
  let records: LogRecord[] = [];
  let recording = false;
  const sink: RecordingSink = (record: LogRecord) => {
    if (recording) records.push(record);
  };
  sink.startRecording = () => {
    records = [];
    recording = true;
  };
  sink.stopRecording = () => {
    recording = false;
  };
  sink.getRecords = () => [...records];
  return sink;
}

export const recordingSink = getRecordingSink();

export const logFile = process.env["FEDIFY_LOG_FILE"];
if (logFile != null) {
  await mkdir(dirname(logFile), { recursive: true });
}

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
      sinks: ["recording", "file"],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console", "file"],
    },
  ],
  contextLocalStorage: new AsyncLocalStorage(),
  reset: true,
});
