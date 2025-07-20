import type { Activity, Context } from "@fedify/fedify";
import { getTypeId } from "@fedify/fedify/vocab";

/**
 * Debug activity with minimal information for dashboard display
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
}

/**
 * Check if an object has a type property
 */
interface ActivityLike {
  type?: string;
  id?: string | URL | { toString(): string };
}

/**
 * Check if object has a type property
 */
function hasTypeProperty(obj: unknown): obj is ActivityLike {
  return typeof obj === "object" && obj !== null && "type" in obj;
}

/**
 * Subscriber callback for activity notifications
 */
type ActivitySubscriber = (activity: DebugActivity) => void;

/**
 * Unsubscribe function returned by subscribe()
 */
type UnsubscribeFn = () => void;

/**
 * Intercepts and captures ActivityPub activities for debugging
 */
export class ActivityInterceptor {
  private running = false;
  private subscribers = new Set<ActivitySubscriber>();
  private activityCounter = 0;

  /**
   * Start intercepting activities
   */
  start(): void {
    this.running = true;
  }

  /**
   * Stop intercepting activities
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Subscribe to activity notifications
   */
  subscribe(callback: ActivitySubscriber): UnsubscribeFn {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Capture an inbound activity
   */
  captureInbound<TContextData>(
    _context: Context<TContextData>,
    activity: Activity,
  ): void {
    if (!this.running) return;

    const debugActivity = this.createDebugActivity(activity, "inbound");
    this.notifySubscribers(debugActivity);
  }

  /**
   * Capture an outbound activity
   */
  captureOutbound<TContextData>(
    _context: Context<TContextData>,
    activity: Activity,
  ): void {
    if (!this.running) return;

    const debugActivity = this.createDebugActivity(activity, "outbound");
    this.notifySubscribers(debugActivity);
  }

  /**
   * Create a debug activity from an ActivityPub activity
   */
  private createDebugActivity(
    activity: Activity,
    direction: "inbound" | "outbound",
  ): DebugActivity {
    let type = "Unknown";

    // First, check if it's a mock/test object with direct type property
    const activityAsUnknown = activity as unknown;
    if (hasTypeProperty(activityAsUnknown) && activityAsUnknown.type) {
      type = activityAsUnknown.type;
    } else {
      // For real Fedify objects, try to use getTypeId
      try {
        const typeId = getTypeId(activity);
        if (typeId) {
          // Extract the fragment (e.g., "Create" from "https://www.w3.org/ns/activitystreams#Create")
          type = typeId.hash.substring(1) || typeId.pathname.split("/").pop() ||
            "Unknown";
        }
      } catch {
        // If getTypeId fails, keep the default "Unknown"
      }
    }

    return {
      id: `debug-${++this.activityCounter}-${Date.now()}`,
      timestamp: new Date(),
      direction,
      type,
      activityId: activity.id?.toString(),
      rawActivity: activity,
    };
  }

  /**
   * Notify all subscribers of a new activity
   */
  private notifySubscribers(activity: DebugActivity): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(activity);
      } catch (error) {
        // Prevent subscriber errors from affecting other subscribers
        console.error("Subscriber error:", error);
      }
    }
  }
}
