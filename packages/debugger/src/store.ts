/**
 * ActivityStore implementation for the debugger.
 *
 * @module
 * @since 1.9.0
 */

import type {
  ActivityFilters,
  DebugActivity,
  StoreStatistics,
} from "./types.ts";

/**
 * Default store capacity.
 */
export const DEFAULT_STORE_CAPACITY = 1000;

/**
 * Subscriber callback for new activities.
 */
type StoreSubscriber = (activity: DebugActivity) => void;

/**
 * Circular buffer store for debug activities.
 *
 * This store maintains a fixed-size circular buffer of activities,
 * automatically evicting the oldest activities when the capacity is reached.
 *
 * @since 1.9.0
 */
export class ActivityStore {
  private readonly capacity: number;
  private activities: DebugActivity[] = [];
  private activityMap = new Map<string, DebugActivity>();
  private subscribers = new Set<StoreSubscriber>();
  private head = 0;
  private size = 0;

  constructor(capacity = DEFAULT_STORE_CAPACITY) {
    this.capacity = capacity;
    this.activities = new Array(capacity);
  }

  /**
   * Insert a new activity into the store.
   */
  insert(activity: DebugActivity): void {
    // If at capacity, remove the oldest activity
    if (this.size === this.capacity) {
      const oldActivity = this.activities[this.head];
      if (oldActivity) {
        this.activityMap.delete(oldActivity.id);
      }
    }

    // Insert the new activity
    this.activities[this.head] = activity;
    this.activityMap.set(activity.id, activity);

    // Update circular buffer pointers
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }

    // Notify subscribers
    this.notifySubscribers(activity);
  }

  /**
   * Get an activity by ID.
   */
  get(id: string): DebugActivity | null {
    return this.activityMap.get(id) || null;
  }

  /**
   * Get all activities in insertion order.
   */
  getAll(): DebugActivity[] {
    const result: DebugActivity[] = [];

    if (this.size < this.capacity) {
      // Buffer not full, return activities from 0 to head
      for (let i = 0; i < this.size; i++) {
        result.push(this.activities[i]);
      }
    } else {
      // Buffer full, return activities in circular order
      let index = this.head;
      for (let i = 0; i < this.size; i++) {
        result.push(this.activities[index]);
        index = (index + 1) % this.capacity;
      }
    }

    return result;
  }

  /**
   * Search activities with filters.
   */
  search(filters: ActivityFilters): DebugActivity[] {
    let activities = this.getAll();

    // Filter by direction
    if (filters.direction && filters.direction.length > 0) {
      activities = activities.filter((a) =>
        filters.direction!.includes(a.direction)
      );
    }

    // Filter by types
    if (filters.types && filters.types.length > 0) {
      activities = activities.filter((a) => filters.types!.includes(a.type));
    }

    // Filter by time range
    if (filters.startTime) {
      activities = activities.filter((a) => a.timestamp >= filters.startTime!);
    }
    if (filters.endTime) {
      activities = activities.filter((a) => a.timestamp <= filters.endTime!);
    }

    // Filter by actors
    if (filters.actors && filters.actors.length > 0) {
      activities = activities.filter((a) =>
        a.actor && filters.actors!.includes(a.actor.id)
      );
    }

    // Filter by signature status
    if (filters.signatureStatus) {
      activities = activities.filter((a) => {
        if (!a.signature) return filters.signatureStatus === "none";
        if (a.signature.verified === true) {
          return filters.signatureStatus === "verified";
        }
        if (a.signature.verified === false) {
          return filters.signatureStatus === "failed";
        }
        return filters.signatureStatus === "none";
      });
    }

    // Filter by delivery status
    if (filters.deliveryStatus && filters.deliveryStatus.length > 0) {
      activities = activities.filter((a) =>
        a.delivery && filters.deliveryStatus!.includes(a.delivery.status)
      );
    }

    // Apply sorting
    const sortBy = filters.sortBy ?? "timestamp";
    const sortOrder = filters.sortOrder ?? "desc";

    activities.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "timestamp":
          comparison = a.timestamp.getTime() - b.timestamp.getTime();
          break;
        case "type":
          comparison = a.type.localeCompare(b.type);
          break;
        case "actor":
          comparison = (a.actor?.id ?? "").localeCompare(b.actor?.id ?? "");
          break;
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    // Apply pagination
    if (filters.offset !== undefined || filters.limit !== undefined) {
      const offset = filters.offset ?? 0;
      const limit = filters.limit ?? activities.length;
      activities = activities.slice(offset, offset + limit);
    }

    return activities;
  }

  /**
   * Search activities by text.
   */
  searchText(query: string): DebugActivity[] {
    const lowerQuery = query.toLowerCase();

    return this.getAll().filter((activity) => {
      // Search in activity ID
      if (activity.activityId?.toLowerCase().includes(lowerQuery)) return true;

      // Search in type
      if (activity.type.toLowerCase().includes(lowerQuery)) return true;

      // Search in actor
      if (activity.actor?.id.toLowerCase().includes(lowerQuery)) return true;
      if (activity.actor?.name?.toLowerCase().includes(lowerQuery)) return true;
      if (
        activity.actor?.preferredUsername?.toLowerCase().includes(lowerQuery)
      ) return true;

      // Search in object
      if (activity.object?.summary?.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      if (activity.object?.content?.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      // Search in raw activity (stringified)
      const rawStr = JSON.stringify(activity.rawActivity).toLowerCase();
      if (rawStr.includes(lowerQuery)) return true;

      return false;
    });
  }

  /**
   * Clear all activities.
   */
  clear(): void {
    this.activities = new Array(this.capacity);
    this.activityMap.clear();
    this.head = 0;
    this.size = 0;
  }

  /**
   * Get store statistics.
   */
  getStats(): StoreStatistics {
    const activities = this.getAll();
    const activityTypes: Record<string, number> = {};
    let inboundCount = 0;
    let outboundCount = 0;
    let verifiedCount = 0;
    let failedCount = 0;
    let noSigCount = 0;

    for (const activity of activities) {
      // Count by type
      activityTypes[activity.type] = (activityTypes[activity.type] || 0) + 1;

      // Count by direction
      if (activity.direction === "inbound") {
        inboundCount++;
      } else {
        outboundCount++;
      }

      // Count by signature status
      if (!activity.signature) {
        noSigCount++;
      } else if (activity.signature.verified === true) {
        verifiedCount++;
      } else if (activity.signature.verified === false) {
        failedCount++;
      }
    }

    return {
      totalActivities: this.size,
      inboundActivities: inboundCount,
      outboundActivities: outboundCount,
      oldestActivity: activities[0]?.timestamp,
      newestActivity: activities[activities.length - 1]?.timestamp,
      activityTypes,
      signatureStats: {
        verified: verifiedCount,
        failed: failedCount,
        none: noSigCount,
      },
    };
  }

  /**
   * Subscribe to new activities.
   * @returns Unsubscribe function
   */
  subscribe(callback: StoreSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Notify all subscribers of a new activity.
   */
  private notifySubscribers(activity: DebugActivity): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(activity);
      } catch (error) {
        console.error("Error in activity store subscriber:", error);
      }
    }
  }
}
