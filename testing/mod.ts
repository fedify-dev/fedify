/**
 * Testing utilities for Fedify applications.
 *
 * This module provides mock implementations of the {@link Federation} and
 * {@link Context} interfaces to facilitate unit testing of federated applications
 * built with Fedify.
 *
 * @module
 */

export { MockContext, MockFederation } from "./mock.ts";
export type { SentActivity } from "./mock.ts";
export {
  createContext,
  createInboxContext,
  createRequestContext,
} from "./context.ts";
