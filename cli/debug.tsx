/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
import { Command } from "@cliffy/command";
import { getLogger } from "@logtape/logtape";
import ora from "ora";
// import open from "open";
import { ActivityInterceptor } from "./debug/interceptor.ts";
import { ActivityStore } from "./debug/store.ts";
import { DebugServer } from "./debug/server.ts";
import { runTerminalDebug } from "./debug/terminal.ts";

/**
 * Options for the debug command.
 */
export interface DebugOptions {
  /** Port number for the debug dashboard server */
  port: number;
  /** Disable opening browser automatically */
  browser: boolean;
  /** Run in terminal mode instead of web dashboard */
  terminal: boolean;
  /** Follow mode - continuously show new activities */
  follow: boolean;
  /** Show only last N activities */
  tail?: number;
  /** Filter by direction (inbound/outbound) */
  direction?: "inbound" | "outbound";
  /** Filter by activity type */
  type?: string;
  /** Show statistics */
  stats: boolean;
  /** Show raw activity JSON */
  raw: boolean;
  /** Export activities to file */
  export?: string;
}

const logger = getLogger(["fedify", "cli", "debug"]);

export const command = new Command()
  .description(
    "Debug ActivityPub federation activities by monitoring and displaying " +
      "them in real-time, either in terminal or web dashboard.",
  )
  .option(
    "-p, --port=<port:number>",
    "Port number for the debug dashboard server.",
    { default: 8080 },
  )
  .option(
    "--no-browser",
    "Do not automatically open the dashboard in a web browser.",
  )
  .option(
    "-t, --terminal",
    "Run in terminal mode instead of web dashboard.",
  )
  .option(
    "-f, --follow",
    "Follow mode - continuously show new activities (terminal mode only).",
  )
  .option(
    "--tail=<count:number>",
    "Show only last N activities (terminal mode only).",
  )
  .option(
    "--direction=<direction:string>",
    "Filter by direction: inbound or outbound (terminal mode only).",
  )
  .option(
    "--type=<type:string>",
    "Filter by activity type (terminal mode only).",
  )
  .option(
    "-s, --stats",
    "Show activity statistics (terminal mode only).",
  )
  .option(
    "--raw",
    "Show raw activity JSON (terminal mode only).",
  )
  .option(
    "--export=<file:string>",
    "Export activities to JSON file (terminal mode only).",
  )
  .action(async (options) => {
    // Check if running in terminal mode
    if (options.terminal) {
      try {
        const followOpt = Array.isArray(options.follow)
          ? options.follow[0]
          : options.follow;
        const tailOpt = Array.isArray(options.tail)
          ? options.tail[0]
          : options.tail;
        const directionOpt = Array.isArray(options.direction)
          ? options.direction[0]
          : options.direction;
        const typeOpt = Array.isArray(options.type)
          ? options.type[0]
          : options.type;
        const statsOpt = Array.isArray(options.stats)
          ? options.stats[0]
          : options.stats;
        const rawOpt = Array.isArray(options.raw)
          ? options.raw[0]
          : options.raw;

        await runTerminalDebug({
          follow: followOpt,
          tail: tailOpt,
          filter: {
            direction: directionOpt as "inbound" | "outbound" | undefined,
            type: typeOpt,
          },
          stats: statsOpt,
          showRawActivity: rawOpt,
          showTimestamp: true,
          colorize: true,
        });
      } catch (error) {
        logger.error("Error in terminal debug mode: {error}", { error });
        throw error;
      }
      return;
    }

    // Web dashboard mode
    const spinner = ora({
      text: "Starting ActivityPub debug dashboard...",
      discardStdin: false,
    }).start();

    try {
      // Extract actual port value
      const actualPort = Array.isArray(options.port)
        ? options.port[0]
        : options.port;

      // Initialize components
      const interceptor = new ActivityInterceptor();
      const store = new ActivityStore(1000); // Store up to 1000 activities

      // Connect interceptor to store
      interceptor.subscribe((activity) => {
        store.insert(activity);
      });

      // Start the interceptor
      interceptor.start();

      // Create and start the debug server
      const server = new DebugServer({
        port: actualPort,
        interceptor,
        store,
      });

      server.start();

      spinner.succeed(
        `Debug dashboard started on http://localhost:${actualPort}`,
      );

      logger.info("Debug dashboard started with options: {options}", {
        options: {
          port: actualPort,
          browser: options.browser,
        },
      });

      // Open browser if requested
      if (options.browser) {
        const url = `http://localhost:${actualPort}`;
        logger.debug("Opening browser to {url}", { url });
        // TODO: Implement browser opening for Deno
        console.log(`\nOpen your browser to: ${url}`);
      }

      console.log("\nDebug dashboard is running!");
      console.log(`  URL: http://localhost:${actualPort}`);
      console.log(`  Activities stored: up to 1000`);
      console.log("\nPress Ctrl+C to stop the debug dashboard.");

      // Handle graceful shutdown
      let isShuttingDown = false;
      const shutdown = async () => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        console.log("\n\nShutting down debug dashboard...");
        interceptor.stop();
        await server.stop();
        Deno.exit(0);
      };

      // Handle Ctrl+C for shutdown
      Deno.addSignalListener("SIGINT", shutdown);

      // Handle termination signal
      try {
        Deno.addSignalListener("SIGTERM", shutdown);
      } catch {
        // SIGTERM might not be available on all platforms
      }

      // Keep the process running until interrupted
      await new Promise(() => {});
    } catch (error) {
      spinner.fail("Failed to start debug dashboard");
      logger.error("Error starting debug dashboard: {error}", { error });
      throw error;
    }
  });
