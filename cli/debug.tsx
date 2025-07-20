/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
import { Command } from "@cliffy/command";
import { getLogger } from "@logtape/logtape";
import ora from "ora";

/**
 * Options for the debug command.
 */
export interface DebugOptions {
  /** Port number for the debug dashboard server */
  port: number;
  /** Disable opening browser automatically */
  browser: boolean;
}

const logger = getLogger(["fedify", "cli", "debug"]);

export const command = new Command()
  .description(
    "Start an ActivityPub debug dashboard that monitors and displays " +
      "federation activities in real-time.",
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
  .action(async (options) => {
    const spinner = ora({
      text: "Starting ActivityPub debug dashboard...",
      discardStdin: false,
    }).start();

    try {
      // TODO: Implement the actual debug dashboard server
      spinner.succeed(
        `Debug dashboard would start on port ${options.port}`,
      );

      logger.info("Debug dashboard started with options: {options}", {
        options: {
          port: options.port,
          browser: options.browser,
        },
      });

      // Placeholder for future implementation
      console.log("\nDebug dashboard configuration:");
      console.log(`  Port: ${options.port}`);
      console.log(`  Auto-open browser: ${options.browser ? "Yes" : "No"}`);

      console.log(
        "\nPress Ctrl+C to stop the debug dashboard.",
      );

      // Keep the process running until interrupted
      await new Promise(() => {});
    } catch (error) {
      spinner.fail("Failed to start debug dashboard");
      logger.error("Error starting debug dashboard: {error}", { error });
      throw error;
    }
  });
