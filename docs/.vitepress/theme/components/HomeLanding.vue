<script setup lang="ts">
// Custom landing page for Fedify, rendered as a custom VitePress layout
// (`layout: HomeLanding` + `isHome: true` in docs/index.md).  Built as a real
// narrative landing page rather than the default hero + emoji-feature grid.
import { computed, ref, type Component } from "vue";
import {
  BadgeCheck,
  Braces,
  FilePen,
  Link2,
  Server,
  Signature,
  UserSearch,
} from "lucide-vue-next";

// Official ActivityPub logo (Simple Icons, CC0).
const activityPubLogo =
  '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M10.91 4.442 0 10.74v2.52l8.727-5.04v10.077l2.182 1.26zM6.545 12l-4.364 2.52 4.364 2.518zm6.545-2.52L17.455 12l-4.364 2.52zm0-5.038L24 10.74v2.52l-10.91 6.298v-2.52L21.819 12l-8.728-5.04z"/></svg>';

// Install commands per package manager (kept on one axis; runtimes are shown
// separately below).  npm is the default since most users are on Node.js.
const installs = [
  { id: "npm", label: "npm", cmd: "npm install @fedify/fedify" },
  { id: "pnpm", label: "pnpm", cmd: "pnpm add @fedify/fedify" },
  { id: "yarn", label: "Yarn", cmd: "yarn add @fedify/fedify" },
  { id: "deno", label: "Deno", cmd: "deno add jsr:@fedify/fedify" },
  { id: "bun", label: "Bun", cmd: "bun add @fedify/fedify" },
];
const activeInstall = ref("npm");
const activeCmd = computed(
  () => installs.find((t) => t.id === activeInstall.value)?.cmd ?? "",
);
const copied = ref(false);
function copyCmd() {
  navigator.clipboard
    ?.writeText(activeCmd.value)
    .then(() => {
      copied.value = true;
      setTimeout(() => (copied.value = false), 1600);
    })
    .catch(() => {});
}

// Runtimes Fedify runs on, with their logos (Simple Icons, CC0).
const runtimes: { name: string; logo: string }[] = [
  {
    name: "Node.js",
    logo:
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M11.998 24c-.321 0-.641-.084-.922-.247L8.14 22.016c-.438-.245-.224-.332-.08-.383c.585-.203.703-.25 1.328-.604c.065-.037.151-.023.218.017l2.256 1.339a.29.29 0 0 0 .272 0l8.795-5.076a.28.28 0 0 0 .134-.238V6.921a.28.28 0 0 0-.137-.242l-8.791-5.072a.28.28 0 0 0-.271 0L3.075 6.68a.28.28 0 0 0-.139.241v10.15a.27.27 0 0 0 .139.235l2.409 1.392c1.307.654 2.108-.116 2.108-.89V7.787c0-.142.114-.253.256-.253h1.115c.139 0 .255.112.255.253v10.021c0 1.745-.95 2.745-2.604 2.745c-.508 0-.909 0-2.026-.551L2.28 18.675a1.86 1.86 0 0 1-.922-1.604V6.921c0-.659.353-1.275.922-1.603L11.075.236a1.93 1.93 0 0 1 1.848 0l8.794 5.082c.57.329.924.944.924 1.603v10.15a1.86 1.86 0 0 1-.924 1.604l-8.794 5.078c-.28.163-.599.247-.925.247m7.101-10.007c0-1.9-1.284-2.406-3.987-2.763c-2.731-.361-3.009-.548-3.009-1.187c0-.528.235-1.233 2.258-1.233c1.807 0 2.473.389 2.747 1.607a.254.254 0 0 0 .247.199h1.141a.26.26 0 0 0 .186-.081a.26.26 0 0 0 .067-.196c-.177-2.098-1.571-3.076-4.388-3.076c-2.508 0-4.004 1.058-4.004 2.833c0 1.925 1.488 2.457 3.895 2.695c2.88.282 3.103.703 3.103 1.269c0 .983-.789 1.402-2.642 1.402c-2.327 0-2.839-.584-3.011-1.742a.255.255 0 0 0-.253-.215h-1.137a.25.25 0 0 0-.254.253c0 1.482.806 3.248 4.655 3.248c2.788.001 4.386-1.096 4.386-3.013"/></svg>',
  },
  {
    name: "Deno",
    logo:
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M1.105 18.02A11.9 11.9 0 0 1 0 12.985q0-.698.078-1.376a12 12 0 0 1 .231-1.34A12 12 0 0 1 4.025 4.02a12 12 0 0 1 5.46-2.771a12 12 0 0 1 3.428-.23c1.452.112 2.825.477 4.077 1.05a12 12 0 0 1 2.78 1.774a12.02 12.02 0 0 1 4.053 7.078A12 12 0 0 1 24 12.985q0 .454-.036.914a12 12 0 0 1-.728 3.305a12 12 0 0 1-2.38 3.875c-1.33 1.357-3.02 1.962-4.43 1.936a4.4 4.4 0 0 1-2.724-1.024c-.99-.853-1.391-1.83-1.53-2.919a5 5 0 0 1 .128-1.518c.105-.38.37-1.116.76-1.437c-.455-.197-1.04-.624-1.226-.829c-.045-.05-.04-.13 0-.183a.155.155 0 0 1 .177-.053c.392.134.869.267 1.372.35c.66.111 1.484.25 2.317.292c2.03.1 4.153-.813 4.812-2.627s.403-3.609-1.96-4.685s-3.454-2.356-5.363-3.128c-1.247-.505-2.636-.205-4.06.582c-3.838 2.121-7.277 8.822-5.69 15.032a.191.191 0 0 1-.315.19a12 12 0 0 1-1.25-1.634a12 12 0 0 1-.769-1.404M11.57 6.087c.649-.051 1.214.501 1.31 1.236c.13.979-.228 1.99-1.41 2.013c-1.01.02-1.315-.997-1.248-1.614c.066-.616.574-1.575 1.35-1.635"/></svg>',
  },
  {
    name: "Bun",
    logo:
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 22.596c6.628 0 12-4.338 12-9.688c0-3.318-2.057-6.248-5.219-7.986c-1.286-.715-2.297-1.357-3.139-1.89C14.058 2.025 13.08 1.404 12 1.404c-1.097 0-2.334.785-3.966 1.821a50 50 0 0 1-2.816 1.697C2.057 6.66 0 9.59 0 12.908c0 5.35 5.372 9.687 12 9.687zM10.599 4.715c.334-.759.503-1.58.498-2.409c0-.145.202-.187.23-.029c.658 2.783-.902 4.162-2.057 4.624c-.124.048-.199-.121-.103-.209a5.8 5.8 0 0 0 1.432-1.977m2.058-.102a5.8 5.8 0 0 0-.782-2.306v-.016c-.069-.123.086-.263.185-.172c1.962 2.111 1.307 4.067.556 5.051c-.082.103-.23-.003-.189-.126a5.85 5.85 0 0 0 .23-2.431m1.776-.561a5.7 5.7 0 0 0-1.612-1.806v-.014c-.112-.085-.024-.274.114-.218c2.595 1.087 2.774 3.18 2.459 4.407a.12.12 0 0 1-.049.071a.11.11 0 0 1-.153-.026a.12.12 0 0 1-.022-.083a5.9 5.9 0 0 0-.737-2.331m-5.087.561c-.617.546-1.282.76-2.063 1c-.117 0-.195-.078-.156-.181c1.752-.909 2.376-1.649 2.999-2.778c0 0 .155-.118.188.085c0 .304-.349 1.329-.968 1.874m4.945 11.237a2.96 2.96 0 0 1-.937 1.553c-.346.346-.8.565-1.286.62a2.18 2.18 0 0 1-1.327-.62a2.96 2.96 0 0 1-.925-1.553a.24.24 0 0 1 .064-.198a.23.23 0 0 1 .193-.069h3.965a.23.23 0 0 1 .19.07c.05.053.073.125.063.197m-5.458-2.176a1.86 1.86 0 0 1-2.384-.245a1.98 1.98 0 0 1-.233-2.447c.207-.319.503-.566.848-.713a1.84 1.84 0 0 1 1.092-.11c.366.075.703.261.967.531a1.98 1.98 0 0 1 .408 2.114a1.93 1.93 0 0 1-.698.869zm8.495.005a1.86 1.86 0 0 1-2.381-.253a1.96 1.96 0 0 1-.547-1.366c0-.384.11-.76.32-1.079c.207-.319.503-.567.849-.713a1.84 1.84 0 0 1 1.093-.108c.367.076.704.262.968.534a1.98 1.98 0 0 1 .4 2.117a1.93 1.93 0 0 1-.702.868"/></svg>',
  },
  {
    name: "Cloudflare Workers",
    logo:
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="m8.213.063l8.879 12.136l-8.67 11.739h2.476l8.665-11.735l-8.89-12.14Zm4.728 0l9.02 11.992l-9.018 11.883h2.496L24 12.656v-1.199L15.434.063ZM7.178 2.02L.01 11.398l-.01 1.2l7.203 9.644l1.238-1.676l-6.396-8.556l6.361-8.313Z"/></svg>',
  },
];

// The specs Fedify implements, shown as a "stack" in the why section.  Each
// links to the most specific manual page that documents it; `spec` carries the
// formal designation where one exists, and `icon`/`logo` the related artwork.
const stack: {
  name: string;
  spec?: string;
  link?: string;
  icon?: Component;
  logo?: string;
}[] = [
  { name: "ActivityPub", link: "/manual/federation", logo: activityPubLogo },
  { name: "Activity Streams 2.0", link: "/manual/vocab", icon: Braces },
  {
    name: "HTTP Signatures",
    spec: "draft-cavage-http-signatures-12",
    link: "/manual/send#http-signatures",
    icon: FilePen,
  },
  {
    name: "HTTP Message Signatures",
    spec: "RFC 9421",
    link: "/manual/send#http-message-signatures",
    icon: Signature,
  },
  {
    name: "WebFinger",
    spec: "RFC 7033",
    link: "/manual/webfinger",
    icon: UserSearch,
  },
  { name: "NodeInfo", link: "/manual/nodeinfo", icon: Server },
  {
    name: "Object Integrity Proofs",
    spec: "FEP-8b32",
    link: "/manual/send#object-integrity-proofs",
    icon: BadgeCheck,
  },
  {
    name: "Linked Data Signatures",
    link: "/manual/send#linked-data-signatures",
    icon: Link2,
  },
];

// Fediverse software Fedify-built apps can talk to.
const interop = [
  "Mastodon",
  "Misskey",
  "Lemmy",
  "Pleroma",
  "PeerTube",
  "Pixelfed",
  "Akkoma",
  "Hollo",
  "Ghost",
];

// Lightly highlighted showcase snippet (authored string, rendered with v-html).
const code = `<span class="c-kw">import</span> { <span class="c-ty">createFederation</span>, <span class="c-ty">Person</span> } <span class="c-kw">from</span> <span class="c-st">"@fedify/fedify"</span>;

<span class="c-kw">const</span> federation = <span class="c-fn">createFederation</span>({ kv });

federation.<span class="c-fn">setActorDispatcher</span>(
  <span class="c-st">"/users/{identifier}"</span>,
  <span class="c-kw">async</span> (ctx, identifier) => {
    <span class="c-kw">const</span> user = <span class="c-kw">await</span> db.<span class="c-fn">getUser</span>(identifier);
    <span class="c-kw">if</span> (user == <span class="c-kw">null</span>) <span class="c-kw">return</span> <span class="c-kw">null</span>;
    <span class="c-kw">return</span> <span class="c-kw">new</span> <span class="c-ty">Person</span>({
      id: ctx.<span class="c-fn">getActorUri</span>(identifier),
      preferredUsername: identifier,
      name: user.name,
      inbox: ctx.<span class="c-fn">getInboxUri</span>(identifier),
    });
  },
);`;
</script>

<template>
  <div class="lp">
    <!-- ============================ HERO ============================ -->
    <section class="lp-hero">
      <div class="lp-hero-bg" aria-hidden="true">
        <span class="orb orb-cyan" />
        <span class="orb orb-violet" />
        <span class="orb orb-gold" />
        <span class="grid" />
      </div>

      <div class="wrap lp-hero-grid">
        <div class="lp-hero-copy">
          <p class="lp-eyebrow">TypeScript · ActivityPub · Open source</p>
          <h1 class="lp-title">
            Build for the
            <span class="lp-grad">fediverse</span>,<br />
            skip the boilerplate.
          </h1>
          <p class="lp-lede">
            <strong>Fedify</strong> turns the hard parts of federation, signatures,
            discovery, activity vocabulary, and delivery, into a handful of
            type-safe function calls. So you ship features, not specs.
          </p>
          <div class="lp-cta">
            <a class="btn btn-primary" href="/tutorial/basics">
              Get started
              <span class="btn-arrow">→</span>
            </a>
            <a class="btn btn-ghost" href="/why">Why Fedify?</a>
          </div>
          <div class="lp-install">
            <div class="lp-install-tabs" role="tablist">
              <button
                v-for="t in installs"
                :key="t.id"
                type="button"
                class="lp-tab"
                :class="{ active: activeInstall === t.id }"
                :aria-selected="activeInstall === t.id"
                role="tab"
                @click="activeInstall = t.id"
              >
                {{ t.label }}
              </button>
            </div>
            <div class="lp-install-cmd">
              <span class="prompt" aria-hidden="true">$</span>
              <code>{{ activeCmd }}</code>
              <button
                type="button"
                class="lp-copy"
                :aria-label="copied ? 'Copied' : 'Copy command'"
                @click="copyCmd"
              >
                {{ copied ? "Copied" : "Copy" }}
              </button>
            </div>
          </div>
          <div class="lp-runtimes">
            <span class="lp-runtimes-label">Runs on</span>
            <span class="rt" v-for="r in runtimes" :key="r.name">
              <span class="rt-logo" v-html="r.logo" />{{ r.name }}
            </span>
          </div>
        </div>

        <div class="lp-hero-art" aria-hidden="true">
          <svg class="lp-net" viewBox="0 0 440 440">
            <defs>
              <radialGradient id="lpGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35" />
                <stop offset="100%" stop-color="#38bdf8" stop-opacity="0" />
              </radialGradient>
            </defs>
            <circle cx="220" cy="220" r="200" fill="url(#lpGlow)" />
            <g class="rings">
              <circle cx="220" cy="220" r="92" />
              <circle cx="220" cy="220" r="150" />
              <circle cx="220" cy="220" r="200" />
            </g>
            <g class="orbit">
              <line x1="220" y1="220" x2="220" y2="70" />
              <line x1="220" y1="220" x2="350" y2="160" />
              <line x1="220" y1="220" x2="330" y2="320" />
              <line x1="220" y1="220" x2="120" y2="350" />
              <line x1="220" y1="220" x2="78" y2="170" />
              <circle class="node n1" cx="220" cy="70" r="13" />
              <circle class="node n2" cx="350" cy="160" r="11" />
              <circle class="node n3" cx="330" cy="320" r="14" />
              <circle class="node n4" cx="120" cy="350" r="10" />
              <circle class="node n5" cx="78" cy="170" r="12" />
            </g>
          </svg>
          <img class="lp-net-logo" src="/logo.svg" alt="" />
        </div>
      </div>
    </section>

    <!-- ======================= WHAT IS FEDIFY ======================= -->
    <section class="lp-section">
      <div class="wrap lp-narrow">
        <p class="lp-kicker">What's Fedify?</p>
        <h2 class="lp-h2">
          One library that lets your app speak to the entire fediverse.
        </h2>
        <p class="lp-body">
          The fediverse is millions of accounts spread across thousands of
          independent servers, all talking through shared protocols. Implementing
          those protocols by hand is a lot of subtle, security-critical work.
          Fedify gives you a single, framework-agnostic toolkit so a post on your
          server reaches Mastodon, Misskey, Lemmy, and everything else, correctly
          and securely.
        </p>
        <a class="lp-textlink" href="/intro">Read the full introduction →</a>
      </div>
    </section>

    <!-- ===================== WHY / THE STACK ======================== -->
    <section class="lp-section lp-section-alt">
      <div class="wrap lp-why">
        <div class="lp-why-copy">
          <p class="lp-kicker">Why Fedify?</p>
          <h2 class="lp-h2">Federation is a stack of specs. We implement it.</h2>
          <p class="lp-body">
            Going federated means getting a whole pile of standards right, and
            keeping them right as they evolve. Fedify implements them so you
            don't have to, and exposes them through one coherent, typed API.
          </p>
          <a class="lp-textlink" href="/why">See the full rationale →</a>
        </div>
        <ul class="lp-stack" aria-label="Standards implemented by Fedify">
          <li
            v-for="(s, i) in stack"
            :key="s.name"
            :style="{ '--i': i }"
            :class="{ 'has-link': s.link }"
          >
            <span class="lp-stack-icon" aria-hidden="true">
              <span v-if="s.logo" class="lp-stack-logo" v-html="s.logo" />
              <component v-else :is="s.icon" :size="20" :stroke-width="1.9" />
            </span>
            <a v-if="s.link" :href="s.link" class="lp-stack-name">{{ s.name }}</a>
            <span v-else class="lp-stack-name">{{ s.name }}</span>
            <span v-if="s.spec" class="lp-stack-spec">{{ s.spec }}</span>
            <span v-if="s.link" class="lp-stack-go" aria-hidden="true">→</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- ======================= CODE SHOWCASE ======================== -->
    <section class="lp-section">
      <div class="wrap lp-code-grid">
        <div class="lp-code-copy">
          <p class="lp-kicker">Looks like this</p>
          <h2 class="lp-h2">Define an actor. Fedify handles the wire.</h2>
          <p class="lp-body">
            Map a route to a typed actor and you get a working, discoverable,
            cryptographically-signed ActivityPub endpoint, no manual JSON-LD, no
            signature plumbing.
          </p>
          <a class="lp-textlink" href="/tutorial/basics">Follow the tutorial →</a>
        </div>
        <div class="lp-code-window">
          <div class="lp-code-bar" aria-hidden="true">
            <span class="dot" /><span class="dot" /><span class="dot" />
            <span class="lp-code-file">federation.ts</span>
          </div>
          <pre class="lp-code"><code v-html="code" /></pre>
        </div>
      </div>
    </section>

    <!-- ========================= INTEROP ============================ -->
    <section class="lp-section lp-section-alt">
      <div class="wrap lp-interop">
        <p class="lp-kicker">Plays well with others</p>
        <h2 class="lp-h2">Interoperates with the software people already use</h2>
        <ul class="lp-chips">
          <li v-for="name in interop" :key="name">{{ name }}</li>
          <li class="more">and more</li>
        </ul>
      </div>
    </section>

    <!-- ======================= FINAL CTA ============================ -->
    <section class="lp-cta-band">
      <div class="lp-cta-bg" aria-hidden="true">
        <span class="orb orb-cyan" />
        <span class="orb orb-violet" />
      </div>
      <div class="wrap lp-cta-inner">
        <h2 class="lp-cta-title">Ready to join the fediverse?</h2>
        <p class="lp-cta-sub">
          Install Fedify and have a federated actor running in minutes.
        </p>
        <div class="lp-cta">
          <a class="btn btn-primary" href="/install">
            Start building <span class="btn-arrow">→</span>
          </a>
          <a class="btn btn-ghost" href="/manual/federation">Browse the manual</a>
          <a class="btn btn-ghost" href="https://github.com/fedify-dev/fedify">
            GitHub
          </a>
        </div>
        <p class="lp-sponsors">
          Fedify is free and open source.
          <a href="/sponsors">Meet our sponsors →</a>
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* The custom layout zeroes VPContent's home padding (see brand.css); the hero
   owns the nav offset so spacing is consistent across breakpoints. */
.lp {
  --lp-wrap: 1152px;
  overflow: clip;
}

.wrap {
  max-width: var(--lp-wrap);
  margin: 0 auto;
  padding-inline: 24px;
}

/* ----------------------------- Hero ---------------------------- */
.lp-hero {
  position: relative;
  padding-top: calc(var(--vp-nav-height) + 4rem);
  padding-bottom: 5rem;
  overflow: clip;
}

.lp-hero-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.lp-hero-bg .grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(to right, rgba(2, 132, 199, 0.06) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(2, 132, 199, 0.06) 1px, transparent 1px);
  background-size: 54px 54px;
  -webkit-mask-image: radial-gradient(120% 70% at 50% 0%, #000, transparent 72%);
  mask-image: radial-gradient(120% 70% at 50% 0%, #000, transparent 72%);
}

.dark .lp-hero-bg .grid {
  background-image:
    linear-gradient(to right, rgba(125, 211, 252, 0.07) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(125, 211, 252, 0.07) 1px, transparent 1px);
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
}
.lp-hero-bg .orb-cyan {
  width: 38vw;
  max-width: 540px;
  aspect-ratio: 1;
  top: -6%;
  left: -6%;
  background: radial-gradient(circle, #00a3ff 0%, transparent 68%);
  opacity: 0.4;
}
.lp-hero-bg .orb-violet {
  width: 34vw;
  max-width: 480px;
  aspect-ratio: 1;
  top: -10%;
  right: -8%;
  background: radial-gradient(circle, #9500ff 0%, transparent 68%);
  opacity: 0.32;
}
.lp-hero-bg .orb-gold {
  width: 24vw;
  max-width: 340px;
  aspect-ratio: 1;
  top: 30%;
  right: 12%;
  background: radial-gradient(circle, #ffca00 0%, transparent 70%);
  opacity: 0.22;
}

.lp-hero-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  align-items: center;
  gap: 3rem;
}

.lp-eyebrow {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  margin: 0 0 1rem;
}

.lp-title {
  font-family: var(--vp-font-family-display);
  font-size: clamp(2.4rem, 5.2vw, 4rem);
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-weight: 800;
  margin: 0;
  color: var(--vp-c-text-1);
}

.lp-grad {
  background: linear-gradient(120deg, #0ea5e9, #6d28d9 92%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}
.dark .lp-grad {
  background: linear-gradient(120deg, #7dd3fc, #c084fc 92%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.lp-lede {
  margin: 1.5rem 0 0;
  max-width: 34rem;
  font-size: 1.12rem;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}
.lp-lede strong {
  color: var(--vp-c-text-1);
}

.lp-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 2rem;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.7rem 1.4rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.97rem;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease;
}
.btn-primary {
  color: #fff;
  background: linear-gradient(120deg, #0ea5e9, #0369a1);
  box-shadow: 0 10px 24px -10px rgba(2, 132, 199, 0.7);
}
.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 30px -12px rgba(2, 132, 199, 0.8);
}
.btn-arrow {
  transition: transform 0.2s ease;
}
.btn-primary:hover .btn-arrow {
  transform: translateX(3px);
}
.btn-ghost {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}
.btn-ghost:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.lp-install {
  margin-top: 1.8rem;
  display: inline-flex;
  flex-direction: column;
  max-width: 100%;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  overflow: clip;
}
.lp-install-tabs {
  display: flex;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid var(--vp-c-divider);
}
.lp-install-tabs::-webkit-scrollbar {
  display: none;
}
.lp-tab {
  flex: 0 0 auto;
  padding: 0.42rem 0.95rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  border-bottom: 2px solid transparent;
  transition:
    color 0.2s ease,
    border-color 0.2s ease,
    background-color 0.2s ease;
}
.lp-tab:hover {
  color: var(--vp-c-text-1);
}
.lp-tab.active {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
}
.lp-install-cmd {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.7rem 0.9rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.85rem;
}
.lp-install-cmd .prompt {
  color: var(--vp-c-brand-1);
  user-select: none;
}
.lp-install-cmd code {
  padding: 0;
  background: none;
  color: var(--vp-c-text-1);
  white-space: nowrap;
}
.lp-copy {
  margin-left: auto;
  padding: 0.18rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 600;
  font-family: var(--vp-font-family-base);
  border-radius: 6px;
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
  transition:
    color 0.2s ease,
    border-color 0.2s ease;
}
.lp-copy:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.lp-runtimes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 1.2rem;
  margin-top: 1.5rem;
  font-size: 0.85rem;
}
.lp-runtimes-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--vp-c-text-2);
  opacity: 0.7;
}
.lp-runtimes .rt {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  transition: color 0.2s ease;
}
.lp-runtimes .rt:hover {
  color: var(--vp-c-text-1);
}
.lp-runtimes .rt-logo {
  display: inline-flex;
}
.lp-runtimes .rt-logo :deep(svg) {
  width: 18px;
  height: 18px;
}

/* Hero artwork: federated network around the logo. */
.lp-hero-art {
  position: relative;
  justify-self: center;
  width: min(440px, 92%);
  aspect-ratio: 1;
}
.lp-net {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.lp-net .rings circle {
  fill: none;
  stroke: var(--vp-c-brand-1);
  stroke-opacity: 0.18;
  stroke-dasharray: 3 7;
}
.lp-net .orbit line {
  stroke: var(--vp-c-brand-1);
  stroke-opacity: 0.3;
  stroke-width: 1.4;
  stroke-dasharray: 4 6;
}
.lp-net .node {
  stroke: var(--vp-c-bg);
  stroke-width: 3;
}
.lp-net .n1 { fill: #00a3ff; }
.lp-net .n2 { fill: #0ea5e9; }
.lp-net .n3 { fill: #9500ff; }
.lp-net .n4 { fill: #ffca00; }
.lp-net .n5 { fill: #38bdf8; }
.lp-net-logo {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 38%;
  transform: translate(-50%, -50%);
  filter: drop-shadow(0 12px 30px rgba(2, 132, 199, 0.35));
}

/* --------------------------- Sections -------------------------- */
.lp-section {
  padding: 5.5rem 0;
}
.lp-section-alt {
  background: var(--vp-c-bg-soft);
  border-block: 1px solid var(--vp-c-divider);
}
.lp-narrow {
  max-width: 760px;
}
.lp-kicker {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  margin: 0 0 0.9rem;
}
.lp-h2 {
  font-family: var(--vp-font-family-display);
  font-size: clamp(1.7rem, 3.2vw, 2.4rem);
  line-height: 1.18;
  letter-spacing: -0.02em;
  font-weight: 800;
  margin: 0;
  color: var(--vp-c-text-1);
}
.lp-body {
  margin: 1.2rem 0 0;
  font-size: 1.06rem;
  line-height: 1.7;
  color: var(--vp-c-text-2);
}
.lp-textlink {
  display: inline-block;
  margin-top: 1.4rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}
.lp-textlink:hover {
  color: var(--vp-c-brand-2);
}

/* ----------------------------- Why ----------------------------- */
.lp-why {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3rem;
  align-items: center;
}
.lp-stack {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.6rem;
}
.lp-stack li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.8rem 1.1rem;
  border-radius: 12px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  font-weight: 600;
  color: var(--vp-c-text-1);
  transition:
    border-color 0.2s ease,
    color 0.2s ease;
}
.lp-stack-name {
  color: inherit;
  text-decoration: none;
}
.lp-stack-spec {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--vp-c-text-3, var(--vp-c-text-2));
  white-space: nowrap;
}
/* Make the whole row clickable for linked specs. */
a.lp-stack-name::after {
  content: "";
  position: absolute;
  inset: 0;
}
.lp-stack-go {
  margin-left: auto;
  font-weight: 700;
  color: var(--vp-c-brand-1);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.lp-stack li.has-link:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.lp-stack li.has-link:hover .lp-stack-go {
  opacity: 1;
  transform: translateX(0);
}
/* Topical icon chip on the left of each spec (sky-tinted, brand-colored). */
.lp-stack-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 10px;
  color: var(--vp-c-brand-1);
  background: linear-gradient(135deg, var(--vp-c-brand-soft), transparent);
  border: 1px solid rgba(2, 132, 199, 0.18);
}
.dark .lp-stack-icon {
  border-color: rgba(56, 189, 248, 0.22);
}
.lp-stack-logo {
  display: inline-flex;
}
.lp-stack-icon :deep(svg) {
  width: 20px;
  height: 20px;
}

/* ------------------------- Code showcase ----------------------- */
.lp-code-grid {
  display: grid;
  grid-template-columns: 0.9fr 1.1fr;
  gap: 3rem;
  align-items: center;
}
.lp-code-window {
  border-radius: 14px;
  overflow: clip;
  background: #0b1622;
  border: 1px solid #1e3a52;
  box-shadow: 0 30px 60px -30px rgba(2, 132, 199, 0.5);
}
.lp-code-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1rem;
  background: #0d1b2a;
  border-bottom: 1px solid #1e3a52;
}
.lp-code-bar .dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #1e3a52;
}
.lp-code-bar .dot:nth-child(1) { background: #f87171; }
.lp-code-bar .dot:nth-child(2) { background: #fbbf24; }
.lp-code-bar .dot:nth-child(3) { background: #34d399; }
.lp-code-file {
  margin-left: 0.6rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  color: #7c93a8;
}
.lp-code {
  margin: 0;
  padding: 1.25rem 1.4rem;
  overflow-x: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
  line-height: 1.7;
  color: #cbd5e1;
}
.lp-code :deep(.c-kw) { color: #7dd3fc; }
.lp-code :deep(.c-st) { color: #86efac; }
.lp-code :deep(.c-ty) { color: #fcd34d; }
.lp-code :deep(.c-fn) { color: #93c5fd; }

/* ---------------------------- Interop -------------------------- */
.lp-interop {
  text-align: center;
}
.lp-interop .lp-kicker,
.lp-interop .lp-h2 {
  text-align: center;
}
.lp-chips {
  list-style: none;
  margin: 2.2rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.7rem;
}
.lp-chips li {
  padding: 0.5rem 1.1rem;
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--vp-c-text-1);
  transition: border-color 0.2s ease, color 0.2s ease;
}
.lp-chips li:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.lp-chips .more {
  background: transparent;
  border-style: dashed;
  color: var(--vp-c-text-2);
}

/* --------------------------- Final CTA ------------------------- */
.lp-cta-band {
  position: relative;
  padding: 6rem 0;
  text-align: center;
  overflow: clip;
  border-top: 1px solid var(--vp-c-divider);
}
.lp-cta-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
.lp-cta-bg .orb-cyan {
  width: 50vw;
  max-width: 680px;
  aspect-ratio: 1;
  left: 50%;
  top: -30%;
  transform: translateX(-50%);
  background: radial-gradient(circle, #0ea5e9 0%, transparent 68%);
  opacity: 0.18;
}
.lp-cta-bg .orb-violet {
  width: 30vw;
  max-width: 420px;
  aspect-ratio: 1;
  right: 8%;
  bottom: -20%;
  background: radial-gradient(circle, #9500ff 0%, transparent 70%);
  opacity: 0.16;
}
.lp-cta-inner {
  position: relative;
  z-index: 1;
}
.lp-cta-title {
  font-family: var(--vp-font-family-display);
  font-size: clamp(1.9rem, 4vw, 2.8rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0;
  color: var(--vp-c-text-1);
}
.lp-cta-sub {
  margin: 1rem auto 0;
  max-width: 36rem;
  font-size: 1.08rem;
  color: var(--vp-c-text-2);
}
.lp-cta-band .lp-cta {
  justify-content: center;
}
.lp-sponsors {
  margin-top: 2.2rem;
  font-size: 0.92rem;
  color: var(--vp-c-text-2);
}
.lp-sponsors a {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

/* --------------------------- Animation ------------------------- */
@media (prefers-reduced-motion: no-preference) {
  .lp-hero-copy > * {
    animation: lp-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .lp-eyebrow { animation-delay: 0.02s; }
  .lp-title { animation-delay: 0.1s; }
  .lp-lede { animation-delay: 0.2s; }
  .lp-cta { animation-delay: 0.3s; }
  .lp-install { animation-delay: 0.4s; }
  .lp-runtimes { animation-delay: 0.5s; }
  .lp-hero-art {
    animation: lp-pop 1s cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: 0.15s;
  }
  /* Rotate the whole <svg> element (a compositor-friendly HTML element) rather
     than an inner <g>.  Firefox does not GPU-composite transforms on SVG
     sub-elements, so rotating <g> re-rasterized the SVG every frame and
     stuttered; promoting the SVG to its own layer lets the rotation run on the
     GPU.  Keeping it the only animation on this layer means it rasterizes once. */
  .lp-net {
    transform-origin: 50% 50%;
    will-change: transform;
    animation: lp-spin 70s linear infinite;
  }
  .lp-stack li {
    animation: lp-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: calc(var(--i) * 60ms);
  }
}

@keyframes lp-rise {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: none; }
}
@keyframes lp-pop {
  from { opacity: 0; transform: scale(0.92); }
  to { opacity: 1; transform: none; }
}
@keyframes lp-spin {
  to { transform: rotate(360deg); }
}

/* --------------------------- Responsive ------------------------ */
@media (max-width: 900px) {
  .lp-hero-grid,
  .lp-why,
  .lp-code-grid {
    grid-template-columns: 1fr;
  }
  .lp-hero-art {
    grid-row: 1;
    width: min(360px, 80%);
    margin-bottom: 1rem;
  }
  .lp-section { padding: 4rem 0; }
}

@media (max-width: 520px) {
  .lp-hero {
    padding-top: calc(var(--vp-nav-height) + 2rem);
  }
  /* Keep each spec name on one line; let the formal id stay inline and wrap to
     a second line only when it genuinely doesn't fit.  Tighten the chip, gaps,
     and row-gap so single-line rows stay compact and any wrapped row doesn't
     look bulky. */
  .lp-stack li {
    flex-wrap: wrap;
    gap: 0.2rem 0.6rem;
    padding: 0.65rem 0.85rem;
  }
  .lp-stack-name {
    white-space: nowrap;
  }
  .lp-stack-icon {
    width: 30px;
    height: 30px;
  }
  .lp-stack-icon :deep(svg) {
    width: 18px;
    height: 18px;
  }
  .lp-stack-spec {
    font-size: 0.68rem;
  }
}
</style>
