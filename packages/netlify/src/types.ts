import type { NetlifyQueueEventData } from "./mq.ts";

/**
 * The subset of Netlify's `AsyncWorkloadsClient` used by this package.
 *
 * The real `AsyncWorkloadsClient` satisfies this interface.  The narrower
 * interface also makes it possible to supply a test double.
 *
 * @since 2.4.0
 */
export interface NetlifyAsyncWorkloadsClient {
  send(
    eventName: string,
    options?: {
      readonly data?: NetlifyQueueEventData;
      readonly delayUntil?: number | string;
      readonly priority?: number;
    },
  ): Promise<{
    readonly sendStatus: "succeeded" | "failed";
    readonly eventId: string;
  }>;
}
