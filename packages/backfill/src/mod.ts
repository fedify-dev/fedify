/**
 * ActivityPub backfill support for Fedify.
 *
 * This package provides async generator APIs for collecting historical
 * ActivityPub objects related to a seed object.
 *
 * @module
 */
export {
  backfill,
  backfillActivities,
  MaxRequestsExceeded,
} from "./backfill.ts";
export type {
  BackfillActivityOptions,
  BackfillContext,
  BackfillDocumentLoader,
  BackfillDocumentLoaderOptions,
  BackfillItem,
  BackfillOptions,
  BackfillOrigin,
  BackfillStrategy,
} from "./types.ts";
