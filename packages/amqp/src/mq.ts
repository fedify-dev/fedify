import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify";
// @deno-types="npm:@types/amqplib@^0.10.7"
import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";
import { Buffer } from "node:buffer";

/**
 * Options for ordering key support in {@link AmqpMessageQueue}.
 *
 * Ordering key support requires the `rabbitmq_consistent_hash_exchange`
 * plugin to be enabled on the RabbitMQ server.  You can enable it by running:
 *
 * ```sh
 * rabbitmq-plugins enable rabbitmq_consistent_hash_exchange
 * ```
 *
 * @since 2.0.0
 */
export interface AmqpOrderingOptions {
  /**
   * The name of the consistent hash exchange to use for ordering.
   * Defaults to `"fedify_ordering"`.
   * @default `"fedify_ordering"`
   */
  readonly exchange?: string;

  /**
   * The prefix to use for ordering queues.
   * Defaults to `"fedify_ordering_"`.
   * @default `"fedify_ordering_"`
   */
  readonly queuePrefix?: string;

  /**
   * The number of partitions (queues) to use for ordering.
   * More partitions allow better parallelism for different ordering keys.
   * Defaults to `4`.
   * @default `4`
   */
  readonly partitions?: number;
}

/**
 * Options for {@link AmqpMessageQueue}.
 */
export interface AmqpMessageQueueOptions {
  /**
   * The name of the queue to use.  Defaults to `"fedify_queue"`.
   * @default `"fedify_queue"`
   */
  readonly queue?: string;

  /**
   * The prefix to use for the delayed queue.  Defaults to `"fedify_delayed_"`.
   * Defaults to `"fedify_delayed_"`.
   * @default `"fedify_delayed_"`
   */
  readonly delayedQueuePrefix?: string;

  /**
   * Whether the queue will survive a broker restart.  Defaults to `true`.
   * @default `true`
   */
  readonly durable?: boolean;

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
  readonly nativeRetrial?: boolean;

  /**
   * Options for ordering key support.  If provided, the message queue will
   * support the `orderingKey` option in {@link MessageQueueEnqueueOptions}.
   * Messages with the same ordering key will be processed in order,
   * while messages with different ordering keys can be processed in parallel.
   *
   * This feature requires the `rabbitmq_consistent_hash_exchange` plugin
   * to be enabled on the RabbitMQ server.  See {@link AmqpOrderingOptions}
   * for more details.
   *
   * If not provided, ordering key support is disabled and any `orderingKey`
   * option passed to `enqueue()` will be ignored.
   *
   * @since 0.4.0
   */
  readonly ordering?: AmqpOrderingOptions;
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
  #ordering?: {
    exchange: string;
    queuePrefix: string;
    partitions: number;
  };
  #orderingPrepared: boolean = false;

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
    if (options.ordering != null) {
      this.#ordering = {
        exchange: options.ordering.exchange ?? "fedify_ordering",
        queuePrefix: options.ordering.queuePrefix ?? "fedify_ordering_",
        partitions: options.ordering.partitions ?? 4,
      };
    }
  }

  async #prepareQueue(channel: Channel): Promise<void> {
    await channel.assertQueue(this.#queue, {
      durable: this.#durable,
    });
  }

  #getOrderingQueueName(partition: number): string {
    return `${this.#ordering!.queuePrefix}${partition}`;
  }

  async #prepareOrdering(channel: Channel): Promise<void> {
    if (this.#ordering == null || this.#orderingPrepared) return;
    // Declare the consistent hash exchange
    await channel.assertExchange(this.#ordering.exchange, "x-consistent-hash", {
      durable: this.#durable,
    });
    // Declare and bind ordering queues with Single Active Consumer
    for (let i = 0; i < this.#ordering.partitions; i++) {
      const queueName = this.#getOrderingQueueName(i);
      await channel.assertQueue(queueName, {
        durable: this.#durable,
        arguments: {
          "x-single-active-consumer": true,
        },
      });
      // Bind with weight "1" (equal distribution)
      await channel.bindQueue(queueName, this.#ordering.exchange, "1");
    }
    this.#orderingPrepared = true;
  }

  async #getSenderChannel(): Promise<Channel> {
    if (this.#senderChannel != null) return this.#senderChannel;
    const channel = await this.#connection.createChannel();
    this.#senderChannel = channel;
    await this.#prepareQueue(channel);
    await this.#prepareOrdering(channel);
    return channel;
  }

  /**
   * Enqueues a message to be processed.
   *
   * When an `orderingKey` is provided without a `delay`, the message is routed
   * through the consistent hash exchange, ensuring messages with the same
   * ordering key are processed by the same consumer in FIFO order.
   *
   * When both `orderingKey` and `delay` are provided, the message is first
   * placed in a delay queue, then routed to the consistent hash exchange
   * after the delay expires.  This ensures ordering is preserved even for
   * delayed messages.
   *
   * @param message The message to enqueue.
   * @param options The options for enqueueing the message.
   */
  async enqueue(
    // deno-lint-ignore no-explicit-any
    message: any,
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    const channel = await this.#getSenderChannel();
    const delay = options?.delay?.total("millisecond");
    const orderingKey = options?.orderingKey;

    // If ordering key is provided and ordering is enabled, use consistent hash
    if (orderingKey != null && this.#ordering != null && delay == null) {
      channel.publish(
        this.#ordering.exchange,
        orderingKey, // routing key = ordering key
        Buffer.from(JSON.stringify(message), "utf-8"),
        {
          persistent: this.#durable,
          contentType: "application/json",
        },
      );
      return;
    }

    // For delayed messages or messages without ordering key, use direct queue
    let queue: string;
    let deadLetterExchange: string | undefined;
    let deadLetterRoutingKey: string | undefined;

    if (delay == null || delay <= 0) {
      queue = this.#queue;
    } else {
      const delayStr = delay.toLocaleString("en", { useGrouping: false });
      // For delayed messages with ordering key, route to ordering exchange
      if (orderingKey != null && this.#ordering != null) {
        queue = `${this.#delayedQueuePrefix}ordering_${delayStr}`;
        deadLetterExchange = this.#ordering.exchange;
        deadLetterRoutingKey = orderingKey;
      } else {
        queue = this.#delayedQueuePrefix + delayStr;
        deadLetterExchange = "";
        deadLetterRoutingKey = this.#queue;
      }
      await channel.assertQueue(queue, {
        autoDelete: true,
        durable: this.#durable,
        deadLetterExchange,
        deadLetterRoutingKey,
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

  /**
   * Enqueues multiple messages to be processed.
   *
   * When an `orderingKey` is provided without a `delay`, the messages are
   * routed through the consistent hash exchange, ensuring messages with the
   * same ordering key are processed by the same consumer in FIFO order.
   *
   * When both `orderingKey` and `delay` are provided, the messages are first
   * placed in a delay queue, then routed to the consistent hash exchange
   * after the delay expires.  This ensures ordering is preserved even for
   * delayed messages.
   *
   * @param messages The messages to enqueue.
   * @param options The options for enqueueing the messages.
   */
  async enqueueMany(
    // deno-lint-ignore no-explicit-any
    messages: readonly any[],
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    const channel = await this.#getSenderChannel();
    const delay = options?.delay?.total("millisecond");
    const orderingKey = options?.orderingKey;

    // If ordering key is provided and ordering is enabled, use consistent hash
    if (orderingKey != null && this.#ordering != null && delay == null) {
      for (const message of messages) {
        channel.publish(
          this.#ordering.exchange,
          orderingKey, // routing key = ordering key
          Buffer.from(JSON.stringify(message), "utf-8"),
          {
            persistent: this.#durable,
            contentType: "application/json",
          },
        );
      }
      return;
    }

    // For delayed messages or messages without ordering key, use direct queue
    let queue: string;
    let deadLetterExchange: string | undefined;
    let deadLetterRoutingKey: string | undefined;

    if (delay == null || delay <= 0) {
      queue = this.#queue;
    } else {
      const delayStr = delay.toLocaleString("en", { useGrouping: false });
      // For delayed messages with ordering key, route to ordering exchange
      if (orderingKey != null && this.#ordering != null) {
        queue = `${this.#delayedQueuePrefix}ordering_${delayStr}`;
        deadLetterExchange = this.#ordering.exchange;
        deadLetterRoutingKey = orderingKey;
      } else {
        queue = this.#delayedQueuePrefix + delayStr;
        deadLetterExchange = "";
        deadLetterRoutingKey = this.#queue;
      }
      await channel.assertQueue(queue, {
        autoDelete: true,
        durable: this.#durable,
        deadLetterExchange,
        deadLetterRoutingKey,
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
    await this.#prepareOrdering(channel);
    await channel.prefetch(1);

    const messageHandler = (msg: ConsumeMessage | null) => {
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
    };

    // Consume from main queue
    const consumerTags: string[] = [];
    const reply = await channel.consume(this.#queue, messageHandler, {
      noAck: false,
    });
    consumerTags.push(reply.consumerTag);

    // Also consume from ordering queues if ordering is enabled
    if (this.#ordering != null) {
      for (let i = 0; i < this.#ordering.partitions; i++) {
        const queueName = this.#getOrderingQueueName(i);
        const orderingReply = await channel.consume(
          queueName,
          messageHandler,
          { noAck: false },
        );
        consumerTags.push(orderingReply.consumerTag);
      }
    }

    return await new Promise((resolve) => {
      if (options.signal?.aborted) resolve();
      options.signal?.addEventListener("abort", async () => {
        // Cancel all consumers
        for (const tag of consumerTags) {
          await channel.cancel(tag);
        }
        await channel.close();
        resolve();
      });
    });
  }
}
