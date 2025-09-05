import {
  command,
  constant,
  type InferValue,
  merge,
  message,
  object,
} from "@optique/core";
import { debugOption } from "./globals.ts";

export const inboxCommand = command(
  "inbox",
  merge(
    object({
      command: constant("inbox"),
    }),
    debugOption,
  ),
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
