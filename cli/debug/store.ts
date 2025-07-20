import type { DebugActivity } from "./interceptor.ts";

/**
 * Search filters for activities
 */
export interface ActivityFilters {
  /** Filter by activity types */
  types?: string[];
  /** Filter by direction */
  direction?: ("inbound" | "outbound")[];
  /** Filter by start time (inclusive) */
  startTime?: Date;
  /** Filter by end time (inclusive) */
  endTime?: Date;
}

/**
 * Store statistics
 */
export interface StoreStatistics {
  /** Total number of activities in store */
  totalActivities: number;
  /** Maximum capacity of the store */
  capacity: number;
  /** Number of inbound activities */
  inboundCount: number;
  /** Number of outbound activities */
  outboundCount: number;
}

/**
 * Subscriber callback for new activities
 */
type StoreSubscriber = (activity: DebugActivity) => void;

/**
 * Circular buffer store for debug activities
 */
export class ActivityStore {
  private readonly capacity: number;
  private activities: DebugActivity[] = [];
  private activityMap = new Map<string, DebugActivity>();
  private subscribers = new Set<StoreSubscriber>();
  private head = 0;
  private size = 0;

  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.activities = new Array(capacity);
  }

  /**
   * Insert a new activity into the store
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
   * Get an activity by ID
   */
  get(id: string): DebugActivity | null {
    return this.activityMap.get(id) || null;
  }

  /**
   * Get all activities in insertion order
   */
  getAll(): DebugActivity[] {
    const result: DebugActivity[] = [];

    if (this.size < this.capacity) {
      // Buffer not full, return activities from 0 to head
      for (let i = 0; i < this.size; i++) {
        result.push(this.activities[i]);
      }
    } else {
      // Buffer is full, return in correct order
      for (let i = 0; i < this.capacity; i++) {
        const index = (this.head + i) % this.capacity;
        result.push(this.activities[index]);
      }
    }

    return result;
  }

  /**
   * Search activities with filters
   */
  search(filters: ActivityFilters): DebugActivity[] {
    return this.getAll().filter((activity) => {
      // Filter by types
      if (filters.types && filters.types.length > 0) {
        if (!filters.types.includes(activity.type)) {
          return false;
        }
      }

      // Filter by direction
      if (filters.direction && filters.direction.length > 0) {
        if (!filters.direction.includes(activity.direction)) {
          return false;
        }
      }

      // Filter by time range
      if (filters.startTime) {
        if (activity.timestamp < filters.startTime) {
          return false;
        }
      }

      if (filters.endTime) {
        if (activity.timestamp > filters.endTime) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Clear all activities
   */
  clear(): void {
    this.activities = new Array(this.capacity);
    this.activityMap.clear();
    this.head = 0;
    this.size = 0;
  }

  /**
   * Get store statistics
   */
  getStats(): StoreStatistics {
    const all = this.getAll();
    const inboundCount = all.filter((a) => a.direction === "inbound").length;
    const outboundCount = all.filter((a) => a.direction === "outbound").length;

    return {
      totalActivities: this.size,
      capacity: this.capacity,
      inboundCount,
      outboundCount,
    };
  }

  /**
   * Subscribe to new activities
   */
  subscribe(callback: StoreSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
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
        console.error("Store subscriber error:", error);
      }
    }
  }
}
