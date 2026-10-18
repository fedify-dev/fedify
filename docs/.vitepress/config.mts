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
import { createFedifyTwoslashCache } from "./twoslash-cache.mts";

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
    { text: "Media upload", link: "/manual/media-upload.md" },
    { text: "Sending activities", link: "/manual/send.md" },
    { text: "Collections", link: "/manual/collections.md" },
    { text: "Conversation backfill", link: "/manual/backfill.md" },
    { text: "Object dispatcher", link: "/manual/object.md" },
    { text: "Access control", link: "/manual/access-control.md" },
    { text: "Interaction controls", link: "/manual/interaction-controls.md" },
    { text: "Portable objects", link: "/manual/portable.md" },
    { text: "WebFinger", link: "/manual/webfinger.md" },
    { text: "NodeInfo", link: "/manual/nodeinfo.md" },
    { text: "URI Template", link: "/manual/uri-template.md" },
    { text: "Pragmatics", link: "/manual/pragmatics.md" },
    { text: "Key–value store", link: "/manual/kv.md" },
    { text: "Message queue", link: "/manual/mq.md" },
    { text: "Background tasks", link: "/manual/tasks.md" },
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
      { text: "Team", link: "/team.md" },
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
      { text: "Team", link: "/team.md" },
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
          svg: readFileSync(
            new URL("../public/icons/hackers-pub.svg", import.meta.url),
            "utf8",
          ),
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
        typesCache: createFedifyTwoslashCache(),
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
