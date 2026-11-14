/**
 * Offline FEP-f799 shape tools. These expose unverified claims; they do not
 * activate receiving, suspend delivery, fetch resources, or verify authority.
 *
 * @example
 * ```typescript
 * import { parseDeliverySuspensionDocument } from "@fedify/fedify/delivery-suspension";
 * async function inspectNotice(rawJson: unknown) {
 *   const result = await parseDeliverySuspensionDocument(rawJson);
 *   if (result.ok) console.log(result.value.suspensionStatus);
 * }
 * ```
 * @module
 * @since 2.5.0
 */
export {
  getDeliverySuspensionContextLoader,
  parseActorControlMetadata,
  parseDeliverySuspensionActivityDocument,
  parseDeliverySuspensionDocument,
  parseInboxControlMetadata,
} from "./parse.ts";
export {
  getDeliverySuspensionUrlOrigin,
  parseDeliverySuspensionOrigin,
} from "./origin.ts";
export type {
  ActorControlMetadata,
  ActorEndpointsMetadata,
  ControlLinkState,
  ControlLinkValue,
  ControlParseOptions,
  ControlledOriginValue,
  DeliverySuspensionActivityFacts,
  DeliverySuspensionActivityIdentity,
  DeliverySuspensionFacts,
  DeliverySuspensionOrigin,
  DeliverySuspensionTarget,
  InboxControlMetadata,
  ParseOptions,
  ParseResult,
  ShapeEvidence,
  ShapeIssue,
  ShapeJson,
} from "./types.ts";
