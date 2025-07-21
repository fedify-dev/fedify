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
  // private interceptor: ActivityInterceptor;
  private store: ActivityStore;
  private port: number;
  private unsubscribe?: () => void;

  constructor(options: DebugServerOptions) {
    this.port = options.port;
    // this.interceptor = options.interceptor;
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

  // TODO: Add the following features to the dashboard:
  // - Activity type filters (Create, Update, Delete, etc.)
  // - Search functionality for activities
  // - Export activities to JSON/CSV
  // - Activity details modal/side panel
  // - Real-time activity graph/timeline visualization
  // - Error tracking and display
  // - Performance metrics (response times, queue sizes)
  // - Clear/reset activities button
  // - Pagination for large activity lists
  private getDashboardHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fedify Debug Dashboard</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      color: #333;
    }
    
    header {
      background: #2c3e50;
      color: white;
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    header h1 {
      font-size: 1.5rem;
    }
    
    .connection-status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .status-indicator {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #e74c3c;
    }
    
    .status-indicator.connected {
      background: #2ecc71;
    }
    
    main {
      display: grid;
      grid-template-columns: 250px 1fr;
      height: calc(100vh - 60px);
    }
    
    .sidebar {
      background: white;
      border-right: 1px solid #ddd;
      padding: 1rem;
      overflow-y: auto;
    }
    
    .content {
      padding: 1rem;
      overflow-y: auto;
    }
    
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    
    .stat-card {
      background: white;
      padding: 1rem;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .stat-card h3 {
      font-size: 0.875rem;
      color: #666;
      margin-bottom: 0.5rem;
    }
    
    .stat-card .value {
      font-size: 2rem;
      font-weight: bold;
      color: #2c3e50;
    }
    
    .activities {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .activity-item {
      padding: 1rem;
      border-bottom: 1px solid #eee;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .activity-item:hover {
      background: #f8f9fa;
    }
    
    .activity-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    
    .activity-type {
      font-weight: bold;
      color: #2c3e50;
    }
    
    .activity-direction {
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: bold;
    }
    
    .activity-direction.inbound {
      background: #3498db;
      color: white;
    }
    
    .activity-direction.outbound {
      background: #e67e22;
      color: white;
    }
    
    .activity-time {
      color: #666;
      font-size: 0.875rem;
    }
    
    .activity-id {
      color: #888;
      font-size: 0.75rem;
      font-family: monospace;
    }
    
    .filter-section {
      margin-bottom: 2rem;
    }
    
    .filter-section h3 {
      font-size: 1rem;
      margin-bottom: 1rem;
      color: #2c3e50;
    }
    
    .filter-group {
      margin-bottom: 1rem;
    }
    
    .filter-group label {
      display: block;
      margin-bottom: 0.5rem;
      cursor: pointer;
    }
    
    .filter-group input[type="checkbox"] {
      margin-right: 0.5rem;
    }
  </style>
</head>
<body>
  <header>
    <h1>Fedify Debug Dashboard</h1>
    <div class="connection-status">
      <span id="status-text">Disconnected</span>
      <div id="status-indicator" class="status-indicator"></div>
    </div>
  </header>
  
  <main>
    <aside class="sidebar">
      <div class="filter-section">
        <h3>Filters</h3>
        
        <div class="filter-group">
          <h4>Direction</h4>
          <label>
            <input type="checkbox" value="inbound" checked> Inbound
          </label>
          <label>
            <input type="checkbox" value="outbound" checked> Outbound
          </label>
        </div>
      </div>
    </aside>
    
    <section class="content">
      <div class="stats">
        <div class="stat-card">
          <h3>Total Activities</h3>
          <div class="value" id="total-activities">0</div>
        </div>
        <div class="stat-card">
          <h3>Inbound</h3>
          <div class="value" id="inbound-count">0</div>
        </div>
        <div class="stat-card">
          <h3>Outbound</h3>
          <div class="value" id="outbound-count">0</div>
        </div>
      </div>
      
      <div class="activities">
        <div id="activities-list"></div>
      </div>
    </section>
  </main>
  
  <script>
    let ws = null;
    let activities = [];
    
    function connectWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = \`\${protocol}//\${window.location.host}/ws\`;
      
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('Connected to debug server');
        updateConnectionStatus(true);
      };
      
      ws.onclose = () => {
        console.log('Disconnected from debug server');
        updateConnectionStatus(false);
        // Reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
      };
    }
    
    function updateConnectionStatus(connected) {
      const statusText = document.getElementById('status-text');
      const statusIndicator = document.getElementById('status-indicator');
      
      statusText.textContent = connected ? 'Connected' : 'Disconnected';
      statusIndicator.classList.toggle('connected', connected);
    }
    
    function handleMessage(data) {
      switch (data.type) {
        case 'init':
          activities = data.activities || [];
          updateStats(data.stats);
          renderActivities();
          break;
          
        case 'activity':
          activities.unshift(data.activity);
          updateStats(data.stats);
          renderActivities();
          break;
      }
    }
    
    function updateStats(stats) {
      if (!stats) return;
      
      document.getElementById('total-activities').textContent = stats.totalActivities;
      document.getElementById('inbound-count').textContent = stats.inboundCount;
      document.getElementById('outbound-count').textContent = stats.outboundCount;
    }
    
    function renderActivities() {
      const container = document.getElementById('activities-list');
      const filters = getActiveFilters();
      
      const filteredActivities = activities.filter(activity => {
        return filters.direction.includes(activity.direction);
      });
      
      container.innerHTML = filteredActivities.map(activity => \`
        <div class="activity-item" data-id="\${activity.id}">
          <div class="activity-header">
            <span class="activity-type">\${activity.type}</span>
            <span class="activity-direction \${activity.direction}">\${activity.direction}</span>
          </div>
          <div class="activity-time">\${new Date(activity.timestamp).toLocaleString()}</div>
          \${activity.activityId ? \`<div class="activity-id">\${activity.activityId}</div>\` : ''}
        </div>
      \`).join('');
    }
    
    function getActiveFilters() {
      const directionCheckboxes = document.querySelectorAll('.filter-group input[type="checkbox"]:checked');
      const direction = Array.from(directionCheckboxes).map(cb => cb.value);
      
      return { direction };
    }
    
    // Event listeners
    document.addEventListener('DOMContentLoaded', () => {
      connectWebSocket();
      
      // Filter change listeners
      document.querySelectorAll('.filter-group input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', renderActivities);
      });
      
      // Activity click listener
      document.getElementById('activities-list').addEventListener('click', (e) => {
        const activityItem = e.target.closest('.activity-item');
        if (activityItem) {
          const activityId = activityItem.dataset.id;
          const activity = activities.find(a => a.id === activityId);
          if (activity) {
            console.log('Activity details:', activity);
          }
        }
      });
    });
  </script>
</body>
</html>`;
  }
}
