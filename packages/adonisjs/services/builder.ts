/**
 * Service module exposing the Fedify {@link FederationBuilder}.
 *
 * This is the module application code imports to register dispatchers and inbox
 * listeners:
 *
 * ```ts
 * // app/federation/actors.ts
 * import federation from '@fedify/adonisjs/services/builder'
 *
 * federation.setActorDispatcher('/actors/{identifier}', async (ctx, identifier) => {
 *   // ...
 * })
 * ```
 *
 * Registration must happen while the application boots — the generated
 * `start/federation.ts` preload file is the intended place — because the
 * builder is sealed into a `Federation` object once booting completes.
 *
 * @module
 */
import type { FederationBuilder } from "@fedify/fedify";

import { builder } from "../src/builder.ts";
import type { ContextData } from "../src/types.ts";

const federation: FederationBuilder<ContextData> = builder;

export default federation;
