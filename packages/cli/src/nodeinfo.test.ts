import { Chalk } from "chalk";
import fetchMock from "fetch-mock";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getAsciiArt,
  getFaviconUrl,
  Jimp,
  readImage,
  rgbTo256Color,
  runNodeInfo,
} from "./nodeinfo.ts";

afterEach(() => {
  fetchMock.hardReset();
});

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

test("getFaviconUrl - small favicon.ico and apple-touch-icon.png", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://8.8.8.8/", {
    body: HTML_WITH_SMALL_ICON,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://8.8.8.8/");
  assert.equal(result.href, "https://8.8.8.8/apple-touch-icon.png");
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

test("getFaviconUrl - favicon.ico and apple-touch-icon.png", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://8.8.8.8/", {
    body: HTML_WITH_ICON,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://8.8.8.8/");
  assert.equal(result.href, "https://8.8.8.8/favicon.ico");
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

test("getFaviconUrl - svg icons only falls back to /favicon.ico", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://8.8.8.8/", {
    body: HTML_WITH_SVG_ONLY,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://8.8.8.8/");
  assert.equal(result.href, "https://8.8.8.8/favicon.ico");
});

const HTML_WITH_UPPERCASE_SVG_ONLY = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
  <link rel="icon" href="/icon.SVG">
  </head>
<body>Test</body>
</html>
`;

test("getFaviconUrl - uppercase svg icons only falls back to /favicon.ico", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://8.8.8.8/", {
    body: HTML_WITH_UPPERCASE_SVG_ONLY,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://8.8.8.8/");
  assert.equal(result.href, "https://8.8.8.8/favicon.ico");
});

const HTML_WITH_UPPERCASE_SVG_WITH_QUERY = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
  <link rel="icon" href="/icon.SVG?v=1#icon">
  </head>
<body>Test</body>
</html>
`;

test("getFaviconUrl - uppercase svg icons with query and hash fall back to /favicon.ico", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://8.8.8.8/", {
    body: HTML_WITH_UPPERCASE_SVG_WITH_QUERY,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://8.8.8.8/");
  assert.equal(result.href, "https://8.8.8.8/favicon.ico");
});

const HTML_WITH_SVG_TYPE_ONLY = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
  <link rel="icon" href="/icon" type="image/svg+xml">
  </head>
<body>Test</body>
</html>
`;

test("getFaviconUrl - svg icons with type attribute only falls back to /favicon.ico", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/", {
    body: HTML_WITH_SVG_TYPE_ONLY,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://example.com/");
  assert.equal(result.href, "https://example.com/favicon.ico");
});

const HTML_WITH_SIZES_ANY_ICON = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
  <link rel="icon" href="/favicon.png" sizes="any"/>
  </head>
<body>Test</body>
</html>
`;

test("getFaviconUrl - icons with sizes='any' is selected", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/", {
    body: HTML_WITH_SIZES_ANY_ICON,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://example.com/");
  assert.equal(result.href, "https://example.com/favicon.png");
});

const HTML_WITH_MULTI_SIZE_ICON = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
  <link rel="alternate icon" type="image/x-icon" href="/multi-size-icon.ico" sizes="16x16 32x32 48x48 256x256">
  <link rel="apple-touch-icon" href="/apple-icon-180.png">
  </head>
<body>Test</body>
</html>
`;

test("getFaviconUrl - icons with multiple sizes", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/", {
    body: HTML_WITH_MULTI_SIZE_ICON,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://example.com/");
  assert.equal(result.href, "https://example.com/multi-size-icon.ico");
});

const HTML_WITH_PREFERRED_BITMAP_ICON = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.png">
  </head>
<body>Test</body>
</html>
`;

test("getFaviconUrl - prefer bitmap icons", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/", {
    body: HTML_WITH_PREFERRED_BITMAP_ICON,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://example.com/");
  assert.equal(result.href, "https://example.com/favicon.png");
});

const HTML_WITH_MULTIPLE_REL_TOKENS = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Site</title>
  <link rel="alternate icon" href="/favicon.png" sizes="64x64">
  </head>
<body>Test</body>
</html>
`;

test("getFaviconUrl - icon with multiple rel tokens", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/", {
    body: HTML_WITH_MULTIPLE_REL_TOKENS,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://example.com/");
  assert.equal(result.href, "https://example.com/favicon.png");
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

test("getFaviconUrl - falls back to /favicon.ico", async () => {
  fetchMock.spyGlobal();

  fetchMock.get("https://8.8.8.8/", {
    body: HTML_WITHOUT_ICON,
    headers: { "Content-Type": "text/html" },
  });

  const result = await getFaviconUrl("https://8.8.8.8/");
  assert.equal(result.href, "https://8.8.8.8/favicon.ico");
});

test("rgbTo256Color - check RGB cube", () => {
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
  assert.deepEqual(results, expected_color_idx);
});

test("rgbTo256Color - check grayscale", () => {
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
  assert.deepEqual(results, expected_gray_idx);
});

async function createTestImage(
  color: number,
): Promise<Awaited<ReturnType<typeof Jimp.read>>> {
  const image = new Jimp({ width: 1, height: 1, color });
  const imageBuffer = await image.getBuffer("image/png");
  return readImage(imageBuffer);
}

test("getAsciiArt - Darkest Letter without color support", async () => {
  const blackResult = getAsciiArt(
    await createTestImage(0x000000ff),
    1,
    "none",
    new Chalk({ level: 0 }),
  );

  assert.equal(blackResult, "█");
});

test("getAsciiArt - Brightest Letter without color support", async () => {
  const whiteResult = getAsciiArt(
    await createTestImage(0xffffffff),
    1,
    "none",
    new Chalk({ level: 0 }),
  );

  assert.equal(whiteResult, " ");
});

test("getAsciiArt - Darkest Letter with 256 color support", async () => {
  const blackResult = getAsciiArt(
    await createTestImage(0x000000ff),
    1,
    "256color",
    new Chalk({ level: 2 }),
  );

  assert.equal(blackResult, "\u001b[38;5;16m█\u001b[39m");
});

test("getAsciiArt - Brightest Letter with 256 color support", async () => {
  const whiteResult = getAsciiArt(
    await createTestImage(0xffffffff),
    1,
    "256color",
    new Chalk({ level: 2 }),
  );

  assert.equal(whiteResult, "\u001b[38;5;231m \u001b[39m");
});

test("getAsciiArt - Darkest Letter with true color support", async () => {
  const blackResult = getAsciiArt(
    await createTestImage(0x000000ff),
    1,
    "truecolor",
    new Chalk({ level: 3 }),
  );

  assert.equal(blackResult, "\u001b[38;2;0;0;0m█\u001b[39m");
});

test("getAsciiArt - Brightest Letter with true color support", async () => {
  const whiteResult = getAsciiArt(
    await createTestImage(0xffffffff),
    1,
    "truecolor",
    new Chalk({ level: 3 }),
  );

  assert.equal(whiteResult, "\u001b[38;2;255;255;255m \u001b[39m");
});

type FetchCall = { url: string; redirect: string | undefined };

async function withMockFetch(
  routes: Record<string, () => Response>,
  run: (calls: FetchCall[]) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (input, init) => {
    let url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    for (let redirects = 0; redirects < 20; redirects++) {
      calls.push({ url, redirect: init?.redirect });
      const route = routes[url];
      if (route == null) throw new Error("Unexpected fetch: " + url);
      const response = route();
      const location = response.headers.get("Location");
      if (
        init?.redirect !== "manual" && location != null &&
        [301, 302, 303, 307, 308].includes(response.status)
      ) {
        url = new URL(location, url).href;
        continue;
      }
      return Promise.resolve(response);
    }
    throw new Error("Too many mocked redirects");
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function nodeInfoRoutes(
  html: string,
): Record<string, () => Response> {
  return {
    "https://8.8.8.8/.well-known/nodeinfo": () =>
      Response.json({
        links: [{
          rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
          href: "https://8.8.8.8/nodeinfo/2.1",
        }],
      }),
    "https://8.8.8.8/nodeinfo/2.1": () =>
      Response.json({
        software: { name: "test", version: "1.0.0" },
        protocols: [],
        usage: { users: {} },
      }),
    "https://8.8.8.8/": () => new Response(html),
  };
}

async function runNodeInfoWithFavicon(): Promise<void> {
  await runNodeInfo({
    command: "nodeinfo",
    host: "https://8.8.8.8/",
    raw: false,
    noFavicon: false,
    metadata: false,
    bestEffort: false,
    userAgent: "Fedify test",
  });
}

test("getFaviconUrl rejects a private page before fetch", async () => {
  await withMockFetch(
    { "http://127.0.0.1:9000/": () => new Response("") },
    async (calls) => {
      await assert.rejects(() => getFaviconUrl("http://127.0.0.1:9000/"));
      assert.deepEqual(calls, []);
    },
  );
});

test("getFaviconUrl rejects a public page redirect to loopback", async () => {
  await withMockFetch(
    {
      "https://8.8.8.8/": () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1:9000/private" },
        }),
      "http://127.0.0.1:9000/private": () => new Response("private"),
    },
    async (calls) => {
      await assert.rejects(() => getFaviconUrl("https://8.8.8.8/"));
      assert.deepEqual(calls, [
        { url: "https://8.8.8.8/", redirect: "manual" },
      ]);
    },
  );
});

test("nodeinfo rejects private and non-HTTP icon URLs", async () => {
  for (
    const href of [
      "http://127.0.0.1:9000/secret",
      "http://[::1]/secret",
      "http://[::ffff:7f00:1]/secret",
      "http://2130706433/secret",
      "file:///etc/passwd",
      "data:text/plain,secret",
    ]
  ) {
    await withMockFetch(
      nodeInfoRoutes('<link rel="icon" href="' + href + '">'),
      async (calls) => {
        await runNodeInfoWithFavicon();
        assert.equal(
          calls.length,
          3,
          "No icon fetch should occur for " + href,
        );
        assert.ok(calls.every((call) => call.redirect === "manual"));
      },
    );
  }
});

test("nodeinfo rejects an icon redirect to loopback", async () => {
  const routes = nodeInfoRoutes('<link rel="icon" href="/icon.png">');
  routes["https://8.8.8.8/icon.png"] = () =>
    new Response(null, {
      status: 302,
      headers: { Location: "http://127.0.0.1:9000/secret" },
    });
  routes["http://127.0.0.1:9000/secret"] = () => new Response("private");
  await withMockFetch(routes, async (calls) => {
    await runNodeInfoWithFavicon();
    assert.deepEqual(calls.map((call) => call.url), [
      "https://8.8.8.8/.well-known/nodeinfo",
      "https://8.8.8.8/nodeinfo/2.1",
      "https://8.8.8.8/",
      "https://8.8.8.8/icon.png",
    ]);
    assert.ok(calls.every((call) => call.redirect === "manual"));
  });
});

test("nodeinfo renders a public favicon", async () => {
  const png = await new Jimp({ width: 4, height: 4, color: 0x000000ff })
    .getBuffer("image/png");
  const routes = nodeInfoRoutes('<link rel="icon" href="/icon.png">');
  routes["https://8.8.8.8/icon.png"] = () =>
    new Response(Uint8Array.from(png).buffer, {
      headers: { "Content-Type": "image/png" },
    });

  const originalLog = console.log;
  const output: string[] = [];
  console.log = (...values: unknown[]) => {
    output.push(values.join(" "));
  };
  try {
    await withMockFetch(routes, async (calls) => {
      await runNodeInfoWithFavicon();
      assert.deepEqual(calls.map((call) => call.url), [
        "https://8.8.8.8/.well-known/nodeinfo",
        "https://8.8.8.8/nodeinfo/2.1",
        "https://8.8.8.8/",
        "https://8.8.8.8/icon.png",
      ]);
      assert.ok(calls.every((call) => call.redirect === "manual"));
    });
  } finally {
    console.log = originalLog;
  }
  assert.match(output.join("\n"), /█/);
});

test("getFaviconUrl resolves fallback from final page URL", async () => {
  await withMockFetch(
    {
      "https://8.8.8.8/": () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://1.1.1.1/site" },
        }),
      "https://1.1.1.1/site": () => new Response("<html></html>"),
    },
    async (calls) => {
      const url = await getFaviconUrl("https://8.8.8.8/");
      assert.equal(url.href, "https://1.1.1.1/favicon.ico");
      assert.deepEqual(calls, [
        { url: "https://8.8.8.8/", redirect: "manual" },
        { url: "https://1.1.1.1/site", redirect: "manual" },
      ]);
    },
  );
});

test("getFaviconUrl permits five redirects but not six", async () => {
  const routes: Record<string, () => Response> = {};
  for (let i = 0; i < 6; i++) {
    routes["https://8.8.8.8/hop" + i] = () =>
      new Response(null, {
        status: 302,
        headers: { Location: "/hop" + (i + 1) },
      });
  }
  routes["https://8.8.8.8/hop5"] = () => new Response("<html></html>");
  await withMockFetch(routes, async (calls) => {
    const url = await getFaviconUrl("https://8.8.8.8/hop0");
    assert.equal(url.href, "https://8.8.8.8/favicon.ico");
    assert.equal(calls.length, 6);
    assert.ok(calls.every((call) => call.redirect === "manual"));
  });

  routes["https://8.8.8.8/hop5"] = () =>
    new Response(null, { status: 302, headers: { Location: "/hop6" } });
  await withMockFetch(routes, async (calls) => {
    await assert.rejects(
      () => getFaviconUrl("https://8.8.8.8/hop0"),
      /Too many favicon redirects/,
    );
    assert.equal(calls.length, 6);
    assert.equal(calls.some((call) => call.url.endsWith("/hop6")), false);
  });
});
