import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify";
// @deno-types="npm:@types/amqplib@^0.10.7"
import type { Channel, ChannelModel } from "amqplib";
import { Buffer } from "node:buffer";

/**
 * Options for {@link AmqpMessageQueue}.
 */
export interface AmqpMessageQueueOptions {
  /**
   * The name of the queue to use.  Defaults to `"fedify_queue"`.
   * @default `"fedify_queue"`
   */
  queue?: string;

  /**
   * The prefix to use for the delayed queue.  Defaults to `"fedify_delayed_"`.
   * Defaults to `"fedify_delayed_"`.
   * @default `"fedify_delayed_"`
   */
  delayedQueuePrefix?: string;

  /**
   * Whether the queue will survive a broker restart.  Defaults to `true`.
   * @default `true`
   */
  durable?: boolean;

  /**
   * Whether to use native retrial mechanism. If set to `true`, the queue will
   * not acknowledge messages that are not processed successfully, allowing
   * them to be retried later. If set to `false`, messages will be acknowledged
   * whether they are processed successfully or not.
   *
   * Both approaches have their own advantages and disadvantages.  With native
   * retrials, much less chance of losing messages, but timing of retrials is
   * less predictable.  With non-native retrials, retrials are handled by Fedify
   * itself, which allows for more control over the timing and behavior of
   * retrials, but may result in lost messages if the process crashes before
   * acknowledging the message.
   * @default `false`
   * @since 0.3.0
   */
  nativeRetrial?: boolean;
}

/**
 * A message queue that uses AMQP.
 *
 * @example
 * ``` typescript
 * import { createFederation } from "@fedify/fedify";
 * import { AmqpMessageQueue } from "@fedify/amqp";
 * import { connect } from "amqplib";
 *
 * const federation = createFederation({
 *   queue: new AmqpMessageQueue(await connect("amqp://localhost")),
 *   // ... other configurations
 * });
 * ```
 */
export class AmqpMessageQueue implements MessageQueue {
  #connection: ChannelModel;
  #queue: string;
  #delayedQueuePrefix: string;
  #durable: boolean;
  #senderChannel?: Channel;

  readonly nativeRetrial: boolean;

  /**
   * Creates a new `AmqpMessageQueue`.
   * @param connection A connection to the AMQP server.
   * @param options Options for the message queue.
   */
  constructor(
    connection: ChannelModel,
    options: AmqpMessageQueueOptions = {},
  ) {
    this.#connection = connection;
    this.#queue = options.queue ?? "fedify_queue";
    this.#delayedQueuePrefix = options.delayedQueuePrefix ?? "fedify_delayed_";
    this.#durable = options.durable ?? true;
    this.nativeRetrial = options.nativeRetrial ?? false;
  }

  async #prepareQueue(channel: Channel): Promise<void> {
    await channel.assertQueue(this.#queue, {
      durable: this.#durable,
    });
  }

  async #getSenderChannel(): Promise<Channel> {
    if (this.#senderChannel != null) return this.#senderChannel;
    const channel = await this.#connection.createChannel();
    this.#senderChannel = channel;
    this.#prepareQueue(channel);
    return channel;
  }

  async enqueue(
    // deno-lint-ignore no-explicit-any
    message: any,
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    const channel = await this.#getSenderChannel();
    const delay = options?.delay?.total("millisecond");
    let queue: string;
    if (delay == null || delay <= 0) {
      queue = this.#queue;
    } else {
      const delayStr = delay.toLocaleString("en", { useGrouping: false });
      queue = this.#delayedQueuePrefix + delayStr;
      await channel.assertQueue(queue, {
        autoDelete: true,
        durable: this.#durable,
        deadLetterExchange: "",
        deadLetterRoutingKey: this.#queue,
        messageTtl: delay,
      });
    }
    channel.sendToQueue(
      queue,
      Buffer.from(JSON.stringify(message), "utf-8"),
      {
        persistent: this.#durable,
        contentType: "application/json",
      },
    );
  }

  async enqueueMany(
    // deno-lint-ignore no-explicit-any
    messages: any[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    const channel = await this.#getSenderChannel();
    const delay = options?.delay?.total("millisecond");
    let queue: string;
    if (delay == null || delay <= 0) {
      queue = this.#queue;
    } else {
      const delayStr = delay.toLocaleString("en", { useGrouping: false });
      queue = this.#delayedQueuePrefix + delayStr;
      await channel.assertQueue(queue, {
        autoDelete: true,
        durable: this.#durable,
        deadLetterExchange: "",
        deadLetterRoutingKey: this.#queue,
        messageTtl: delay,
      });
    }

    for (const message of messages) {
      channel.sendToQueue(
        queue,
        Buffer.from(JSON.stringify(message), "utf-8"),
        {
          persistent: this.#durable,
          contentType: "application/json",
        },
      );
    }
  }

  async listen(
    // deno-lint-ignore no-explicit-any
    handler: (message: any) => void | Promise<void>,
    options: MessageQueueListenOptions = {},
  ): Promise<void> {
    const channel = await this.#connection.createChannel();
    await this.#prepareQueue(channel);
    await channel.prefetch(1);
    const reply = await channel.consume(this.#queue, (msg) => {
      if (msg == null) return;
      const message = JSON.parse(msg.content.toString("utf-8"));
      try {
        const result = handler(message);
        if (result instanceof Promise) {
          if (this.nativeRetrial) {
            result
              .then(() => channel.ack(msg))
              .catch(() => channel.nack(msg, undefined, true));
          } else {
            result.finally(() => channel.ack(msg));
          }
        } else if (this.nativeRetrial) {
          channel.ack(msg);
        }
      } catch {
        if (this.nativeRetrial) {
          channel.nack(msg, undefined, true);
        }
      } finally {
        if (!this.nativeRetrial) {
          channel.ack(msg);
        }
      }
    }, {
      noAck: false,
    });
    return await new Promise((resolve) => {
      if (options.signal?.aborted) resolve();
      options.signal?.addEventListener("abort", () => {
        channel.cancel(reply.consumerTag).then(() => {
          channel.close().then(() => resolve());
        });
      });
    });
  }
}
