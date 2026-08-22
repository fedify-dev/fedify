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
 * The builder is a module-level singleton for the same reason AdonisJS's own
 * `router` and `server` service modules are: application code has to be able to
 * reach it from a plain `import` at module scope, without an `await`.
 *
 * Note that this module deliberately imports nothing from AdonisJS.  The
 * original prototype of this package bound the builder into the IoC container
 * as an import side effect, which meant the container binding existed only if
 * some other module happened to import this one first.  Binding is the service
 * provider's job instead; see `provider.ts`.
 *
 * On the dual build: this is the one module with state, so the classic
 * dual-package hazard applies — a process that loaded both the ESM and the
 * CommonJS copy would hold two builders.  In practice it cannot happen where it
 * would matter: AdonisJS applications are ESM by construction, so the provider,
 * the preload files and the app's federation modules all resolve the ESM copy.
 * The CommonJS entry exists for the container-free `fedifyMiddleware` layer,
 * which is stateless.
 *
 * @module
 */
import {
  createFederationBuilder,
  type FederationBuilder,
} from "@fedify/fedify";

import type { ContextData } from "./types.ts";

/**
 * The builder that dispatchers and inbox listeners are registered on.
 *
 * Prefer importing it through the `@fedify/adonisjs/services/builder` service
 * module, which is the path the generated stubs and the documentation use.
 */
export const builder: FederationBuilder<ContextData> = createFederationBuilder<
  ContextData
>();
