import type { AsyncWorkloadConfig } from "@netlify/async-workloads";
import {
  createNetlifyQueueHandler,
  type NetlifyQueueEvent,
} from "@fedify/netlify";
import { builder, type ContextData } from "../../src/lib/federation.ts";
import { createNetlifyServices } from "../../src/lib/runtime.ts";

const { kv, queue } = createNetlifyServices();

export default createNetlifyQueueHandler<ContextData>({
  queue,
  maxRetries: 6,
  federation: () =>
    builder.build({
      kv,
      queue,
      manuallyStartQueue: true,
    }),
  contextData: (event) => ({
    kv,
    deployId: event.request.headers.get("x-nf-deploy-id") ?? undefined,
  }),
});

export const asyncWorkloadConfig: AsyncWorkloadConfig<NetlifyQueueEvent> = {
  events: [queue.eventName],
  maxRetries: 6,
  backoffSchedule: (attempt) => 5_000 * 2 ** attempt,
  status: process.env.CONTEXT === "production" ? undefined : "disabled",
};
