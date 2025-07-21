import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { getLogger } from "@logtape/logtape";
import type { ActivityStore } from "./store.ts";
import type { ActivityInterceptor } from "./interceptor.ts";
import type { DebugActivity } from "./interceptor.ts";

const logger = getLogger(["fedify", "cli", "debug", "server"]);

export interface DebugServerOptions {
  port: number;
  interceptor: ActivityInterceptor;
  store: ActivityStore;
}

interface WebSocketClient {
  id: string;
  ws: WebSocket;
}

export class DebugServer {
  private app: Hono;
  private server?: Deno.HttpServer;
  private clients = new Map<string, WebSocketClient>();
  private store: ActivityStore;
  private port: number;
  private unsubscribe?: () => void;

  constructor(options: DebugServerOptions) {
    this.port = options.port;
    this.store = options.store;
    this.app = this.createApp();
  }

  private createApp(): Hono {
    const app = new Hono();

    // Middleware
    app.use("*", cors());
    app.use("*", honoLogger());

    // API Routes
    app.get("/api/activities", (c) => {
      const activities = this.store.getAll();
      return c.json(activities);
    });

    app.get("/api/activities/:id", (c) => {
      const id = c.req.param("id");
      const activity = this.store.get(id);
      if (!activity) {
        return c.json({ error: "Activity not found" }, 404);
      }
      return c.json(activity);
    });

    app.get("/api/stats", (c) => {
      const stats = this.store.getStats();
      return c.json(stats);
    });

    // WebSocket endpoint
    app.get("/ws", (c) => {
      const upgrade = c.req.header("upgrade") || "";
      if (upgrade.toLowerCase() !== "websocket") {
        return c.text("Expected WebSocket", 400);
      }

      const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
      const clientId = `client-${Date.now()}-${
        Math.random().toString(36).substring(7)
      }`;

      socket.onopen = () => {
        logger.info("WebSocket client connected: {clientId}", { clientId });
        this.clients.set(clientId, { id: clientId, ws: socket });

        // Send initial data
        socket.send(JSON.stringify({
          type: "init",
          activities: this.store.getAll(),
          stats: this.store.getStats(),
        }));
      };

      socket.onmessage = (evt) => {
        // Handle client messages if needed
        logger.debug("WebSocket message from {clientId}: {data}", {
          clientId,
          data: evt.data,
        });
      };

      socket.onclose = () => {
        logger.info("WebSocket client disconnected: {clientId}", { clientId });
        this.clients.delete(clientId);
      };

      socket.onerror = (evt) => {
        logger.error("WebSocket error for {clientId}: {error}", {
          clientId,
          error: evt,
        });
      };

      return response;
    });

    // Dashboard HTML
    app.get("/", (c) => {
      return c.html(this.getDashboardHTML());
    });

    return app;
  }

  start(): number {
    // Subscribe to new activities
    this.unsubscribe = this.store.subscribe((activity: DebugActivity) => {
      this.broadcastActivity(activity);
    });

    // Start the server
    this.server = Deno.serve({ port: this.port }, this.app.fetch);
    const addr = this.server.addr;
    const actualPort = addr && "port" in addr ? addr.port : this.port;
    logger.info("Debug server started on port {port}", { port: actualPort });
    return actualPort;
  }

  async stop(): Promise<void> {
    // Unsubscribe from store updates
    if (this.unsubscribe) {
      this.unsubscribe();
    }

    // Close all WebSocket connections
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();

    // Stop the server
    if (this.server) {
      await this.server.shutdown();
    }

    logger.info("Debug server stopped");
  }

  private broadcastActivity(activity: DebugActivity): void {
    const message = JSON.stringify({
      type: "activity",
      activity,
      stats: this.store.getStats(),
    });

    for (const client of this.clients.values()) {
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(message);
        }
      } catch (error) {
        logger.error("Failed to send to client {clientId}: {error}", {
          clientId: client.id,
          error,
        });
      }
    }
  }

  private getDashboardHTML(): string {
    console.error("TODO: getDashboardHTML");
    return ``;
  }
}
