/**
 * DebugObserver implementation for ActivityPub federation debugging.
 *
 * @module
 * @since 1.9.0
 */

import type { Context, FederationObserver } from "@fedify/fedify/federation";
import { type Activity, getTypeId } from "@fedify/fedify/vocab";
import { ActivityStore } from "./store.ts";
import type { ActorInfo, DebugActivity, ObjectInfo } from "./types.ts";

/**
 * Options for configuring the DebugObserver.
 * @since 1.9.0
 */
export interface DebugObserverOptions {
  /**
   * The path where the debug dashboard will be served.
   * @default "/__debugger__"
   */
  path?: string;

  /**
   * Maximum number of activities to store in memory.
   * @default 1000
   */
  maxActivities?: number;

  /**
   * Whether to run in production mode with enhanced security.
   * @default false
   */
  production?: boolean;

  /**
   * Access token for authentication in production mode.
   */
  token?: string;

  /**
   * IP addresses allowed to access the dashboard.
   */
  ipAllowlist?: string[];
}

/**
 * Implementation of FederationObserver for debugging ActivityPub activities.
 *
 * This observer captures and stores ActivityPub activities for real-time
 * monitoring and debugging through a web dashboard.
 *
 * @example
 * ```typescript
 * import { createFederation } from "@fedify/fedify";
 * import { DebugObserver } from "@fedify/debugger";
 *
 * const debugObserver = new DebugObserver({
 *   path: "/__debugger__",
 *   maxActivities: 1000,
 * });
 *
 * const federation = createFederation({
 *   kv: new MemoryKvStore(),
 *   observers: [debugObserver],
 * });
 * ```
 *
 * @typeParam TContextData The context data type.
 * @since 1.9.0
 */
export class DebugObserver<TContextData>
  implements FederationObserver<TContextData> {
  private store: ActivityStore;
  private path: string;
  private production: boolean;
  private token?: string;
  private ipAllowlist?: string[];
  private activityCounter = 0;

  constructor(options: DebugObserverOptions = {}) {
    this.path = options.path ?? "/__debugger__";
    this.store = new ActivityStore(options.maxActivities ?? 1000);
    this.production = options.production ?? false;
    this.token = options.token;
    this.ipAllowlist = options.ipAllowlist;
  }

  /**
   * Called when an inbound activity is received.
   */
  async onInboundActivity(
    context: Context<TContextData>,
    activity: Activity,
  ): Promise<void> {
    const debugActivity = await this.captureActivity(
      context,
      activity,
      "inbound",
    );
    this.store.insert(debugActivity);
  }

  /**
   * Called when an outbound activity is about to be sent.
   */
  async onOutboundActivity(
    context: Context<TContextData>,
    activity: Activity,
  ): Promise<void> {
    const debugActivity = await this.captureActivity(
      context,
      activity,
      "outbound",
    );
    this.store.insert(debugActivity);
  }

  /**
   * Captures activity information for debugging.
   */
  private async captureActivity(
    context: Context<TContextData>,
    activity: Activity,
    direction: "inbound" | "outbound",
  ): Promise<DebugActivity> {
    const id = `activity-${++this.activityCounter}`;
    const timestamp = new Date();
    const type = getTypeId(activity).href;

    // Extract actor information
    const actor = this.extractActorInfo(activity);
    const target = this.extractTargetInfo(activity);
    const object = this.extractObjectInfo(activity);

    // Capture HTTP context if available
    const httpContext = this.extractHttpContext(context);

    const debugActivity: DebugActivity = {
      id,
      timestamp,
      direction,
      type,
      activityId: activity.id?.href,
      rawActivity: await activity.toJsonLd(),
      actor,
      target,
      object,
      context: httpContext,
    };

    return debugActivity;
  }

  /**
   * Extracts actor information from an activity.
   */
  private extractActorInfo(activity: Activity): ActorInfo | undefined {
    // Activity has actorId getter that returns the actor's @id
    const actorId = (activity as any).actorId;
    if (!actorId || !(actorId instanceof URL)) return undefined;

    return {
      id: actorId.href,
      type: "Actor",
      domain: actorId.hostname,
    };
  }

  /**
   * Extracts target information from an activity.
   */
  private extractTargetInfo(activity: Activity): ActorInfo | undefined {
    if (!("target" in activity) || !activity.target) return undefined;

    const target = activity.target;
    if (!target || typeof target !== "object" || !("id" in target)) {
      return undefined;
    }

    const targetId = target.id;
    if (!targetId || !(targetId instanceof URL)) return undefined;

    return {
      id: targetId.href,
      type: "Actor",
      domain: targetId.hostname,
    };
  }

  /**
   * Extracts object information from an activity.
   */
  private extractObjectInfo(activity: Activity): ObjectInfo | undefined {
    if (!("object" in activity) || !activity.object) return undefined;

    const object = activity.object;
    if (!object || typeof object !== "object") return undefined;

    const objectType = "type" in object && typeof object.type === "string"
      ? object.type
      : "Object";

    const objectInfo: ObjectInfo = {
      type: objectType,
    };

    if ("id" in object && object.id instanceof URL) {
      objectInfo.id = object.id.href;
    }

    if ("summary" in object && typeof object.summary === "string") {
      objectInfo.summary = object.summary;
    }

    if ("content" in object && typeof object.content === "string") {
      objectInfo.content = object.content;
    }

    return objectInfo;
  }

  /**
   * Extracts HTTP context information.
   */
  private extractHttpContext(
    context: Context<TContextData>,
  ): DebugActivity["context"] {
    // Context might have request information if it's a RequestContext
    // For now, return basic information based on the origin
    return {
      url: `${context.origin}/inbox`, // Default inbox URL
      method: "POST", // Most ActivityPub requests are POST
      headers: {}, // Headers would need to be passed from the federation layer
    };
  }

  /**
   * Gets the activity store.
   */
  getStore(): ActivityStore {
    return this.store;
  }

  /**
   * Gets the dashboard path.
   */
  getPath(): string {
    return this.path;
  }

  /**
   * Gets the production mode setting.
   */
  isProduction(): boolean {
    return this.production;
  }

  /**
   * Gets the access token.
   */
  getToken(): string | undefined {
    return this.token;
  }

  /**
   * Gets the IP allowlist.
   */
  getIpAllowlist(): string[] | undefined {
    return this.ipAllowlist;
  }
}
