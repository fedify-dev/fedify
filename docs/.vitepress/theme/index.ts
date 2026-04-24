import TwoslashFloatingVue from "@shikijs/vitepress-twoslash/client";
import "virtual:group-icons.css";
import type { EnhanceAppContext } from "vitepress";
import { h } from "vue";
import PageMarkdownActions from "./components/PageMarkdownActions.vue";
import Theme from "vitepress/theme";

import "@shikijs/vitepress-twoslash/style.css";
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
  },
};
