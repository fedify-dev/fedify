import type { NetlifyQueueEventData } from "./mq.ts";

/**
 * The subset of Netlify's Blobs `Store` used by this package.
 *
 * The real Netlify Blobs `Store` satisfies this interface.  The narrower
 * interface also keeps Netlify Blobs optional and makes it possible to supply
 * a test double.
 *
 * @since 2.4.0
 */
export interface NetlifyBlobsStore {
  getWithMetadata(
    key: string,
    options: {
      readonly consistency?: "eventual" | "strong";
      readonly type: "json";
    },
  ): Promise<
    {
      readonly data: unknown;
      readonly etag?: string;
      readonly metadata: Record<string, unknown>;
    } | null
  >;

  setJSON(
    key: string,
    data: unknown,
    options?:
      & {
        readonly metadata?: Record<string, unknown>;
      }
      & (
        | {
          readonly onlyIfNew?: boolean;
          readonly onlyIfMatch?: never;
        }
        | {
          readonly onlyIfMatch?: string;
          readonly onlyIfNew?: never;
        }
      ),
  ): Promise<{
    readonly etag?: string;
    readonly modified: boolean;
  }>;

  delete(key: string): Promise<void>;

  list(options: {
    readonly paginate: true;
    readonly prefix?: string;
  }): AsyncIterable<{
    readonly blobs: readonly {
      readonly key: string;
    }[];
  }>;
}

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
