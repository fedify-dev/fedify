// Temporary regression coverage for the downstream patch from
// https://github.com/shikijs/shiki/pull/1349
// Remove this file and its mise task after Fedify upgrades to a release
// containing the fix and removes the downstream patch.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transformerTwoslash } from "@shikijs/vitepress-twoslash";
import { createMarkdownRenderer, disposeMdItInstance } from "vitepress";

const source =
  '/** **Documentation** with "quotes", &amp;, and 한글. */\nconst value = 1;\nconsole.log(value);';

describe("installed Twoslash popup optimization", () => {
  it("should optimize ordinary fences through VitePress's own highlighter", async () => {
    const html = await renderFence("ts");
    assert.match(html, /v-html=/);
    assert.ok(!html.includes("<strong>Documentation</strong>"));
    assert.ok(html.includes("Documentation"));
  });

  it("should retain popup descendants when explicitly disabled", async () => {
    const html = await renderFence("ts", false);
    assert.ok(!html.includes("v-html="));
    assert.ok(html.includes("<strong>Documentation</strong>"));
  });

  it("should retain the original output for interpolated fences", async () => {
    const html = await renderFence("ts-vue");
    assert.ok(!html.includes("v-html="));
    assert.equal(html, await renderFence("ts-vue", false));
  });
});

// Helpers
async function renderFence(
  lang: string,
  optimizePopups = true,
): Promise<string> {
  const markdown = await createMarkdownRenderer(process.cwd(), {
    theme: "github-dark",
    languages: ["ts", "js"],
    codeTransformers: [transformerTwoslash({ optimizePopups })],
  });
  try {
    return await markdown.renderAsync(
      `\`\`\`${lang} twoslash\n${source}\n\`\`\``,
    );
  } finally {
    disposeMdItInstance();
  }
}
