import { select } from "@inquirer/prompts";
import { MESSAGE_QUEUE } from "../const.ts";
import { messageQueues } from "../lib.ts";
import type { MessageQueue, PackageManager } from "../types.ts";

/**
 * Fills in the message queue by prompting the user if not provided.
 * Ensures the selected message queue is compatible with the chosen package manager.
 *
 * @param options - Initialization options possibly containing a messageQueue and packageManager
 * @returns A promise resolving to options with a guaranteed messageQueue
 */
const fillMessageQueue: //
  <T extends { messageQueue?: MessageQueue; packageManager: PackageManager }> //
  (options: T) => Promise<T & { messageQueue: MessageQueue }> = //
  async (options) => ({
    ...options,
    messageQueue: options.messageQueue ??
      await askMessageQueue(options.packageManager),
  });

export default fillMessageQueue;

const askMessageQueue = (pm: PackageManager) =>
  select<MessageQueue>({
    message: "Choose the message queue to use",
    choices: MESSAGE_QUEUE.map(choiceMessageQueue(pm)),
  });
const choiceMessageQueue = (pm: PackageManager) => (value: MessageQueue) => ({
  name: isMqSupportsPm(value, pm)
    ? value
    : `${value} (not supported with ${pm})`,
  value,
  disabled: !isMqSupportsPm(value, pm),
});
const isMqSupportsPm = (mq: MessageQueue, pm: PackageManager) =>
  messageQueues[mq].packageManagers.includes(pm);
