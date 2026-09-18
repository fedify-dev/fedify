/**
 * The application-wide {@link FederationBuilder}.
 *
 * Fedify's builder pattern separates *registering* dispatchers from *building*
 * the `Federation` object.  That separation is what makes an AdonisJS
 * integration possible at all: dispatcher registration happens while the
 * application boots (in preload files, which may import Lucid models and other
 * container services), while the `Federation` itself can only be built once
 * every registration is in — and once `config/fedify.ts` has been resolved.
 *
 * The builder is a process-wide singleton for the same reason AdonisJS's own
 * `router` and `server` service modules are: application code has to be able to
 * reach it from a plain `import` at module scope, without an `await`.
 *
 * Note that this module deliberately imports nothing from AdonisJS.  The
 * original prototype of this package bound the builder into the IoC container
 * as an import side effect, which meant the container binding existed only if
 * some other module happened to import this one first.  Binding is the service
 * provider's job instead; see `providers/fedify_provider.ts`.
 *
 * On the dual build: this is the one module with state, so the classic
 * dual-package hazard applies — a process that loaded both the ESM and the
 * CommonJS copy would otherwise hold two builders, and dispatchers registered
 * on one would be silently missing from the `Federation` built from the other.
 * The singleton therefore lives in a `globalThis` slot under a registered
 * symbol, which every copy of this module resolves to the same object.
 *
 * @module
 */
import {
  createFederationBuilder,
  type FederationBuilder,
} from "@fedify/fedify";

import type { ContextData } from "./types.ts";

/**
 * The slot the singleton lives in, keyed by major version.
 *
 * Every copy of *this* package resolves the same key, which is the point — the
 * ESM and CommonJS builds have to agree.  A different major version of
 * `@fedify/adonisjs` hoisted into the same process gets a slot of its own
 * rather than inheriting dispatchers registered against another major's
 * `FederationBuilder`.
 */
const SLOT: unique symbol = Symbol.for("@fedify/adonisjs@2/builder");

const registry = globalThis as { [SLOT]?: FederationBuilder<ContextData> };

/**
 * The builder that dispatchers and inbox listeners are registered on.
 *
 * Prefer importing it through the `@fedify/adonisjs/services/builder` service
 * module, which is the path the generated stubs and the documentation use.
 */
export const builder: FederationBuilder<ContextData> = registry[SLOT] ??=
  createFederationBuilder<ContextData>();
