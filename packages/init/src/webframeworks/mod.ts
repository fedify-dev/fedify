import type { WebFrameworks } from "../types.ts";
import astro from "./astro.ts";
import bareBones from "./bare-bones.ts";
import elysia from "./elysia.ts";
import express from "./express.ts";
import hono from "./hono.ts";
import next from "./next.ts";
import nitro from "./nitro.ts";
import nuxt from "./nuxt.ts";
import solidstart from "./solidstart.ts";

/**
 * Registry of all supported web framework configurations.
 * Each entry defines the framework's label, supported package managers,
 * default port, and an `init()` factory that produces a
 * {@link WebFrameworkInitializer} with dependencies, templates, tasks,
 * and instructions tailored to the selected package manager.
 */
const webFrameworks: WebFrameworks = {
  "bare-bones": bareBones,
  astro,
  elysia,
  express,
  hono,
  next,
  nitro,
  nuxt,
  solidstart,
} as const;

export default webFrameworks;
