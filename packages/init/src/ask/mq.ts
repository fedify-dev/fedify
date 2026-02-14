import { pipe, tap, throwError, unless, when } from "@fxts/core/index.js";
import { select } from "@inquirer/prompts";
import { printErrorMessage } from "../utils.ts";
import { MESSAGE_QUEUE } from "../const.ts";
import { isTest, messageQueues } from "../lib.ts";
import type { MessageQueue, PackageManager } from "../types.ts";

/**
 * Fills in the message queue by prompting the user if not provided.
 * Ensures the selected message queue is compatible with the chosen package manager.
 *
 * @param options - Initialization options possibly containing a messageQueue and packageManager
 * @returns A promise resolving to options with a guaranteed messageQueue
 */
const fillMessageQueue: //
  <
    T extends {
      messageQueue?: MessageQueue;
      packageManager: PackageManager;
      testMode: boolean;
    },
  >(options: T) => Promise<MqDefined<T>> //
 = (options) =>
  pipe(
    options,
    when(isMessageQueueEmpty, askMessageQueue) as <
      T extends { messageQueue?: MessageQueue; packageManager: PackageManager },
    >(options: T) => MqDefined<T>,
    unless(
      isMqSupportsPm,
      (opt: MqDefined<typeof options>) =>
        pipe(
          opt,
          when(isTest, throwError(unmatchedWhileTesting)),
          tap(noticeUnmatched),
          fillMessageQueue,
        ),
    ),
  ) as Promise<MqDefined<typeof options>>;

export default fillMessageQueue;

type MqDefined<T> = Omit<T, "messageQueue"> & { messageQueue: MessageQueue };

const isMessageQueueEmpty = <T extends { messageQueue?: MessageQueue }>(
  options: T,
): options is T & { messageQueue: undefined } => !options.messageQueue;

const askMessageQueue = async <
  T extends { packageManager: PackageManager },
>(
  data: T,
): Promise<Omit<T, "messageQueue"> & { messageQueue: MessageQueue }> => ({
  ...data,
  messageQueue: await select<MessageQueue>({
    message: "Choose the message queue to use",
    choices: MESSAGE_QUEUE.map(choiceMessageQueue(data.packageManager)),
  }),
});

const unmatchedWhileTesting = <
  T extends { messageQueue: MessageQueue; packageManager: PackageManager },
>({ messageQueue: mq, packageManager: pm }: T) =>
  new Error(
    `Message queue '${mq}' is not compatible with package manager '${pm}'`,
  );

const noticeUnmatched = <
  T extends { messageQueue: MessageQueue; packageManager: PackageManager },
>({ messageQueue: mq, packageManager: pm }: T) => {
  printErrorMessage`Error: Message queue '${mq}' is not compatible with package manager '${pm}'`;
};

const choiceMessageQueue =
  (packageManager: PackageManager) => (messageQueue: MessageQueue) => ({
    name: isMqSupportsPm({ messageQueue, packageManager })
      ? messageQueue
      : `${messageQueue} (not supported with ${packageManager})`,
    value: messageQueue,
    disabled: !isMqSupportsPm({ messageQueue, packageManager }),
  });

const isMqSupportsPm = <
  T extends { messageQueue: MessageQueue; packageManager: PackageManager },
>({ messageQueue, packageManager }: T) =>
  messageQueues[messageQueue].packageManagers.includes(packageManager);
