/**
 * Netlify Async Workloads integration for Fedify
 * ===============================================
 *
 * @module
 * @since 2.4.0
 */

export {
  createNetlifyQueueHandler,
  type NetlifyQueueEvent,
  type NetlifyQueueHandlerOptions,
} from "./handler.ts";
export { NetlifyBlobsKvStore } from "./kv.ts";
export {
  NetlifyMessageQueue,
  type NetlifyMessageQueueOptions,
  NetlifyMessageQueueSendError,
  type NetlifyQueueEventData,
} from "./mq.ts";
export type {
  NetlifyAsyncWorkloadsClient,
  NetlifyBlobsStore,
} from "./types.ts";
