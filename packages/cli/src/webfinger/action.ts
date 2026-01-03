import type { ResourceDescriptor } from "@fedify/webfinger";
import {
  lookupWebFinger,
  type LookupWebFingerOptions,
} from "@fedify/webfinger";
import { formatMessage, message } from "@optique/core/message";
import { print } from "@optique/run";
import ora from "ora";
import { formatObject } from "../utils.ts";
import type { WebFingerCommand } from "./command.ts";
import { getErrorMessage, NotFoundError } from "./error.ts";
import { convertUrlIfHandle } from "./lib.ts";

export default async function runWebFinger(
  { command: _, resources, ...options }: WebFingerCommand,
) {
  await Array.fromAsync(
    resources.map((resource) => ({ resource, ...options })),
    spinnerWrapper(lookupSingleWebFinger),
  );
}

export async function lookupSingleWebFinger<
  T extends LookupWebFingerOptions & { resource: string },
>({ resource, ...options }: T): Promise<ResourceDescriptor> {
  const url = convertUrlIfHandle(resource);
  const webFinger = await lookupWebFinger(url, options) ??
    new NotFoundError(resource).throw();
  return webFinger;
}

function spinnerWrapper<F extends typeof lookupSingleWebFinger>(
  func: (...args: Parameters<F>) => ReturnType<F>,
) {
  return async (...args: Parameters<F>) => {
    const spinner = ora({
      text: `Looking up WebFinger for ${args[0]}`,
      discardStdin: false,
    }).start();
    try {
      const result = await func(...args);
      spinner.succeed(
        formatMessage(message`WebFinger found for ${args[0].resource}:`),
      );
      print([{ type: "text", text: formatObject(result) }]);
    } catch (error) {
      spinner.fail(formatMessage(getErrorMessage(args[0].resource, error)));
    }
  };
}
