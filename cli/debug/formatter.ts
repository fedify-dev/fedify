import { blue, bold, cyan, gray, green, red, yellow } from "@std/fmt/colors";
import type { DebugActivity } from "./interceptor.ts";
import type { StoreStatistics } from "./store.ts";

export interface FormatterOptions {
  showRawActivity?: boolean;
  showTimestamp?: boolean;
  colorize?: boolean;
}

export class TerminalFormatter {
  constructor(private options: FormatterOptions = {}) {
    this.options = {
      showRawActivity: false,
      showTimestamp: true,
      colorize: true,
      ...options,
    };
  }

  formatActivity(activity: DebugActivity): string {
    const lines: string[] = [];
    const { colorize } = this.options;

    // Header with direction and type
    const directionColor = activity.direction === "inbound" ? blue : yellow;
    const direction = colorize
      ? directionColor(bold(`[${activity.direction.toUpperCase()}]`))
      : `[${activity.direction.toUpperCase()}]`;

    const type = colorize ? cyan(activity.type) : activity.type;
    lines.push(`${direction} ${type}`);

    // Activity ID if present
    if (activity.activityId) {
      const label = colorize ? gray("ID:") : "ID:";
      lines.push(`  ${label} ${activity.activityId}`);
    }

    // Extract information from raw activity
    const raw = activity.rawActivity as Record<string, unknown> | null;
    
    // Actor information
    if (raw?.actor) {
      const label = colorize ? gray("Actor:") : "Actor:";
      const actor = typeof raw.actor === "string" 
        ? raw.actor 
        : (raw.actor as Record<string, unknown>)?.id || raw.actor;
      lines.push(`  ${label} ${actor}`);
    }

    // Object information
    if (raw?.object) {
      const label = colorize ? gray("Object:") : "Object:";
      const obj = raw.object;
      let objectStr: string;
      
      if (typeof obj === "string") {
        objectStr = obj;
      } else if (typeof obj === "object" && obj !== null) {
        const objRecord = obj as Record<string, unknown>;
        objectStr = objRecord.id as string || objRecord.type as string || "[Object]";
      } else {
        objectStr = String(obj);
      }
      
      lines.push(`  ${label} ${objectStr}`);
    }

    // Target information
    if (raw?.target) {
      const label = colorize ? gray("Target:") : "Target:";
      const target = typeof raw.target === "string"
        ? raw.target
        : (raw.target as Record<string, unknown>)?.id || raw.target;
      lines.push(`  ${label} ${target}`);
    }

    // Timestamp
    if (this.options.showTimestamp) {
      const timestamp = new Date(activity.timestamp).toISOString();
      const label = colorize ? gray("Time:") : "Time:";
      lines.push(`  ${label} ${timestamp}`);
    }

    // Raw activity (optional)
    if (this.options.showRawActivity && activity.rawActivity) {
      lines.push("");
      const label = colorize ? gray("Raw Activity:") : "Raw Activity:";
      lines.push(label);
      lines.push(JSON.stringify(activity.rawActivity, null, 2));
    }

    return lines.join("\n");
  }

  formatStatistics(stats: StoreStatistics): string {
    const { colorize } = this.options;
    const lines: string[] = [];

    lines.push(
      colorize
        ? bold("=== Activity Statistics ===")
        : "=== Activity Statistics ===",
    );
    lines.push("");

    const total = colorize
      ? green(stats.totalActivities.toString())
      : stats.totalActivities.toString();
    lines.push(`Total Activities: ${total}`);

    const inbound = colorize
      ? blue(stats.inboundCount.toString())
      : stats.inboundCount.toString();
    lines.push(`Inbound:          ${inbound}`);

    const outbound = colorize
      ? yellow(stats.outboundCount.toString())
      : stats.outboundCount.toString();
    lines.push(`Outbound:         ${outbound}`);

    // Type breakdown
    if (stats.typeBreakdown && Object.keys(stats.typeBreakdown).length > 0) {
      lines.push("");
      lines.push(colorize ? bold("Activity Types:") : "Activity Types:");

      const sortedTypes = Object.entries(stats.typeBreakdown)
        .sort(([, a], [, b]) => b - a);

      for (const [type, count] of sortedTypes) {
        const typeFormatted = colorize ? cyan(type) : type;
        const countFormatted = colorize ? gray(`(${count})`) : `(${count})`;
        lines.push(`  ${typeFormatted} ${countFormatted}`);
      }
    }

    return lines.join("\n");
  }

  formatActivityStream(activities: DebugActivity[]): string {
    if (activities.length === 0) {
      return this.options.colorize
        ? gray("No activities captured yet.")
        : "No activities captured yet.";
    }

    const separator = this.options.colorize
      ? gray("─".repeat(60))
      : "─".repeat(60);

    return activities
      .map((activity) => this.formatActivity(activity))
      .join(`\n${separator}\n`);
  }

  formatError(error: Error): string {
    const { colorize } = this.options;
    const errorTag = colorize ? red(bold("[ERROR]")) : "[ERROR]";
    return `${errorTag} ${error.message}`;
  }

  formatSuccess(message: string): string {
    const { colorize } = this.options;
    const successTag = colorize ? green(bold("[SUCCESS]")) : "[SUCCESS]";
    return `${successTag} ${message}`;
  }

  formatWarning(message: string): string {
    const { colorize } = this.options;
    const warningTag = colorize ? yellow(bold("[WARNING]")) : "[WARNING]";
    return `${warningTag} ${message}`;
  }

  formatInfo(message: string): string {
    const { colorize } = this.options;
    const infoTag = colorize ? blue(bold("[INFO]")) : "[INFO]";
    return `${infoTag} ${message}`;
  }
}

export function createFormatter(options?: FormatterOptions): TerminalFormatter {
  return new TerminalFormatter(options);
}
