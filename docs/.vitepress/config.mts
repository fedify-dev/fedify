import { transformerTwoslash } from "@shikijs/vitepress-twoslash";
import abbr from "markdown-it-abbr";
import deflist from "markdown-it-deflist";
import footnote from "markdown-it-footnote";
import { jsrRef } from "markdown-it-jsr-ref";
import process from "node:process";
import { ModuleKind, ModuleResolutionKind, ScriptTarget } from "typescript";
import { defineConfig } from "vitepress";
import {
  groupIconMdPlugin,
  groupIconVitePlugin,
} from "vitepress-plugin-group-icons";
import llmstxt from "vitepress-plugin-llms";
import { withMermaid } from "vitepress-plugin-mermaid";

const jsrRefPlugin = await jsrRef({
  package: "@fedify/fedify",
  version: process.env.JSR_REF_VERSION ?? "unstable",
  cachePath: ".jsr-cache.json",
});

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

const TUTORIAL = {
  text: "Tutorials",
  items: [
    {
      text: "Quick demo",
      link: "https://dash.deno.com/playground/fedify-demo",
    },
    { text: "Learning the basics", link: "/tutorial/basics.md" },
    { text: "Creating a microblog", link: "/tutorial/microblog.md" },
  ],
  activeMatch: "/tutorial",
};

const MANUAL = {
  text: "Manual",
  items: [
    { text: "Federation", link: "/manual/federation.md" },
    { text: "Context", link: "/manual/context.md" },
    { text: "Vocabulary", link: "/manual/vocab.md" },
    { text: "Actor dispatcher", link: "/manual/actor.md" },
    { text: "Inbox listeners", link: "/manual/inbox.md" },
    { text: "Sending activities", link: "/manual/send.md" },
    { text: "Collections", link: "/manual/collections.md" },
    { text: "Object dispatcher", link: "/manual/object.md" },
    { text: "Access control", link: "/manual/access-control.md" },
    { text: "WebFinger", link: "/manual/webfinger.md" },
    { text: "NodeInfo", link: "/manual/nodeinfo.md" },
    { text: "URI Template", link: "/manual/uri-template.md" },
    { text: "Pragmatics", link: "/manual/pragmatics.md" },
    { text: "Key–value store", link: "/manual/kv.md" },
    { text: "Message queue", link: "/manual/mq.md" },
    { text: "Integration", link: "/manual/integration.md" },
    { text: "Relay", link: "/manual/relay.md" },
    { text: "Testing", link: "/manual/test.md" },
    { text: "Linting", link: "/manual/lint.md" },
    { text: "Logging", link: "/manual/log.md" },
    { text: "OpenTelemetry", link: "/manual/opentelemetry.md" },
    { text: "Deployment", link: "/manual/deploy.md" },
  ],
  activeMatch: "/manual",
};

const REFERENCES = {
  text: "References",
  items: [
    { text: "@fedify/fedify", link: "https://jsr.io/@fedify/fedify/doc" },
    { text: "@fedify/amqp", link: "https://jsr.io/@fedify/amqp/doc" },
    { text: "@fedify/cfworkers", link: "https://jsr.io/@fedify/cfworkers/doc" },
    { text: "@fedify/denokv", link: "https://jsr.io/@fedify/denokv/doc" },
    { text: "@fedify/express", link: "https://jsr.io/@fedify/express/doc" },
    { text: "@fedify/fastify", link: "https://jsr.io/@fedify/fastify/doc" },
    { text: "@fedify/h3", link: "https://jsr.io/@fedify/h3/doc" },
    { text: "@fedify/hono", link: "https://jsr.io/@fedify/hono/doc" },
    { text: "@fedify/koa", link: "https://jsr.io/@fedify/koa/doc" },
    { text: "@fedify/postgres", link: "https://jsr.io/@fedify/postgres/doc" },
    { text: "@fedify/redis", link: "https://jsr.io/@fedify/redis/doc" },
    { text: "@fedify/relay", link: "https://jsr.io/@fedify/relay/doc" },
    { text: "@fedify/sqlite", link: "https://jsr.io/@fedify/sqlite/doc" },
    { text: "@fedify/sveltekit", link: "https://jsr.io/@fedify/sveltekit/doc" },
    { text: "@fedify/testing", link: "https://jsr.io/@fedify/testing/doc" },
    { text: "@fedify/lint", link: "https://jsr.io/@fedify/lint/doc" },
  ],
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
        icon: "discord",
        link: "https://discord.gg/bhtwpzURwd",
        ariaLabel: "Discord",
      },
      {
        icon: {
          svg:
            '<svg xmlns="http://www.w3.org/2000/svg" width="284.054" height="284.054" viewBox="0 0 75.156 75.156" xmlns:v="https://vecta.io/nano"><g transform="matrix(1.364543 0 0 1.364543 -66.273472 -133.533664)"><circle cx="-76.107" cy="-125.398" transform="scale(-1)" r="18.701" stroke="#000" stroke-width=".087"/><path d="M59.541 117.004l-.493 1.853-3.78-1.005-.923 3.473 3.78 1.005-.493 1.853-8.763-2.329.493-1.853 3.437.913.923-3.473-3.437-.913.493-1.853zm2.828-8.898q.644.576.984 1.204.349.619.403 1.264.053.627-.182 1.251-.245.616-.77 1.203-.483.54-1.068.851-.586.293-1.223.32-.647.018-1.318-.241-.663-.269-1.306-.845-.861-.771-1.177-1.598-.325-.836-.13-1.684.196-.847.89-1.623.652-.729 1.464-1.008.812-.279 1.696-.067.875.203 1.736.974zm-3.192 3.568q.511.457.954.666.442.191.834.115.382-.084.721-.463.339-.379.372-.758.032-.398-.216-.806-.249-.427-.76-.884-.511-.457-.953-.648-.434-.201-.816-.116-.382.084-.721.463-.5.558-.34 1.161.158.585.925 1.271zm8.893-2.914l-1.635.952-4.856-8.342 1.635-.952zm3.606-1.411l-1.796.595-3.036-9.162 1.796-.595zm8.206-4.152q.005.864-.232 1.538-.224.675-.666 1.147-.429.46-1.05.705-.621.232-1.408.237-.724.005-1.348-.22-.611-.237-1.058-.692-.447-.467-.706-1.139-.246-.672-.251-1.535-.007-1.156.394-1.946.401-.803 1.161-1.226.759-.424 1.801-.43.978-.006 1.73.408.752.414 1.189 1.212.437.785.444 1.94zm-4.788.03q.004.686.147 1.155.155.456.474.696.319.227.827.223.508-.003.811-.234.316-.243.453-.701.149-.471.145-1.157-.004-.686-.16-1.142-.143-.456-.461-.683-.319-.227-.827-.223-.749.005-1.089.528-.327.51-.321 1.539z"/></g></svg>',
        },
        link: "https://hollo.social/@fedify",
        ariaLabel: "Hollo (ActivityPub)",
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
      {
        property: "og:image",
        content:
          "https://repository-images.githubusercontent.com/766072261/03a63032-03aa-481e-aa31-091809a49043",
      },
    ],
    [
      "meta",
      {
        name: "fediverse:creator",
        content: "@fedify@hollo.social",
      },
    ],
    ...plausibleScript,
  ],

  cleanUrls: true,
  ignoreDeadLinks: true,
  markdown: {
    codeTransformers: [
      transformerTwoslash({
        twoslashOptions: {
          compilerOptions: {
            moduleResolution: ModuleResolutionKind.Bundler,
            module: ModuleKind.ESNext,
            target: ScriptTarget.ESNext,
            experimentalDecorators: true, // For @fedify/nestjs
            emitDecoratorMetadata: true, // For @fedify/nestjs
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
      md.use(groupIconMdPlugin);
      md.use(jsrRefPlugin);
    },
  },
  sitemap: {
    hostname: process.env.SITEMAP_HOSTNAME,
  },

  vite: {
    plugins: [
      groupIconVitePlugin(),
      llmstxt({
        ignoreFiles: [
          "changelog.md",
          "contribute.md",
          "README.md",
          "security.md",
          "sponsors.md",
          "tutorial.md",
        ],
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
