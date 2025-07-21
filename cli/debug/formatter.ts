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
    const raw = activity.rawActivity as Record<string, unknown> | null;

    // Header
    const directionColor = activity.direction === "inbound" ? blue : yellow;
    const direction = this.applyColor(
      `[${activity.direction.toUpperCase()}]`,
      directionColor,
      bold,
    );
    const type = this.applyColor(activity.type, cyan);
    lines.push(`${direction} ${type}`);

    // ID
    if (activity.activityId) {
      lines.push(`  ${this.label("ID:")} ${activity.activityId}`);
    }

    // Actor, Object, Target
    ["actor", "object", "target"].forEach((field) => {
      const value = raw ? this.extractEntity(raw, field) : undefined;
      if (value !== undefined) {
        lines.push(`  ${this.label(`${this.capitalize(field)}:`)} ${value}`);
      }
    });

    // Timestamp
    if (this.options.showTimestamp) {
      const timestamp = new Date(activity.timestamp).toISOString();
      lines.push(`  ${this.label("Time:")} ${timestamp}`);
    }

    // Raw Activity
    if (this.options.showRawActivity && raw) {
      lines.push("");
      lines.push(this.label("Raw Activity:"));
      lines.push(JSON.stringify(raw, null, 2));
    }

    return lines.join("\n");
  }

  formatStatistics(stats: StoreStatistics): string {
    const lines: string[] = [];

    lines.push(this.applyColor("=== Activity Statistics ===", bold));
    lines.push("");

    lines.push(
      `Total Activities: ${
        this.applyColor(stats.totalActivities.toString(), green)
      }`,
    );
    lines.push(
      `Inbound:          ${
        this.applyColor(stats.inboundCount.toString(), blue)
      }`,
    );
    lines.push(
      `Outbound:         ${
        this.applyColor(stats.outboundCount.toString(), yellow)
      }`,
    );

    if (stats.typeBreakdown && Object.keys(stats.typeBreakdown).length > 0) {
      lines.push("");
      lines.push(this.applyColor("Activity Types:", bold));

      const sorted = Object.entries(stats.typeBreakdown).sort(([, a], [, b]) =>
        b - a
      );
      for (const [type, count] of sorted) {
        const typeStr = this.applyColor(type, cyan);
        const countStr = this.applyColor(`(${count})`, gray);
        lines.push(`  ${typeStr} ${countStr}`);
      }
    }

    return lines.join("\n");
  }

  formatActivityStream(activities: DebugActivity[]): string {
    if (activities.length === 0) {
      return this.applyColor("No activities captured yet.", gray);
    }

    const separator = this.applyColor("─".repeat(60), gray);
    return activities
      .map((activity) => this.formatActivity(activity))
      .join(`\n${separator}\n`);
  }

  formatError(error: Error): string {
    return this.formatTaggedMessage("ERROR", red, error.message);
  }

  formatSuccess(message: string): string {
    return this.formatTaggedMessage("SUCCESS", green, message);
  }

  formatWarning(message: string): string {
    return this.formatTaggedMessage("WARNING", yellow, message);
  }

  formatInfo(message: string): string {
    return this.formatTaggedMessage("INFO", blue, message);
  }

  private label(text: string): string {
    return this.applyColor(text, gray);
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private applyColor(text: string, ...fns: ((s: string) => string)[]): string {
    return this.options.colorize ? fns.reduce((s, fn) => fn(s), text) : text;
  }

  private formatTaggedMessage(
    tag: string,
    colorFn: (s: string) => string,
    message: string,
  ): string {
    const tagStr = this.applyColor(`[${tag}]`, colorFn, bold);
    return `${tagStr} ${message}`;
  }

  private extractEntity(
    raw: Record<string, unknown>,
    field: string,
  ): string | undefined {
    const val = raw[field];
    if (typeof val === "string") return val;
    if (typeof val === "object" && val !== null) {
      const rec = val as Record<string, unknown>;
      return (rec.id as string) || (rec.type as string) || "[Object]";
    }
    return val !== undefined ? String(val) : undefined;
  }
}

export function createFormatter(options?: FormatterOptions): TerminalFormatter {
  return new TerminalFormatter(options);
}
