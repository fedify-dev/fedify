/**
 * Type definitions for the ActivityPub debugger.
 *
 * @module
 * @since 1.9.0
 */

/**
 * Represents a captured ActivityPub activity with debug information.
 * @since 1.9.0
 */
export interface DebugActivity {
  /** Unique ID for this debug entry */
  id: string;
  /** When the activity was captured */
  timestamp: Date;
  /** Direction of the activity */
  direction: "inbound" | "outbound";
  /** Activity type (e.g., Create, Follow, Like) */
  type: string;
  /** Original activity ID if available */
  activityId?: string;
  /** Raw activity data */
  rawActivity: unknown;

  /** Actor information */
  actor?: ActorInfo;
  /** Target actor for targeted activities */
  target?: ActorInfo;
  /** Activity object summary */
  object?: ObjectInfo;

  /** HTTP context information */
  context?: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };

  /** Signature verification details */
  signature?: SignatureInfo;

  /** Delivery information (outbound only) */
  recipients?: string[];
  delivery?: DeliveryInfo;

  /** User-defined tags for filtering */
  tags?: string[];
}

/**
 * Simplified actor information for debugging.
 * @since 1.9.0
 */
export interface ActorInfo {
  id: string;
  type: string;
  name?: string;
  preferredUsername?: string;
  inbox?: string;
  domain?: string;
}

/**
 * Object information for activities.
 * @since 1.9.0
 */
export interface ObjectInfo {
  id?: string;
  type: string;
  summary?: string;
  content?: string;
}

/**
 * Signature verification information.
 * @since 1.9.0
 */
export interface SignatureInfo {
  present: boolean;
  verified?: boolean;
  algorithm?: string;
  keyId?: string;
  creator?: string;
  created?: Date;
  expires?: Date;
  error?: string;
  verificationTime?: number;
}

/**
 * Activity delivery information.
 * @since 1.9.0
 */
export interface DeliveryInfo {
  status: "pending" | "success" | "failed" | "retrying";
  attempts: number;
  lastAttempt?: Date;
  nextRetry?: Date;
  error?: string;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
}

/**
 * Filters for searching activities.
 * @since 1.9.0
 */
export interface ActivityFilters {
  /** Time range */
  startTime?: Date;
  endTime?: Date;

  /** Basic filters */
  direction?: ("inbound" | "outbound")[];
  types?: string[];
  actors?: string[];

  /** Status filters */
  signatureStatus?: "verified" | "failed" | "none";
  deliveryStatus?: DeliveryInfo["status"][];

  /** Search */
  searchText?: string;

  /** Pagination */
  limit?: number;
  offset?: number;

  /** Sorting */
  sortBy?: "timestamp" | "type" | "actor";
  sortOrder?: "asc" | "desc";
}

/**
 * Store statistics.
 * @since 1.9.0
 */
export interface StoreStatistics {
  totalActivities: number;
  inboundActivities: number;
  outboundActivities: number;
  oldestActivity?: Date;
  newestActivity?: Date;
  activityTypes: Record<string, number>;
  signatureStats: {
    verified: number;
    failed: number;
    none: number;
  };
}
