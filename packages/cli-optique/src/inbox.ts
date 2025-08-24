import {
  command,
  constant,
  type InferValue,
  message,
  object,
} from "@optique/core";

export const inboxCommand = command(
  "inbox",
  object({
    command: constant("inbox"),
  }),
  {
    description:
      message`Spins up an ephemeral server that serves the ActivityPub inbox with an one-time actor, through a short-lived public DNS with HTTPS. You can monitor the incoming activities in real-time.`,
  },
);

export function runInbox(
  command: InferValue<typeof inboxCommand>,
) {
  console.debug(command);
}
