import type { DocumentLoader } from "@fedify/vocab-runtime";

/** A shape diagnostic, not an authentication or authorization verdict. @since 2.5.0 */
export interface ShapeIssue {
  /** Stable machine-readable diagnostic code. */
  readonly code: string;
  /**
   * JSON pointer identifying a field in the original expansion. Required fields
   * may be absent.
   * Dropped occurrences identify a surviving container and include `rawPath`.
   * Before expansion succeeds, pointers may identify input or context data.
   */
  readonly path: string;
  /** Human-readable explanation. */
  readonly message: string;
  /** Original input pointer supplied by a diagnostic null or empty marker. */
  readonly rawPath?: string;
}

/** A shape result with immutable diagnostics. @since 2.5.0 */
export type ParseResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly warnings: readonly ShapeIssue[];
    }
  | { readonly ok: false; readonly issues: readonly ShapeIssue[] };

/** A strict ASCII HTTPS origin and its original spelling. @since 2.5.0 */
export interface DeliverySuspensionOrigin {
  /** Original input, without rewriting. */
  readonly raw: string;
  /** ASCII origin with default port omitted and IPv6 brackets retained. */
  readonly normalized: string;
  /** Canonical hostname; IPv6 addresses have no enclosing brackets. */
  readonly hostname: string;
  /** Effective numeric port, including the default 443. */
  readonly port: number;
}

/** Detached, deeply immutable JSON evidence. @since 2.5.0 */
export type ShapeJson =
  | null
  | boolean
  | number
  | string
  | readonly ShapeJson[]
  | { readonly [key: string]: ShapeJson };

/** Options for the conservative raw JSON-LD shape profile. @since 2.5.0 */
export interface ParseOptions {
  /**
   * Explicit opt-in to caller-owned context loading. Only contexts are loaded;
   * the caller must bound its I/O. The default resolves preloaded contexts only.
   * Loaded responses are snapshotted and memoized within each parse call.
   */
  readonly contextLoader?: DocumentLoader;
}

/**
 * Options for inspecting control claims on one exact resource. Both expectedId
 * and contextLoader are captured synchronously when a metadata parse starts.
 * @since 2.5.0
 */
export interface ControlParseOptions extends ParseOptions {
  /** Required exact expanded representation ID, without URL normalization. */
  readonly expectedId?: string;
}

/** A reusable claimed target description; neither variant establishes control. @since 2.5.0 */
export type DeliverySuspensionTarget =
  | { readonly kind: "inbox"; readonly inbox: string }
  | { readonly kind: "origin"; readonly origin: string };

/** Detached input and original-pass JSON-LD expansion. @since 2.5.0 */
export interface ShapeEvidence {
  /** Original compact spelling, copied before asynchronous work. */
  readonly raw: ShapeJson;
  /** Original expanded evidence, preserving extra types and properties. */
  readonly expanded: ShapeJson;
}

/**
 * Structurally consistent notice claims, without authentication, authority,
 * freshness, history, signature verification, or complete signed-state equality.
 * Literal timestamp strings and expanded IRI spellings are preserved exactly.
 * @since 2.5.0
 */
export interface DeliverySuspensionFacts extends ShapeEvidence {
  readonly id: string;
  readonly controller: string;
  readonly published: string;
  readonly suspensionStatus: "active" | "cancelled";
  readonly target: DeliverySuspensionTarget;
  /** Derived strict normalization evidence, populated only for an origin target. */
  readonly normalizedTargetOrigin?: DeliverySuspensionOrigin;
  readonly revision: number;
  readonly announcement?: string;
  readonly startTime?: string;
  readonly endTime: string;
  readonly types: readonly string[];
}

/** Common claimed activity identity. @since 2.5.0 */
export interface DeliverySuspensionActivityIdentity extends ShapeEvidence {
  readonly id: string;
  readonly actor: string;
  readonly published: string;
  readonly types: readonly string[];
}

/**
 * Shape claims from a control activity. A successful Undo only identifies an
 * unverified reference; it does not establish an FEP-f799 delivery exemption.
 * @since 2.5.0
 */
export type DeliverySuspensionActivityFacts =
  | (DeliverySuspensionActivityIdentity & {
      readonly kind: "create" | "update";
      readonly suspension: DeliverySuspensionFacts;
    })
  | (DeliverySuspensionActivityIdentity & {
      readonly kind: "undo";
      readonly undoneActivity: string;
      readonly embeddedCreate?: {
        readonly id: string;
        readonly actor: string;
        readonly types: readonly string[];
      };
    });

/** One occurrence of a link claim, including its malformed evidence. @since 2.5.0 */
export interface ControlLinkValue {
  readonly raw: ShapeJson;
  readonly path: string;
  readonly rawPath?: string;
  readonly valid: boolean;
  readonly value?: string;
  readonly issues: readonly ShapeIssue[];
}

/**
 * Multiplicity takes precedence: two or more values are multiple even if some
 * are invalid. No occurrence is absent; a lone malformed occurrence is invalid.
 * @since 2.5.0
 */
export interface ControlLinkState {
  readonly state: "absent" | "single" | "multiple" | "invalid";
  readonly values: readonly ControlLinkValue[];
}

/** One endpoints occurrence; reference-only endpoints remain unresolved. @since 2.5.0 */
export interface ActorEndpointsMetadata {
  readonly raw: ShapeJson;
  readonly path: string;
  readonly rawPath?: string;
  readonly kind: "embedded" | "unresolved" | "invalid";
  readonly reference?: string;
  readonly sharedInbox: ControlLinkState;
  readonly issues: readonly ShapeIssue[];
}

/** One controlled-origin occurrence with an independent normalization result. @since 2.5.0 */
export interface ControlledOriginValue {
  readonly raw: ShapeJson;
  readonly path: string;
  readonly rawPath?: string;
  readonly value?: string;
  readonly normalization: ParseResult<DeliverySuspensionOrigin>;
}

/** Diagnostic actor claims, never independently fetched authority evidence. @since 2.5.0 */
export interface ActorControlMetadata extends ShapeEvidence {
  readonly id: string;
  readonly types: readonly string[];
  readonly inbox: ControlLinkState;
  readonly endpoints: readonly ActorEndpointsMetadata[];
  /** True when several endpoints parents prevent choosing a unique parent. */
  readonly endpointsAmbiguous: boolean;
  /** All embedded parents' sharedInbox values, retaining parent ambiguity above. */
  readonly sharedInbox: ControlLinkState;
  readonly controlledOrigins: readonly ControlledOriginValue[];
}

/** Diagnostic inbox claims; neither reverse link grants authority. @since 2.5.0 */
export interface InboxControlMetadata extends ShapeEvidence {
  readonly id: string;
  readonly types: readonly string[];
  readonly inboxOf: ControlLinkState;
  readonly deliveryController: ControlLinkState;
}
