import { assertEquals } from "@std/assert";
import fetchMock from "fetch-mock";
import { getAsciiArt, getFaviconUrl, Jimp, rgbTo256Color } from "./node.ts";

const HTML_WITH_SMALL_ICON = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  </head>
<body>Test</body>
</html>
`;

Deno.test("getFaviconUrl - small favicon.ico and apple-touch-icon.png", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/", {
    body: HTML_WITH_SMALL_ICON,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://example.com/");
  assertEquals(result.href, "https://example.com/apple-touch-icon.png");

  fetchMock.hardReset();
});

const HTML_WITH_ICON = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
  <link rel="icon" href="/favicon.ico" sizes="64x64">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  </head>
<body>Test</body>
</html>
`;

Deno.test("getFaviconUrl - favicon.ico and apple-touch-icon.png", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/", {
    body: HTML_WITH_ICON,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://example.com/");
  assertEquals(result.href, "https://example.com/favicon.ico");

  fetchMock.hardReset();
});

const HTML_WITH_SVG_ONLY = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
  <link rel="icon" href="/icon.svg" type="image/svg+xml">  
  </head>
<body>Test</body>
</html>
`;

Deno.test("getFaviconUrl - svg icons only falls back to /favicon.ico", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/", {
    body: HTML_WITH_SVG_ONLY,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://example.com/");
  assertEquals(result.href, "https://example.com/favicon.ico");

  fetchMock.hardReset();
});

const HTML_WITHOUT_ICON = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
</head>
<body>Test</body>
</html>
`;

Deno.test("getFaviconUrl - falls back to /favicon.ico", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/", {
    body: HTML_WITHOUT_ICON,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://example.com/");
  assertEquals(result.href, "https://example.com/favicon.ico");

  fetchMock.hardReset();
});

Deno.test("rgbTo256Color - check RGB cube", () => {
  const CUBE_VALUES = [0, 95, 135, 175, 215, 255];
  const colors: Array<{ r: number; g: number; b: number }> = [];

  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        colors.push({
          r: CUBE_VALUES[r],
          g: CUBE_VALUES[g],
          b: CUBE_VALUES[b],
        });
      }
    }
  }

  // Expected color indices for the above colors (16-231)
  // RGB cube: 6x6x6 = 216 colors, indices 16-231
  const expected_color_idx = Array.from(
    { length: colors.length },
    (_, i) => 16 + i,
  );

  const results = colors.map((color) =>
    rgbTo256Color(color.r, color.g, color.b)
  );
  assertEquals(results, expected_color_idx);
});

Deno.test("rgbTo256Color - check grayscale", () => {
  const grayscale = Array.from({ length: 24 }).map(
    (_, idx) => ({
      r: 8 + idx * 10,
      g: 8 + idx * 10,
      b: 8 + idx * 10,
    }),
  );

  const expected_gray_idx = Array.from(
    { length: grayscale.length },
    (_, i) => 232 + i,
  );

  const results = grayscale.map((GRAY) =>
    rgbTo256Color(GRAY.r, GRAY.g, GRAY.b)
  );
  assertEquals(results, expected_gray_idx);
});

async function createTestImage(
  color: number,
): Promise<Awaited<ReturnType<typeof Jimp.read>>> {
  const image = new Jimp({ width: 1, height: 1, color });
  const imageBuffer = await image.getBuffer("image/webp");
  return Jimp.read(imageBuffer);
}

Deno.test("getAsciiArt - Darkest Letter without color support", async () => {
  const blackResult = getAsciiArt(
    await createTestImage(0x000000ff),
    1,
    "none",
  );

  assertEquals(blackResult, "█");
});

Deno.test("getAsciiArt - Brightest Letter without color support", async () => {
  const whiteResult = getAsciiArt(
    await createTestImage(0xffffffff),
    1,
    "none",
  );

  assertEquals(whiteResult, " ");
});

Deno.test("getAsciiArt - Darkest Letter with 256 color support", async () => {
  const blackResult = getAsciiArt(
    await createTestImage(0x000000ff),
    1,
    "256color",
  );

  assertEquals(blackResult, "\u001b[38;5;16m█\u001b[39m");
});

Deno.test("getAsciiArt - Brightest Letter with 256 color support", async () => {
  const whiteResult = getAsciiArt(
    await createTestImage(0xffffffff),
    1,
    "256color",
  );

  assertEquals(whiteResult, "\u001b[38;5;231m \u001b[39m");
});

Deno.test("getAsciiArt - Darkest Letter with true color support", async () => {
  const blackResult = getAsciiArt(
    await createTestImage(0x000000ff),
    1,
    "truecolor",
  );

  assertEquals(blackResult, "\u001b[38;2;0;0;0m█\u001b[39m");
});

Deno.test("getAsciiArt - Brightest Letter with true color support", async () => {
  const whiteResult = getAsciiArt(
    await createTestImage(0xffffffff),
    1,
    "truecolor",
  );

  assertEquals(whiteResult, "\u001b[38;2;255;255;255m \u001b[39m");
});
