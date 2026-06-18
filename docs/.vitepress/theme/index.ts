import TwoslashFloatingVue from "@shikijs/vitepress-twoslash/client";
import "virtual:group-icons.css";
import type { EnhanceAppContext } from "vitepress";
import { h } from "vue";
import HomeLanding from "./components/HomeLanding.vue";
import PageMarkdownActions from "./components/PageMarkdownActions.vue";
import Theme from "vitepress/theme";

import "@fontsource-variable/bricolage-grotesque";
import "@shikijs/vitepress-twoslash/style.css";
import "./brand.css";
import "./style.css";

export default {
  extends: Theme,
  Layout() {
    return h(Theme.Layout, null, {
      "doc-before": () => h(PageMarkdownActions),
    });
  },
  enhanceApp({ app }: EnhanceAppContext) {
    app.use(TwoslashFloatingVue);
    app.component("PageMarkdownActions", PageMarkdownActions);
    // Resolved by VitePress via `<component :is="frontmatter.layout">` when a
    // page sets `layout: HomeLanding` (see docs/index.md).
    app.component("HomeLanding", HomeLanding);
  },
};
