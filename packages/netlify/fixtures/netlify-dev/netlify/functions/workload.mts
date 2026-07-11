import "temporal-polyfill/global";
import type { AsyncWorkloadConfig } from "@netlify/async-workloads";
import {
  createNetlifyQueueHandler,
  type NetlifyQueueEvent,
} from "../../../../src/mod.ts";
import {
  type ContextData,
  createServices,
  createTaskFederation,
} from "../lib/runtime.ts";

const { kv, queue } = createServices();

export default createNetlifyQueueHandler<ContextData>({
  queue,
  maxRetries: 3,
  federation: () => createTaskFederation(kv, queue).federation,
  contextData: (event) => ({ eventId: event.eventId, kv }),
});

export const asyncWorkloadConfig: AsyncWorkloadConfig<NetlifyQueueEvent> = {
  events: [queue.eventName],
  maxRetries: 3,
  backoffSchedule: () => 100,
};
