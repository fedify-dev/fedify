import { Command, EnumType } from "@cliffy/command";
import { openTunnel, type Tunnel } from "@hongminhee/localtunnel";
import ora from "ora";

const service = new EnumType(["localhost.run", "serveo.net"]);

export const command = new Command()
  .type("service", service)
  .arguments("<port:integer>")
  .description(
    "Expose a local HTTP server to the public internet using a secure tunnel.\n\n" +
      "Note that the HTTP requests through the tunnel have X-Forwarded-* headers.",
  )
  .option("-s, --service <service:service>", "The localtunnel service to use.")
  .action(async (options, port: number) => {
    const spinner = ora({
      text: "Creating a secure tunnel...",
      discardStdin: false,
    }).start();
    let tunnel: Tunnel;
    try {
      tunnel = await openTunnel({ port, service: options.service });
    } catch {
      spinner.fail("Failed to create a secure tunnel.");
      Deno.exit(1);
    }
    spinner.succeed(
      `Your local server at ${port} is now publicly accessible:\n`,
    );
    console.log(tunnel.url.href);
    console.error("\nPress ^C to close the tunnel.");
    Deno.addSignalListener("SIGINT", async () => {
      await tunnel.close();
    });
  });
