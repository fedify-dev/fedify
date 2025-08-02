export type TerminalType = "kitty" | "iterm2" | "sixel" | "none";

const KITTY_IDENTIFIERS: string[] = [
  "kitty",
  "wezterm",
  "ghostty",
  "konsole",
  "warp",
  "wayst",
  "st",
];

type KittyCommand = Record<string, string | number>;

export function detectTerminalCapabilities(): TerminalType {
  const term = (Deno.env.get("TERM") || "").toLowerCase();
  const termProgram = (Deno.env.get("TERM_PROGRAM") || "").toLowerCase();
  const combinedTerm = `${term}|${termProgram}`;

  for (const id of KITTY_IDENTIFIERS) {
    if (combinedTerm.includes(id)) {
      return "kitty";
    }
  }

  if (termProgram === "iterm.app") {
    return "iterm2";
  }

  if (term.includes("sixel")) {
    return "sixel";
  }
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

export function renderImageKitty(
  data: Uint8Array,
  cmd: KittyCommand,
): void {
  const base64Data = btoa(String.fromCharCode(...data));
  let remaining = base64Data;
  let isFirst = true;

  while (remaining.length > 0) {
    const chunk = remaining.slice(0, 4096);
    remaining = remaining.slice(4096);

    const chunkCmd = {
      ...(isFirst ? cmd : {}),
      m: remaining.length > 0 ? 1 : 0, // The required 'm' property
    };
    chunkCmd.m = remaining.length > 0 ? 1 : 0;
    const command = serializeGrCommand(chunkCmd, chunk);

    Deno.stdout.writeSync(command);

    isFirst = false;
  }
}

export async function renderImageITerm2(
  imagePath: string,
): Promise<void> {
  const imageData = await Deno.readFile(imagePath);
  const base64Data = btoa(String.fromCharCode(...imageData));

  const encoder = new TextEncoder();
  const command = encoder.encode(
    `\x1b]1337;File=inline=1:${base64Data}\x07\n`,
  );
  Deno.stdout.writeSync(command);
}

// Image download using Deno's fetch
export async function downloadImage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const imageData = new Uint8Array(await response.arrayBuffer());

    // Create temp file
    const tempDir = Deno.env.get("TMPDIR") || Deno.env.get("TMP") || "/tmp";
    const filename = `terminal_image_${Date.now()}_${
      Math.random().toString(36).substr(2, 9)
    }`;
    const extension = new URL(url).pathname.split(".").pop() || "jpg";
    const tempPath = `${tempDir}/${filename}.${extension}`;

    await Deno.writeFile(tempPath, imageData);

    return tempPath;
  } catch (_error) {
    return null;
  }
}

export async function renderImage(imageUrls: URL[]): Promise<void> {
  const graphicsProtocol = await detectTerminalCapabilities();
  for (const url of imageUrls) {
    const tempPath = await downloadImage(url.toString());
    if (!tempPath) {
      continue;
    }
    if (graphicsProtocol.includes("kitty")) {
      const imageData = await Deno.readFile(tempPath);
      await renderImageKitty(imageData, {
        a: "T",
        f: 100,
      });
    } else if (graphicsProtocol.includes("iterm2")) {
      await renderImageITerm2(tempPath);
    }
  }
}
