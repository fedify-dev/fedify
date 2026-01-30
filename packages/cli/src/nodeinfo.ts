import { getNodeInfo } from "@fedify/fedify";
import { getUserAgent } from "@fedify/vocab-runtime";
import { createJimp } from "@jimp/core";
import webp from "@jimp/wasm-webp";
import { getLogger } from "@logtape/logtape";
import {
  argument,
  command as Command,
  constant,
  flag,
  type InferValue,
  merge,
  message,
  object,
  option,
  optional,
  or,
  string,
  text,
} from "@optique/core";
import { print, printError } from "@optique/run";
import type { ChalkInstance } from "chalk";
import { isICO, parseICO } from "icojs";
import { defaultFormats, defaultPlugins, intToRGBA } from "jimp";
import os from "node:os";
import process from "node:process";
import ora from "ora";
import { debugOption } from "./options.ts";
import { colors, formatObject } from "./utils.ts";

const logger = getLogger(["fedify", "cli", "nodeinfo"]);

export const Jimp = createJimp({
  formats: [...defaultFormats, webp],
  plugins: defaultPlugins,
});

const nodeInfoOption = optional(
  or(
    object({
      raw: flag("-r", "--raw", {
        description: message`Show NodeInfo document in the raw JSON format`,
      }),
    }),
    object({
      bestEffort: optional(flag("-b", "--best-effort", {
        description:
          message`Parse the NodeInfo document with best effort.  If the NodeInfo document is not well-formed, the option will try to parse it as much as possible.`,
      })),
      noFavicon: optional(flag("--no-favicon", {
        description: message`Disable fetching the favicon of the instance`,
      })),
      metadata: optional(flag("-m", "--metadata", {
        description:
          message`Show the extra metadata of the NodeInfo, i.e., the metadata field of the document.`,
      })),
    }),
  ),
);

const userAgentOption = optional(object({
  userAgent: option("-u", "--user-agent", string(), {
    description: message`The custom User-Agent header value.`,
  }),
}));

export const nodeInfoCommand = Command(
  "nodeinfo",
  merge(
    object({
      command: constant("nodeinfo"),
      host: argument(string({ metavar: "HOST" }), {
        description: message`Bare hostname or a full URL of the instance`,
      }),
    }),
    debugOption,
    nodeInfoOption,
    userAgentOption,
  ),
  {
    brief:
      message`Get information about a remote node using the NodeInfo protocol`,
    description:
      message`Get information about a remote node using the NodeInfo protocol.

The argument is the hostname of the remote node, or the URL of the remote node.`,
  },
);

export async function runNodeInfo(
  command: InferValue<typeof nodeInfoCommand>,
) {
  const spinner = ora({
    text: "Fetching a NodeInfo document...",
    discardStdin: false,
  }).start();

  const url = new URL(
    URL.canParse(command.host) ? command.host : `https://${command.host}`,
  );

  if ("raw" in command && command.raw) {
    const nodeInfo = await getNodeInfo(url, {
      parse: "none",
      userAgent: command.userAgent,
    });

    if (nodeInfo === undefined) {
      spinner.fail("No NodeInfo document found.");
      printError(message`No NodeInfo document found.`);
      process.exit(1);
    }
    spinner.succeed("NodeInfo document fetched.");

    print(message`${text(formatObject(nodeInfo, undefined, true))}`);
    return;
  }
  const nodeInfo = await getNodeInfo(url, {
    parse: "bestEffort" in command && command.bestEffort
      ? "best-effort"
      : "strict",
    userAgent: command.userAgent,
  });
  logger.debug("NodeInfo document: {nodeInfo}", { nodeInfo });
  if (nodeInfo == undefined) {
    spinner.fail("No NodeInfo document found or it is invalid.");
    printError(message`No NodeInfo document found or it is invalid.`);
    if (!("bestEffort" in command && command.bestEffort)) {
      printError(
        message`Use the -b/--best-effort option to try to parse the document anyway.`,
      );
    }
    process.exit(1);
  }

  let layout: string[];
  let defaultWidth = 0;

  if (!("noFavicon" in command && command.noFavicon)) {
    spinner.text = "Fetching the favicon...";
    try {
      const faviconUrl = await getFaviconUrl(url, command.userAgent);
      const response = await fetch(faviconUrl, {
        headers: {
          "User-Agent": command.userAgent == null
            ? getUserAgent()
            : command.userAgent,
        },
      });
      if (response.ok) {
        const contentType = response.headers.get("Content-Type");
        let buffer: ArrayBuffer = await response.arrayBuffer();
        if (
          contentType === "image/vnd.microsoft.icon" ||
          contentType === "image/x-icon" ||
          isICO(buffer)
        ) {
          const images = await parseICO(buffer);
          if (images.length < 1) {
            throw new Error("No images found in the ICO file.");
          }
          buffer = images[0].buffer;
        }
        const image = await Jimp.read(buffer);
        const colorSupport = checkTerminalColorSupport();
        layout = getAsciiArt(image, DEFAULT_IMAGE_WIDTH, colorSupport, colors)
          .split("\n").map((line) => ` ${line}  `);
        defaultWidth = 41;
      } else {
        logger.error(
          "Failed to fetch the favicon: {status} {statusText}",
          { status: response.status, statusText: response.statusText },
        );
        layout = [""];
      }
    } catch (error) {
      logger.error(
        "Failed to fetch or render the favicon: {error}",
        { error },
      );
      layout = [""];
    }
  } else {
    layout = [""];
  }
  spinner.succeed("NodeInfo document fetched.");
  print(message``);

  let i = 0;
  const next = () => {
    i++;
    if (i >= layout.length) layout.push(" ".repeat(defaultWidth));
    return i;
  };
  layout[i] += colors.bold(url.host);
  layout[next()] += colors.dim("=".repeat(url.host.length));
  layout[next()] += colors.bold(colors.dim("Software:"));
  layout[next()] += `  ${nodeInfo.software.name} v${nodeInfo.software.version}`;
  if (nodeInfo.software.homepage != null) {
    layout[next()] += `  ${nodeInfo.software.homepage.href}`;
  }
  if (nodeInfo.software.repository != null) {
    layout[next()] += "  " +
      colors.dim(nodeInfo.software.repository.href);
  }
  if (nodeInfo.protocols.length > 0) {
    layout[next()] += colors.bold(colors.dim("Protocols:"));
    for (const protocol of nodeInfo.protocols) {
      layout[next()] += `  ${protocol}`;
    }
  }
  if (nodeInfo.services?.inbound?.length ?? 0 > 0) {
    layout[next()] += colors.bold(colors.dim("Inbound services:"));
    for (const service of nodeInfo.services?.inbound ?? []) {
      layout[next()] += `  ${service}`;
    }
  }
  if (nodeInfo.services?.outbound?.length ?? 0 > 0) {
    layout[next()] += colors.bold(colors.dim("Outbound services:"));
    for (const service of nodeInfo.services?.outbound ?? []) {
      layout[next()] += `  ${service}`;
    }
  }
  if (
    nodeInfo.usage?.users != null && (nodeInfo.usage.users.total != null ||
      nodeInfo.usage.users.activeHalfyear != null ||
      nodeInfo.usage.users.activeMonth != null)
  ) {
    layout[next()] += colors.bold(colors.dim("Users:"));
    if (nodeInfo.usage.users.total != null) {
      layout[next()] +=
        `  ${nodeInfo.usage.users.total.toLocaleString("en-US")} ` +
        colors.dim("(total)");
    }
    if (nodeInfo.usage.users.activeHalfyear != null) {
      layout[next()] +=
        `  ${nodeInfo.usage.users.activeHalfyear.toLocaleString("en-US")} ` +
        colors.dim("(active half year)");
    }
    if (nodeInfo.usage.users.activeMonth != null) {
      layout[next()] +=
        `  ${nodeInfo.usage.users.activeMonth.toLocaleString("en-US")} ` +
        colors.dim("(active month)");
    }
  }
  if (nodeInfo.usage?.localPosts != null) {
    layout[next()] += colors.bold(colors.dim("Local posts: "));
    layout[next()] += "  " +
      nodeInfo.usage.localPosts.toLocaleString("en-US");
  }
  if (nodeInfo.usage?.localComments != null) {
    layout[next()] += colors.bold(colors.dim("Local comments:"));
    layout[next()] += "  " +
      nodeInfo.usage.localComments.toLocaleString("en-US");
  }
  if (nodeInfo.openRegistrations != null) {
    layout[next()] += colors.bold(colors.dim("Open registrations:"));
    layout[next()] += "  " + (nodeInfo.openRegistrations ? "Yes" : "No");
  }

  if (
    "metadata" in command && command.metadata && nodeInfo.metadata != null &&
    Object.keys(nodeInfo.metadata).length > 0
  ) {
    layout[next()] += colors.bold(colors.dim("Metadata:"));
    for (const [key, value] of Object.entries(nodeInfo.metadata)) {
      layout[next()] += `  ${colors.dim(key + ":")} ${
        indent(
          typeof value === "string" ? value : formatObject(value),
          defaultWidth + 4 + key.length,
        )
      }`;
    }
  }

  console.log(layout.join("\n"));
}

function indent(text: string, depth: number) {
  return text.replace(/\n/g, "\n" + " ".repeat(depth));
}

const LINK_REGEXP =
  /<link((?:\s+(?:[-a-z]+)=(?:"[^"]*"|'[^']*'|[^\s]+))*)\s*\/?>/ig;
const LINK_ATTRS_REGEXP = /(?:\s+([-a-z]+)=("[^"]*"|'[^']*'|[^\s]+))/ig;

export async function getFaviconUrl(
  url: string | URL,
  userAgent?: string,
): Promise<URL> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent == null ? getUserAgent() : userAgent,
    },
  });
  const text = await response.text();
  for (const match of text.matchAll(LINK_REGEXP)) {
    const attrs: Record<string, string> = {};
    for (const attrMatch of match[1].matchAll(LINK_ATTRS_REGEXP)) {
      const [, key, value] = attrMatch;
      attrs[key] = value.startsWith('"') || value.startsWith("'")
        ? value.slice(1, -1)
        : value;
    }
    const rel = attrs.rel?.toLowerCase()?.trim()?.split(/\s+/) ?? [];
    if (!rel.includes("icon") && !rel.includes("apple-touch-icon")) continue;
    if ("sizes" in attrs && attrs.sizes.match(/\d+x\d+/)) {
      const [w, h] = attrs.sizes.split("x").map((v) => Number.parseInt(v));
      if (w < 38 || h < 19) continue;
    }
    if ("href" in attrs) {
      if (attrs.href.endsWith(".svg")) continue;
      return new URL(attrs.href, response.url);
    }
  }
  return new URL("/favicon.ico", response.url);
}

function checkTerminalColorSupport(): "truecolor" | "256color" | "none" {
  // Check if colors are explicitly disabled
  const noColor = process.env.NO_COLOR;
  if (noColor != null && noColor !== "") {
    return "none";
  }

  // Check for true color (24-bit) support
  const colorTerm = process.env.COLORTERM;
  if (
    colorTerm != null &&
    (colorTerm.includes("24bit") || colorTerm.includes("truecolor"))
  ) {
    return "truecolor";
  }

  // Check for xterm 256-color support
  const term = process.env.TERM;
  if (
    term != null &&
    (term.includes("256color") ||
      term.includes("xterm") ||
      term === "screen" ||
      term === "tmux")
  ) {
    return "256color";
  }

  // Fallback: assume basic color support if TERM is set
  if (term != null && term !== "dumb") {
    return "256color";
  }

  // Check for Windows Terminal support
  // FIXME: WT_SESSION is not a reliable way to check for Windows Terminal support
  const isWindows = os.platform() === "win32";
  const isWT = process.env.WT_SESSION;
  if (isWindows && isWT != null && isWT !== "") {
    return "truecolor";
  }

  return "none";
}

const DEFAULT_IMAGE_WIDTH = 38;

const ASCII_CHARS =
  // cSpell: disable
  "█▓▒░@#B8&WM%*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ";
// cSpell: enable

const CUBE_VALUES = [0, 95, 135, 175, 215, 255];

const findClosestIndex = (value: number): number => {
  let minDiff = Infinity;
  let closestIndex = 0;
  for (let idx = 0; idx < CUBE_VALUES.length; idx++) {
    const diff = Math.abs(value - CUBE_VALUES[idx]);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = idx;
    }
  }
  return closestIndex;
};

export function rgbTo256Color(r: number, g: number, b: number): number {
  // Check if it's a grayscale color first (when all RGB values are very close)
  const gray = Math.round((r + g + b) / 3);
  const isGrayscale = Math.abs(r - gray) <= 5 && Math.abs(g - gray) <= 5 &&
    Math.abs(b - gray) <= 5;

  // Handle grayscale colors (colors 232-255) - but exclude exact cube values
  if (isGrayscale) {
    const isExactCubeValue = CUBE_VALUES.includes(r) && r === g && g === b;

    if (!isExactCubeValue) {
      if (gray < 8) return 232; // Darkest grayscale
      if (gray > 238) return 255; // Brightest grayscale

      // Map to grayscale range 232-255 (24 levels)
      // XTerm grayscale: 8, 18, 28, ..., 238 maps to 232, 233, 234, ..., 255
      const grayIndex = Math.round((gray - 8) / 10);
      return Math.max(232, Math.min(255, 232 + grayIndex));
    }
  }

  // Handle RGB colors (colors 16-231)
  // XTerm 256 color cube values: [0, 95, 135, 175, 215, 255]

  const r6 = findClosestIndex(r);
  const g6 = findClosestIndex(g);
  const b6 = findClosestIndex(b);

  return 16 + (36 * r6) + (6 * g6) + b6;
}

export function getAsciiArt(
  image: Awaited<ReturnType<typeof Jimp.read>>,
  width = DEFAULT_IMAGE_WIDTH,
  colorSupport: "truecolor" | "256color" | "none",
  colors: ChalkInstance,
): string {
  const ratio = image.width / image.height;
  const height = Math.round(
    width / ratio * 0.5, // Multiply by 0.5 because characters are taller than they are wide.
  );
  image.resize({ w: width, h: height });
  let art = "";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = image.getPixelColor(x, y);
      const color = intToRGBA(pixel);
      if (color.a < 1) {
        art += " ";
        continue;
      }
      const brightness = (color.r + color.g + color.b) / 3;
      const charIndex = Math.round(
        (brightness / 255) * (ASCII_CHARS.length - 1),
      );
      const char = ASCII_CHARS[charIndex];

      if (colorSupport === "truecolor") {
        art += colors.rgb(color.r, color.g, color.b)(char);
      } else if (colorSupport === "256color") {
        const colorIndex = rgbTo256Color(color.r, color.g, color.b);
        art += colors.ansi256(colorIndex)(char);
      } else {
        art += char;
      }
    }
    if (y < height - 1) art += "\n";
  }
  return art;
}
