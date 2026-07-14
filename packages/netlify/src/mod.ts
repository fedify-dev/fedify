/**
 * Netlify Async Workloads integration for Fedify
 * ===============================================
 *
 * @module
 * @since 2.4.0
 */

export {
  NetlifyMessageQueue,
  type NetlifyMessageQueueOptions,
  NetlifyMessageQueueSendError,
  type NetlifyQueueEventData,
} from "./mq.ts";
export {
  createNetlifyQueueHandler,
  type NetlifyQueueEvent,
  type NetlifyQueueHandlerOptions,
} from "./handler.ts";
export type { NetlifyAsyncWorkloadsClient } from "./types.ts";
