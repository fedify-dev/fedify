import {
  argument,
  command,
  constant,
  type InferValue,
  message,
  multiple,
  object,
  option,
  optional,
  string,
  withDefault,
} from "@optique/core";
import { lookupObject } from "@fedify/fedify/vocab";
import type * as vocab from "@fedify/fedify/vocab";
import ora from "ora";

export const lookupCommand = command(
  "lookup",
  object({
    command: constant("lookup"),
    traverse: option("-t", "--traverse", {
      description:
        message`Traverse the given collection to fetch all items. If it is turned on, the argument cannot be multiple.`,
    }),
    userAgent: optional(
      option("-u", "--user-agent", string({ metavar: "USER_AGENT" }), {
        description: message`The custom User-Agent header value.`,
      }),
    ),
    separator: withDefault(
      option("-s", "--separator", string({ metavar: "SEPARATOR" }), {
        description:
          message`Specify the separator between adjacent output objects or collection items.`,
      }),
      "----",
    ),
    urls: multiple(
      argument(string({ metavar: "URL_OR_HANDLE" }), {
        description: message`One or more URLs or handles to look up.`,
      }),
      { min: 1 },
    ),
  }),
  {
    description:
      message`Look up an Activity Streams object by URL or the actor handle. The argument can be either a URL or an actor handle (e.g., @username@domain), and it can be multiple.`,
  },
);

export async function runLookup(command: InferValue<typeof lookupCommand>) {
  const spinner = ora({
    text: `Looking up the ${
      command.traverse
        ? "collection"
        : command.urls.length > 1
        ? "objects"
        : "object"
    }...`,
    discardStdin: false,
  }).start();
  const objects: vocab.Object[] = [];
  for (const url of command.urls) {
    const obj = await lookupObject(url, {
      userAgent: command.userAgent,
    });
    if (obj) objects.push(obj);
  }
  spinner.stop();
  let i = 0;
  for (const obj of objects) {
    if (i > 0) console.log(command.separator);
    console.log(obj);
    i++;
  }
}
