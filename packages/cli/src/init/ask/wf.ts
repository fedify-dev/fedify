import { select } from "@inquirer/prompts";
import { WEB_FRAMEWORK } from "../const.ts";
import type { WebFramework } from "../types.ts";
import webFrameworks from "../webframeworks.ts";

const fillWebFramework: //
  <T extends { webFramework?: WebFramework }>(options: T) => //
  Promise<T & { webFramework: WebFramework }> = async (options) => //
  ({
    ...options,
    webFramework: options.webFramework ?? await askWebFramework(),
  });

export default fillWebFramework;

const askWebFramework = () =>
  select<WebFramework>({
    message: "Choose the web framework to use",
    choices: WEB_FRAMEWORK.map((value) => //
    ({ name: webFrameworks[value].label, value })),
  });
