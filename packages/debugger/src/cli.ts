#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * CLI tool for debugging Fedify applications.
 *
 * This connects to a running Fedify application's debug endpoint
 * and displays activities in the terminal.
 *
 * @module
 * @since 1.9.0
 */

import { parseArgs } from "@std/cli/parse-args";
import { bold, cyan, dim, gray, green, red, yellow } from "@std/fmt/colors";
import { format } from "@std/datetime/format";
import type { DebugActivity } from "./types.ts";

interface CLIOptions {
  url: string;
  filter?: string;
  direction?: "inbound" | "outbound";
  follow: boolean;
  json: boolean;
  help: boolean;
}

/**
 * Main CLI entry point.
 */
async function main() {
  const args = parseArgs(Deno.args, {
    string: ["url", "filter", "direction"],
    boolean: ["follow", "json", "help"],
    alias: {
      u: "url",
      f: "filter",
      d: "direction",
      w: "follow",
      j: "json",
      h: "help",
    },
    default: {
      url: "http://localhost:3000/__debugger__",
      follow: false,
      json: false,
      help: false,
    },
  });

  const options: CLIOptions = {
    url: args.url as string,
    filter: args.filter as string | undefined,
    direction: args.direction as "inbound" | "outbound" | undefined,
    follow: args.follow as boolean,
    json: args.json as boolean,
    help: args.help as boolean,
  };

  if (options.help) {
    printHelp();
    return;
  }

  try {
    await runDebugger(options);
  } catch (error) {
    console.error(
      red(`Error: ${error instanceof Error ? error.message : String(error)}`),
    );
    Deno.exit(1);
  }
}

/**
 * Print help message.
 */
function printHelp() {
  console.log(`
${bold("fedify-debug")} - ActivityPub debugger for Fedify applications

${bold("USAGE:")}
  fedify-debug [OPTIONS]

${bold("OPTIONS:")}
  -u, --url <URL>        Debug endpoint URL (default: http://localhost:3000/__debugger__)
  -f, --filter <TEXT>    Filter activities by text search
  -d, --direction <DIR>  Filter by direction: inbound or outbound
  -w, --follow           Follow mode - show new activities as they arrive
  -j, --json             Output raw JSON instead of formatted text
  -h, --help             Show this help message

${bold("EXAMPLES:")}
  # Connect to local debugger
  fedify-debug

  # Connect to remote debugger
  fedify-debug --url https://example.com/__debugger__

  # Follow new activities
  fedify-debug --follow

  # Filter by direction
  fedify-debug --direction inbound

  # Search for specific text
  fedify-debug --filter "Create"

  # Output as JSON
  fedify-debug --json
`);
}

/**
 * Run the debugger CLI.
 */
async function runDebugger(options: CLIOptions) {
  const baseUrl = options.url.replace(/\/$/, "");

  // Test connection
  console.log(dim(`Connecting to ${baseUrl}...`));

  try {
    const response = await fetch(`${baseUrl}/api/stats`);
    if (!response.ok) {
      throw new Error(
        `Failed to connect: ${response.status} ${response.statusText}`,
      );
    }
    const stats = await response.json();
    console.log(
      green(`✓ Connected to debugger (${stats.totalActivities} activities)`),
    );
    console.log("");
  } catch (error) {
    throw new Error(
      `Cannot connect to debugger at ${baseUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (options.follow) {
    // Follow mode - poll for new activities
    await followActivities(baseUrl, options);
  } else {
    // List existing activities
    await listActivities(baseUrl, options);
  }
}

/**
 * List existing activities.
 */
async function listActivities(baseUrl: string, options: CLIOptions) {
  const params = new URLSearchParams();

  if (options.filter) {
    params.set("searchText", options.filter);
  }

  if (options.direction) {
    params.set("direction", options.direction);
  }

  params.set("sortOrder", "desc");
  params.set("limit", "50");

  const response = await fetch(`${baseUrl}/api/activities?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch activities: ${response.status}`);
  }

  const data = await response.json();
  const activities = data.activities as DebugActivity[];

  if (activities.length === 0) {
    console.log(dim("No activities found"));
    return;
  }

  console.log(bold(`Found ${activities.length} activities:\n`));

  for (const activity of activities) {
    if (options.json) {
      console.log(JSON.stringify(activity));
    } else {
      printActivity(activity);
    }
  }
}

/**
 * Follow new activities as they arrive.
 */
async function followActivities(baseUrl: string, options: CLIOptions) {
  console.log(dim("Following new activities... (Press Ctrl+C to stop)\n"));

  let lastTimestamp: Date | null = null;
  let retryDelay = 1000; // Start with 1 second
  const maxRetryDelay = 30000; // Max 30 seconds

  while (true) {
    try {
      // Fetch recent activities
      const params = new URLSearchParams();
      params.set("sortOrder", "desc");
      params.set("limit", "10");

      if (lastTimestamp) {
        // Only get activities newer than the last one we saw
        params.set("startTime", lastTimestamp.toISOString());
      }

      const response = await fetch(`${baseUrl}/api/activities?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch activities: ${response.status}`);
      }

      const data = await response.json();
      const activities = data.activities as DebugActivity[];

      // Process new activities in chronological order
      const newActivities = activities
        .filter((a) => !lastTimestamp || new Date(a.timestamp) > lastTimestamp)
        .reverse();

      for (const activity of newActivities) {
        // Apply filters
        if (options.filter && !matchesFilter(activity, options.filter)) {
          continue;
        }

        if (options.direction && activity.direction !== options.direction) {
          continue;
        }

        if (options.json) {
          console.log(JSON.stringify(activity));
        } else {
          printActivity(activity, true);
        }

        const activityTime = new Date(activity.timestamp);
        if (!lastTimestamp || activityTime > lastTimestamp) {
          lastTimestamp = activityTime;
        }
      }

      // Reset retry delay on success
      retryDelay = 1000;

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(
        red(
          `Connection error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
      console.log(dim(`Retrying in ${retryDelay / 1000} seconds...`));

      await new Promise((resolve) => setTimeout(resolve, retryDelay));

      // Exponential backoff
      retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
    }
  }
}

/**
 * Check if activity matches filter text.
 */
function matchesFilter(activity: DebugActivity, filter: string): boolean {
  const lowerFilter = filter.toLowerCase();

  // Check type
  if (activity.type.toLowerCase().includes(lowerFilter)) return true;

  // Check actor
  if (activity.actor?.id.toLowerCase().includes(lowerFilter)) return true;
  if (activity.actor?.name?.toLowerCase().includes(lowerFilter)) return true;

  // Check activity ID
  if (activity.activityId?.toLowerCase().includes(lowerFilter)) return true;

  // Check object content
  if (activity.object?.content?.toLowerCase().includes(lowerFilter)) {
    return true;
  }
  if (activity.object?.summary?.toLowerCase().includes(lowerFilter)) {
    return true;
  }

  return false;
}

/**
 * Print a formatted activity.
 */
function printActivity(activity: DebugActivity, realtime = false) {
  const timestamp = format(new Date(activity.timestamp), "HH:mm:ss");
  const direction = activity.direction === "inbound" ? "←" : "→";
  const directionColor = activity.direction === "inbound" ? cyan : green;
  const type = activity.type.split("#").pop() || activity.type;

  // Build the main line
  let line = `${gray(timestamp)} ${directionColor(direction)} ${bold(type)}`;

  if (activity.actor) {
    const actorName = activity.actor.preferredUsername ||
      activity.actor.name ||
      new URL(activity.actor.id).hostname;
    line += ` from ${yellow(actorName)}`;
  }

  if (realtime) {
    line = "• " + line;
  }

  console.log(line);

  // Show object summary if available
  if (activity.object) {
    const indent = realtime ? "    " : "  ";

    if (activity.object.summary) {
      console.log(indent + dim(activity.object.summary));
    } else if (activity.object.content) {
      const preview = activity.object.content
        .replace(/<[^>]*>/g, "") // Strip HTML
        .replace(/\s+/g, " ") // Normalize whitespace
        .trim()
        .substring(0, 80);

      console.log(
        indent +
          dim(preview + (activity.object.content.length > 80 ? "..." : "")),
      );
    }
  }

  // Show signature status
  if (activity.signature) {
    const indent = realtime ? "    " : "  ";
    if (activity.signature.verified === true) {
      console.log(indent + green("✓ Signature verified"));
    } else if (activity.signature.verified === false) {
      console.log(indent + red("✗ Signature verification failed"));
    }
  }

  // Show delivery status for outbound
  if (activity.direction === "outbound" && activity.delivery) {
    const indent = realtime ? "    " : "  ";
    const status = activity.delivery.status;
    const statusText = status === "success"
      ? green("Delivered")
      : status === "failed"
      ? red("Delivery failed")
      : status === "retrying"
      ? yellow("Retrying")
      : dim("Pending");
    console.log(indent + statusText);
  }

  console.log(""); // Empty line between activities
}

// Run the CLI
if (import.meta.main) {
  main();
}
