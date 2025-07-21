import { ActivityInterceptor } from "./interceptor.ts";
import { ActivityStore } from "./store.ts";
import { type FormatterOptions, TerminalFormatter } from "./formatter.ts";
import { gray } from "@std/fmt/colors";
import type { DebugActivity } from "./interceptor.ts";

export interface TerminalDebugOptions extends FormatterOptions {
  follow?: boolean;
  tail?: number;
  filter?: {
    direction?: "inbound" | "outbound";
    type?: string;
  };
  stats?: boolean;
}

export class TerminalDebugger {
  private interceptor: ActivityInterceptor;
  private store: ActivityStore;
  private formatter: TerminalFormatter;
  private options: TerminalDebugOptions;
  private isRunning = false;

  constructor(options: TerminalDebugOptions = {}) {
    this.options = options;
    this.interceptor = new ActivityInterceptor();
    this.store = new ActivityStore(1000); // Store last 1000 activities
    this.formatter = new TerminalFormatter(options);

    // Connect interceptor to store
    this.interceptor.subscribe((activity) => {
      this.store.insert(activity);

      // If following, print new activities immediately
      if (this.options.follow && this.matchesFilter(activity)) {
        this.printActivity(activity);
      }
    });
  }

  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.interceptor.start();

    console.log(this.formatter.formatInfo("Debug terminal started"));

    if (this.options.stats) {
      this.printStatistics();
    }

    if (!this.options.follow) {
      // Print existing activities and exit
      this.printExistingActivities();
    } else {
      // Follow mode - print header
      console.log(
        this.formatter.formatInfo(
          "Following activities... Press Ctrl+C to exit",
        ),
      );
      console.log("");

      // Set up periodic stats update if requested
      if (this.options.stats) {
        setInterval(() => {
          this.clearScreen();
          this.printStatistics();
          console.log("");
        }, 5000); // Update every 5 seconds
      }
    }
  }

  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    this.interceptor.stop();
    console.log("");
    console.log(this.formatter.formatInfo("Debug terminal stopped"));
  }

  private matchesFilter(activity: DebugActivity): boolean {
    if (!this.options.filter) return true;

    const { direction, type } = this.options.filter;

    if (direction && activity.direction !== direction) {
      return false;
    }

    if (type && !activity.type.toLowerCase().includes(type.toLowerCase())) {
      return false;
    }

    return true;
  }

  private printActivity(activity: DebugActivity): void {
    console.log(this.formatter.formatActivity(activity));
    console.log(gray("─".repeat(60)));
  }

  private printExistingActivities(): void {
    const activities = this.store.getAll()
      .filter((activity) => this.matchesFilter(activity));

    const tail = this.options.tail;
    const displayActivities = tail && tail > 0
      ? activities.slice(-tail)
      : activities;

    if (displayActivities.length === 0) {
      console.log(gray("No activities match the filter criteria."));
      return;
    }

    console.log(this.formatter.formatActivityStream(displayActivities));
  }

  private printStatistics(): void {
    const stats = this.store.getStats();
    console.log(this.formatter.formatStatistics(stats));
  }

  private clearScreen(): void {
    console.clear();
  }

  // Interactive mode methods
  async runInteractive(): Promise<void> {
    this.start();

    if (!this.options.follow) {
      return; // Exit after printing
    }

    // Handle Ctrl+C gracefully
    const handleInterrupt = () => {
      this.stop();
      Deno.exit(0);
    };

    Deno.addSignalListener("SIGINT", handleInterrupt);

    // Keep the process running
    await new Promise(() => {});
  }

  // Export activities to file
  async exportActivities(filepath: string): Promise<void> {
    const activities = this.store.getAll()
      .filter((activity) => this.matchesFilter(activity));

    const data = {
      exported: new Date().toISOString(),
      statistics: this.store.getStats(),
      activities: activities,
    };

    try {
      await Deno.writeTextFile(filepath, JSON.stringify(data, null, 2));
      console.log(
        this.formatter.formatSuccess(
          `Exported ${activities.length} activities to ${filepath}`,
        ),
      );
    } catch (error) {
      console.log(this.formatter.formatError(error as Error));
    }
  }

  // Import activities from file
  async importActivities(filepath: string): Promise<void> {
    try {
      const content = await Deno.readTextFile(filepath);
      const data = JSON.parse(content);

      if (!data.activities || !Array.isArray(data.activities)) {
        throw new Error("Invalid export file format");
      }

      for (const activity of data.activities) {
        this.store.insert(activity);
      }

      console.log(
        this.formatter.formatSuccess(
          `Imported ${data.activities.length} activities from ${filepath}`,
        ),
      );
    } catch (error) {
      console.log(this.formatter.formatError(error as Error));
    }
  }
}

// Convenience function for CLI usage
export async function runTerminalDebug(
  options: TerminalDebugOptions = {},
): Promise<void> {
  const terminalDebugger = new TerminalDebugger(options);
  await terminalDebugger.runInteractive();
}
