/**
 * Testing utilities for Fedify applications.
 *
 * This module provides mock implementations of the {@link Federation} and
 * {@link Context} interfaces to facilitate unit testing of federated applications
 * built with Fedify.
 *
 * Note: MockFederation and SentActivity are intentionally not exported from this
 * public API to avoid JSR type analyzer hangs (issue #468). The JSR type analyzer
 * struggles with the complex type dependencies in MockFederation and MockContext
 * classes, which can cause indefinite hangs during the "processing" stage.
 *
 * Instead, use the exported helper functions to create test instances:
 * - {@link createFederation} - Create a mock Federation for testing
 * - {@link createContext} - Create a basic Context for testing
 * - {@link createRequestContext} - Create a RequestContext for testing
 * - {@link createInboxContext} - Create an InboxContext for testing
 *
 * These functions provide the same testing capabilities while avoiding the
 * problematic type exports.
 *
 * @module
 */

// Export factory functions for creating test instances
export {
  createContext,
  createFederation,
  createInboxContext,
  createRequestContext,
} from "./mock.ts";
export {
  default as testMessageQueue,
  getRandomKey,
  type TestMessageQueueOptions,
  waitFor,
} from "./mq-tester.ts";
