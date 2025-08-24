import {
  argument,
  choice,
  command,
  constant,
  float,
  type InferValue,
  message,
  multiple,
  object,
  option,
  optional,
  or,
  string,
  withDefault,
} from "@optique/core";
import { path } from "@optique/run/valueparser";
import { lookupObject } from "@fedify/fedify/vocab";
import type * as vocab from "@fedify/fedify/vocab";
import ora from "ora";

export const lookupCommand = command(
  "lookup",
  object({
    command: constant("lookup"),
    authorizedFetch: object({
      enabled: option("-a", "--authorized-fetch", {
        description: message`Sign the request with an one-time key.`,
      }),
      firstKnock: withDefault(
        option(
          "--first-knock",
          choice(["draft-cavage-http-signatures-12", "rfc9421"]),
          {
            description:
              message`The first-knock spec for -a/--authorized-fetch. It is used for the double-knocking technique.`,
          },
        ),
        "draft-cavage-http-signatures-12",
      ),
    }),
    traverse: object({
      enabled: option("-t", "--traverse", {
        description:
          message`Traverse the given collection to fetch all items. If it is turned on, the argument cannot be multiple.`,
      }),
      suppressErrors: option("-S", "--suppress-errors", {
        description:
          message`Suppress partial errors while traversing the collection`,
      }),
    }),
    format: or(
      option("-r", "--raw", {
        description: message`Print the fetched JSON-LD document as is.`,
      }),
      option("-C", "--compact", {
        description: message`Compact the fetched JSON-LD document.`,
      }),
      option("-e", "--expand", {
        description: message`Expand the fetched JSON-LD document.`,
      }),
    ),
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
    output: option(
      "-o",
      "--output",
      path({
        metavar: "OUTPUT_PATH",
        type: "file",
        allowCreate: true,
      }),
      { description: message`Specify the output file path.` },
    ),
    timeout: option(
      "-t",
      "--timeout",
      float({ min: 0, metavar: "SECONDS" }),
      { description: message`Set timeout for network requests in seconds.` },
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
