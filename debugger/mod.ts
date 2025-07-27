/**
 * ActivityPub debugger for Fedify applications.
 *
 * This package provides debugging and monitoring tools for ActivityPub
 * federation activities through an extensible observer pattern.
 *
 * @module
 * @since 1.9.0
 */

export { DebugObserver, type DebugObserverOptions } from "./observer.ts";
export { ActivityStore } from "./store.ts";
export { createDebugHandler } from "./handler.ts";
export {
  createDebugger,
  type DebuggerIntegration,
  integrateDebugger,
  type IntegrateDebuggerOptions,
  integrateDebuggerWithFederation,
} from "./integration.ts";
export type {
  ActivityFilters,
  ActorInfo,
  DebugActivity,
  DeliveryInfo,
  ObjectInfo,
  SignatureInfo,
  StoreStatistics,
} from "./types.ts";
