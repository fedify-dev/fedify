/**
 * The internal barrel for the custom background task API.  Cross-directory
 * consumers (*federation.ts*, *builder.ts*, *context.ts*, *middleware.ts*)
 * import from this module, not the individual files.  Only the public subset
 * is re-exported from *federation/mod.ts*.
 *
 * @module
 */
export { default as TaskCodec } from "./codec.ts";
export { default as enqueueTasks } from "./enqueue.ts";
export type {
  TaskDefinition,
  TaskDefinitionInternal,
  TaskDefinitionOptions,
  TaskEnqueueOptions,
  TaskHandler,
  TaskRegistry,
} from "./task.ts";
