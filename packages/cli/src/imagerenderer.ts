import { encodeBase64 } from "@std/encoding/base64";
import sharp from "sharp";

export type TerminalType = "kitty" | "iterm2" | "none";

const KITTY_IDENTIFIERS: string[] = [
  "kitty",
  "wezterm",
  "konsole",
  "warp",
  "wayst",
  "st",
];

type KittyCommand = Record<string, string | number>;

export function detectTerminalCapabilities(): TerminalType {
  const termProgram = (Deno.env.get("TERM_PROGRAM") || "").toLowerCase();

  if (KITTY_IDENTIFIERS.includes(termProgram)) return "kitty";

  if (termProgram === "iterm.app") return "iterm2";

  return "none";
}

function serializeGrCommand(
  cmd: KittyCommand,
  payload?: string,
): Uint8Array {
  const cmdString = Object.entries(cmd)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");

  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  parts.push(encoder.encode("\x1b_G"));
  parts.push(encoder.encode(cmdString));

  if (payload) {
    parts.push(encoder.encode(";"));
    parts.push(encoder.encode(payload));
  }

  parts.push(encoder.encode("\x1b\\"));

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

export async function renderImageKitty(
  imagePath: string,
  cmd: KittyCommand,
): Promise<void> {
  const imageData = await Deno.readFile(imagePath);
  const base64Data = encodeBase64(imageData);
  let remaining = base64Data;
  let isFirst = true;

  while (remaining.length > 0) {
    const chunk = remaining.slice(0, 4096);
    remaining = remaining.slice(4096);

    const chunkCmd = {
      ...(isFirst ? cmd : {}),
      m: remaining.length > 0 ? 1 : 0,
    };

    const command = serializeGrCommand(chunkCmd, chunk);

    Deno.stdout.writeSync(command);

    isFirst = false;
  }
}

export async function renderImageITerm2(
  imagePath: string,
): Promise<void> {
  const imageData = await Deno.readFile(imagePath);
  const base64Data = encodeBase64(imageData);

  const encoder = new TextEncoder();
  const command = encoder.encode(
    `\x1b]1337;File=inline=1preserveAspectRatio=1:${base64Data}\x07\n`,
  );
  Deno.stdout.writeSync(command);
}

export async function downloadImage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const imageData = new Uint8Array(await response.arrayBuffer());
    const extension = new URL(url).pathname.split(".").pop() || "jpg";
    const tempPath = await Deno.makeTempFile({ suffix: `.${extension}` });

    await Deno.writeFile(tempPath, imageData);

    return tempPath;
  } catch (_error) {
    return null;
  }
}

export async function renderImages(
  imageUrls: URL[],
): Promise<void> {
  const graphicsProtocol = await detectTerminalCapabilities();
  for (const url of imageUrls) {
    const tempPath = await downloadImage(url.toString());
    if (!tempPath) {
      continue;
    }
    const resizedPath = tempPath + "_resized." +
      (tempPath.split(".").pop() || "png");

    await sharp(tempPath)
      .resize(300)
      .toFile(resizedPath);

    console.log(""); // clear the line before rendering image

    if (graphicsProtocol === "kitty") {
      await renderImageKitty(resizedPath, {
        a: "T",
        f: 100, // specify the image format is png
      });
    } else if (graphicsProtocol === "iterm2") {
      await renderImageITerm2(resizedPath);
    } else {
      continue;
    }
    console.log(""); // clear the line after rendering image
  }
}
