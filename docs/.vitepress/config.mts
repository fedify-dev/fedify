import taskLists from "@hackmd/markdown-it-task-lists";
import { transformerTwoslash } from "@shikijs/vitepress-twoslash";
import abbr from "markdown-it-abbr";
import deflist from "markdown-it-deflist";
import footnote from "markdown-it-footnote";
import { jsrRef } from "markdown-it-jsr-ref";
import { readFileSync } from "node:fs";
import process from "node:process";
import { ModuleKind, ModuleResolutionKind, ScriptTarget } from "typescript";
import { defineConfig } from "vitepress";
import {
  groupIconMdPlugin,
  groupIconVitePlugin,
} from "vitepress-plugin-group-icons";
import llmstxt from "vitepress-plugin-llms";
import { withMermaid } from "vitepress-plugin-mermaid";

const jsrRefVersion = process.env.JSR_REF_VERSION ?? "unstable";

// Open Graph and Twitter card images must be absolute URLs that point at the
// host actually serving the page.  The docs deploy to more than one host (the
// stable site, the unstable site, and PR previews), each built with its own
// SITEMAP_HOSTNAME, so derive the image URL from that instead of hard-coding a
// single host; otherwise non-stable deploys reference a file that only exists
// on the stable site after a release.
const docsBaseUrl = process.env.SITEMAP_HOSTNAME ?? "https://fedify.dev/";
const ogImageUrl = new URL("og.png", docsBaseUrl).href;
const jsrRefPackages = [
  ["@fedify/fedify", ".jsr-cache.json"],
  ["@fedify/vocab", ".jsr-vocab-cache.json"],
  ["@fedify/vocab-runtime", ".jsr-vocab-runtime-cache.json"],
  ["@fedify/webfinger", ".jsr-webfinger-cache.json"],
  ["@fedify/debugger", ".jsr-debugger-cache.json"],
  ["@fedify/testing", ".jsr-testing-cache.json"],
] as const;
const jsrRefPlugins = await Promise.all(
  jsrRefPackages.map(([packageName, cachePath]) =>
    jsrRef({
      package: packageName,
      version: jsrRefVersion,
      cachePath,
    })
  ),
);

let extraNav: { text: string; link: string }[] = [];
if (process.env.EXTRA_NAV_TEXT && process.env.EXTRA_NAV_LINK) {
  extraNav = [
    {
      text: process.env.EXTRA_NAV_TEXT,
      link: process.env.EXTRA_NAV_LINK,
    },
  ];
}

let plausibleScript: [string, Record<string, string>][] = [];
if (process.env.PLAUSIBLE_DOMAIN) {
  plausibleScript = [
    [
      "script",
      {
        defer: "defer",
        "data-domain": process.env.PLAUSIBLE_DOMAIN,
        src: "https://plausible.io/js/plausible.js",
      },
    ],
  ];
}

interface RootDenoConfig {
  workspace?: string[];
}

interface PackageDenoConfig {
  name?: string;
  publish?: boolean | { exclude?: string[] };
}

function getReferenceItems(): { text: string; link: string }[] {
  const repoRootUrl = new URL("../../", import.meta.url);
  const rootDenoConfig = JSON.parse(
    readFileSync(new URL("deno.json", repoRootUrl), "utf-8"),
  ) as RootDenoConfig;

  const names = new Set<string>();
  for (const workspaceEntry of rootDenoConfig.workspace ?? []) {
    if (!workspaceEntry.startsWith("./packages/")) continue;
    const packageDenoJsonUrl = new URL(
      `${workspaceEntry}/deno.json`,
      repoRootUrl,
    );
    const packageDenoConfig = JSON.parse(
      readFileSync(packageDenoJsonUrl, "utf-8"),
    ) as PackageDenoConfig;
    if (packageDenoConfig.publish === false || packageDenoConfig.name == null) {
      continue;
    }
    names.add(packageDenoConfig.name);
  }

  return Array.from(names)
    .sort((a, b) =>
      a === "@fedify/fedify"
        ? -1
        : b === "@fedify/fedify"
        ? 1
        : a.localeCompare(b)
    )
    .map((name) => ({
      text: name,
      link: `https://jsr.io/${name}/doc`,
    }));
}

const TUTORIAL = {
  text: "Tutorials",
  items: [
    { text: "Learning the basics", link: "/tutorial/basics.md" },
    { text: "Creating a microblog", link: "/tutorial/microblog.md" },
    {
      text: "Creating an image sharing service",
      link: "/tutorial/content-sharing.md",
    },
    { text: "Building a federated blog", link: "/tutorial/astro-blog.md" },
    {
      text: "Building a threadiverse community",
      link: "/tutorial/threadiverse.md",
    },
  ],
  activeMatch: "/tutorial",
};

const MANUAL = {
  text: "Manual",
  items: [
    { text: "Federation", link: "/manual/federation.md" },
    { text: "Context", link: "/manual/context.md" },
    { text: "Advanced context helpers", link: "/manual/context-advanced.md" },
    { text: "Vocabulary", link: "/manual/vocab.md" },
    { text: "Actor dispatcher", link: "/manual/actor.md" },
    { text: "Inbox listeners", link: "/manual/inbox.md" },
    { text: "Outbox listeners", link: "/manual/outbox.md" },
    { text: "Sending activities", link: "/manual/send.md" },
    { text: "Collections", link: "/manual/collections.md" },
    { text: "Conversation backfill", link: "/manual/backfill.md" },
    { text: "Object dispatcher", link: "/manual/object.md" },
    { text: "Access control", link: "/manual/access-control.md" },
    { text: "WebFinger", link: "/manual/webfinger.md" },
    { text: "NodeInfo", link: "/manual/nodeinfo.md" },
    { text: "URI Template", link: "/manual/uri-template.md" },
    { text: "Pragmatics", link: "/manual/pragmatics.md" },
    { text: "Key–value store", link: "/manual/kv.md" },
    { text: "Message queue", link: "/manual/mq.md" },
    { text: "Circuit breaker", link: "/manual/circuit-breaker.md" },
    { text: "Integration", link: "/manual/integration.md" },
    { text: "Migration", link: "/manual/migrate.md" },
    { text: "Relay", link: "/manual/relay.md" },
    { text: "Testing", link: "/manual/test.md" },
    { text: "Debugging", link: "/manual/debug.md" },
    { text: "Linting", link: "/manual/lint.md" },
    { text: "Logging", link: "/manual/log.md" },
    { text: "OpenTelemetry", link: "/manual/opentelemetry.md" },
    { text: "Monitoring", link: "/manual/monitoring.md" },
    { text: "Benchmarking", link: "/manual/benchmarking.md" },
    { text: "Deployment", link: "/manual/deploy.md" },
  ],
  activeMatch: "/manual",
};

const REFERENCES = {
  text: "References",
  items: getReferenceItems(),
};

export default withMermaid(defineConfig({
  title: "Fedify",
  description: "Fedify docs",
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Home", link: "/" },
      { text: "Installation", link: "/install.md" },
      { text: "CLI", link: "/cli.md" },
      TUTORIAL,
      MANUAL,
      REFERENCES,
      ...extraNav,
    ],

    sidebar: [
      { text: "What is Fedify?", link: "/intro.md" },
      { text: "Why Fedify?", link: "/why.md" },
      { text: "Installation", link: "/install.md" },
      {
        text: "CLI toolchain",
        link: "/cli.md",
      },
      TUTORIAL,
      MANUAL,
      REFERENCES,
      {
        text: "Examples",
        link: "https://github.com/fedify-dev/fedify/tree/main/examples",
      },
      { text: "Security policy", link: "/security.md" },
      { text: "Contribute", link: "/contribute.md" },
      { text: "Sponsors", link: "/sponsors.md" },
      { text: "Changelog", link: "/changelog.md" },
    ],

    socialLinks: [
      {
        icon: "jsr",
        link: "https://jsr.io/@fedify/fedify",
        ariaLabel: "JSR",
      },
      {
        icon: "npm",
        link: "https://www.npmjs.com/package/@fedify/fedify",
        ariaLabel: "npm",
      },
      {
        icon: "matrix",
        link: "https://matrix.to/#/#fedify:matrix.org",
        ariaLabel: "Matrix",
      },
      {
        icon: {
          svg:
            '<svg xmlns="http://www.w3.org/2000/svg" width="17.995798" height="12.67316" viewBox="0 0 17.995798 12.67316"><defs><clipPath clipPathUnits="userSpaceOnUse" id="clipPath831"><path d="M 0,982 H 1512 V 0 H 0 Z" transform="translate(-1348.062,-446.10931)" /></clipPath><clipPath clipPathUnits="userSpaceOnUse" id="clipPath833"><path d="M 0,982 H 1512 V 0 H 0 Z" transform="translate(-1349.778,-452.50481)" /></clipPath></defs><g transform="translate(-20112.718,-703.56027)"><g id="g49"><path d="M 0,0 C -2.542,-0.369 -5.396,-0.247 -5.483,0.591 -5.569,1.429 -2.68,2.344 -0.147,2.771 2.499,3.216 5.155,3.372 5.575,2.487 5.993,1.607 2.738,0.398 0,0 M -0.07,3.07 C -3.963,2.432 -6.437,1.398 -6.522,0.163 -6.59,-0.819 -4.481,-1.731 0.28,-1.046 c 5.038,0.724 7.075,2.5 6.635,3.479 -0.45,1 -2.977,1.293 -6.985,0.637" style="fill:currentColor;fill-opacity:1;fill-rule:nonzero;stroke:none" transform="matrix(1.3333333,0,0,-1.3333333,20121.416,714.52093)" clip-path="url(#clipPath831)" /><path d="m 0,0 c -0.909,0.834 -0.652,1.825 -1.553,1.825 -0.876,0 -0.62,-0.905 -1.551,-1.825 -0.623,-0.669 -2.434,-0.14 -2.434,-1.214 0,-0.924 1.364,-0.764 2.306,-1.659 0.745,-0.708 0.711,-2.045 1.679,-2.045 0.884,0 0.901,1.516 1.584,2.199 0.957,0.888 2.255,0.578 2.255,1.505 C 2.286,-0.225 0.8,-0.652 0,0" style="fill:currentColor;fill-opacity:1;fill-rule:nonzero;stroke:none" transform="matrix(1.3333333,0,0,-1.3333333,20123.704,705.9936)" clip-path="url(#clipPath833)" /></g></g></svg>',
        },
        link: "https://hackers.pub/@fedify",
        ariaLabel: "hackers.pub (ActivityPub)",
      },
      {
        icon: "opencollective",
        link: "https://opencollective.com/fedify",
        ariaLabel: "Open Collective",
      },
      {
        icon: "github",
        link: "https://github.com/fedify-dev/fedify",
        ariaLabel: "GitHub",
      },
    ],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/fedify-dev/fedify/edit/main/docs/:path",
    },

    outline: "deep",
  },

  head: [
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "192x192",
        href: "/favicon-192x192.png",
      },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
    ],
    [
      "meta",
      { property: "og:type", content: "website" },
    ],
    [
      "meta",
      { property: "og:image", content: ogImageUrl },
    ],
    [
      "meta",
      { property: "og:image:width", content: "1200" },
    ],
    [
      "meta",
      { property: "og:image:height", content: "630" },
    ],
    [
      "meta",
      { property: "og:image:type", content: "image/png" },
    ],
    [
      "meta",
      {
        property: "og:image:alt",
        content: "Fedify: an ActivityPub framework for TypeScript",
      },
    ],
    [
      "meta",
      { name: "twitter:card", content: "summary_large_image" },
    ],
    [
      "meta",
      { name: "twitter:image", content: ogImageUrl },
    ],
    [
      "meta",
      {
        name: "fediverse:creator",
        content: "@fedify@hackers.pub",
      },
    ],
    ...plausibleScript,
  ],

  cleanUrls: true,
  ignoreDeadLinks: true,
  markdown: {
    // Preload the languages that appear in fenced code blocks inside JSDoc
    // comments.  Twoslash re-highlights those snippets while rendering hover
    // tooltips, and Shiki 3 (VitePress 2) throws on a not-yet-loaded language
    // instead of lazily loading it the way the old highlighter did.  Loading a
    // canonical grammar also registers its aliases (e.g. "javascript" covers
    // "js", "bash" covers "sh").
    languages: [
      "javascript",
      "jsx",
      "typescript",
      "tsx",
      "json",
      "jsonc",
      "bash",
      "html",
      "css",
      "scss",
      "yaml",
      "toml",
      "ini",
      "xml",
      "diff",
      "http",
      "sql",
      "markdown",
      "haskell",
      "docker",
    ],
    codeTransformers: [
      transformerTwoslash({
        twoslashOptions: {
          compilerOptions: {
            moduleResolution: ModuleResolutionKind.Bundler,
            module: ModuleKind.ESNext,
            target: ScriptTarget.ESNext,
            experimentalDecorators: true, // For @fedify/nestjs
            emitDecoratorMetadata: true, // For @fedify/nestjs
            // Silences TS5101 about the `baseUrl` injected by @typescript/vfs
            // when Twoslash spins up its virtual TS environment; the option
            // is deprecated in TypeScript 6.0 and removed in 7.0.
            ignoreDeprecations: "6.0",
            lib: ["dom", "dom.iterable", "esnext"],
            types: [
              "dom",
              "dom.iterable",
              "esnext",
              "node",
              "@teidesu/deno-types/full",
              "@cloudflare/workers-types/experimental",
            ],
            // @ts-ignore: Although it's typed as string, it's actually an array
            jsx: ["react-jsx"],
            jsxImportSource: "hono/jsx",
          },
        },
      }),
    ],
    config: (md) => {
      md.use(abbr);
      md.use(deflist);
      md.use(footnote);
      md.use(taskLists);
      md.use(groupIconMdPlugin);
      // jsrRefPackages is ordered by precedence (first = highest), but a
      // later-registered jsrRef plugin overrides earlier ones when both match
      // the same reference.  Apply them in reverse so the first-listed package
      // is registered last and therefore wins.
      for (const jsrRefPlugin of jsrRefPlugins.toReversed()) {
        md.use(jsrRefPlugin);
      }
    },
  },
  sitemap: {
    hostname: process.env.SITEMAP_HOSTNAME,
  },

  vite: {
    plugins: [
      groupIconVitePlugin(),
      llmstxt({
        ignoreFilesPerOutput: {
          llmsTxt: [
            "changelog.md",
            "contribute.md",
            "README.md",
            "sponsors.md",
          ],
          llmsFullTxt: [
            "changelog.md",
            "contribute.md",
            "README.md",
            "sponsors.md",
          ],
        },
      }),
    ],
  },

  async transformHead(context) {
    return [
      [
        "meta",
        { property: "og:title", content: context.title },
      ],
      [
        "meta",
        { property: "og:description", content: context.description },
      ],
    ];
  },
}));

// cSpell: ignore shikijs teidesu
