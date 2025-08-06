import type { Activity } from "@fedify/fedify";
import type { LogRecord } from "@logtape/logtape";

export interface ActivityEntry {
  timestamp: Temporal.Instant;
  request: Request;
  response?: Response;
  activity?: Activity;
  logs: LogRecord[];
}
