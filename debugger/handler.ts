/**
 * HTTP handler creation for the ActivityPub debugger dashboard.
 *
 * @module
 * @since 1.9.0
 */

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import type { DebugObserver } from "./observer.ts";
import type { ActivityFilters } from "./types.ts";

/**
 * Creates an HTTP handler for the debug dashboard.
 *
 * This handler provides:
 * - Dashboard UI at the root path
 * - REST API endpoints for activities
 * - WebSocket endpoint for real-time updates
 *
 * @example
 * ```typescript
 * import { createDebugHandler, DebugObserver } from "@fedify/debugger";
 * import { Hono } from "@hono/hono";
 *
 * const debugObserver = new DebugObserver();
 * const debugApp = createDebugHandler(debugObserver);
 *
 * const app = new Hono();
 * app.route("/__debugger__", debugApp);
 * ```
 *
 * @param observer The debug observer instance
 * @returns A Hono app that can be mounted
 * @since 1.9.0
 */
export function createDebugHandler<TContextData>(
  observer: DebugObserver<TContextData>,
): Hono {
  const app = new Hono();
  const store = observer.getStore();

  // Enable CORS for development
  app.use("/api/*", cors());

  /**
   * GET /api/activities
   * List activities with filtering and pagination
   */
  app.get("/api/activities", (c: Context) => {
    const query = c.req.query();

    // Parse filters from query parameters
    const filters: ActivityFilters = {};

    if (query.direction) {
      filters.direction = Array.isArray(query.direction)
        ? query.direction as ("inbound" | "outbound")[]
        : [query.direction as "inbound" | "outbound"];
    }

    if (query.types) {
      filters.types = Array.isArray(query.types) ? query.types : [query.types];
    }

    if (query.actors) {
      filters.actors = Array.isArray(query.actors)
        ? query.actors
        : [query.actors];
    }

    if (query.startTime) {
      filters.startTime = new Date(query.startTime);
    }

    if (query.endTime) {
      filters.endTime = new Date(query.endTime);
    }

    if (query.signatureStatus) {
      filters.signatureStatus = query.signatureStatus as
        | "verified"
        | "failed"
        | "none";
    }

    if (query.deliveryStatus) {
      filters.deliveryStatus = Array.isArray(query.deliveryStatus)
        ? query.deliveryStatus as any[]
        : [query.deliveryStatus as any];
    }

    if (query.searchText) {
      filters.searchText = query.searchText;
    }

    if (query.limit) {
      filters.limit = parseInt(query.limit, 10);
    }

    if (query.offset) {
      filters.offset = parseInt(query.offset, 10);
    }

    if (query.sortBy) {
      filters.sortBy = query.sortBy as "timestamp" | "type" | "actor";
    }

    if (query.sortOrder) {
      filters.sortOrder = query.sortOrder as "asc" | "desc";
    }

    // Search activities
    const activities = filters.searchText
      ? store.searchText(filters.searchText)
      : store.search(filters);

    return c.json({
      activities,
      total: activities.length,
      filters,
    });
  });

  /**
   * GET /api/activities/:id
   * Get a specific activity by ID
   */
  app.get("/api/activities/:id", (c: Context) => {
    const id = c.req.param("id");
    const activity = store.get(id);

    if (!activity) {
      return c.json({ error: "Activity not found" }, 404);
    }

    return c.json(activity);
  });

  /**
   * DELETE /api/activities
   * Clear all activities
   */
  app.delete("/api/activities", (c: Context) => {
    store.clear();
    return c.json({ message: "All activities cleared" });
  });

  /**
   * GET /api/stats
   * Get store statistics
   */
  app.get("/api/stats", (c: Context) => {
    const stats = store.getStats();
    return c.json(stats);
  });

  /**
   * WebSocket endpoint for real-time updates
   * TODO: Implement WebSocket support when available in Hono JSR package
   */
  app.get("/ws", (c: Context) => {
    return c.json({ error: "WebSocket not yet implemented" }, 501);
  });

  /**
   * GET /
   * Serve the dashboard HTML
   */
  app.get("/", (c: Context) => {
    return c.html(getDashboardHtml());
  });

  return app;
}

/**
 * Returns the dashboard HTML content.
 */
function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fedify Debug Dashboard</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }
        
        header {
            background: white;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        
        h1 {
            font-size: 24px;
            margin-bottom: 10px;
        }
        
        .stats {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .stat-card {
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            flex: 1;
        }
        
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .stat-label {
            color: #666;
            font-size: 14px;
        }
        
        .filters {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        
        .filter-row {
            display: flex;
            gap: 15px;
            margin-bottom: 15px;
            flex-wrap: wrap;
        }
        
        .filter-group {
            flex: 1;
            min-width: 200px;
        }
        
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
            font-size: 14px;
        }
        
        input, select {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        
        button {
            background: #007bff;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        
        button:hover {
            background: #0056b3;
        }
        
        .activities {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .activity {
            padding: 15px;
            border-bottom: 1px solid #eee;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .activity:hover {
            background: #f8f9fa;
        }
        
        .activity-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        
        .activity-type {
            font-weight: bold;
            color: #007bff;
        }
        
        .activity-time {
            color: #666;
            font-size: 14px;
        }
        
        .activity-actor {
            color: #666;
            font-size: 14px;
            margin-bottom: 5px;
        }
        
        .activity-summary {
            font-size: 14px;
            color: #333;
        }
        
        .badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            margin-left: 8px;
        }
        
        .badge-inbound {
            background: #e3f2fd;
            color: #1976d2;
        }
        
        .badge-outbound {
            background: #e8f5e9;
            color: #388e3c;
        }
        
        .status-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 5px;
        }
        
        .status-connected {
            background: #4caf50;
        }
        
        .status-disconnected {
            background: #f44336;
        }
        
        .connection-status {
            display: flex;
            align-items: center;
            font-size: 14px;
            color: #666;
        }
        
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
        }
        
        .modal-content {
            background: white;
            margin: 50px auto;
            padding: 20px;
            width: 90%;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
            border-radius: 8px;
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .close-btn {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
        }
        
        .json-view {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: monospace;
            font-size: 14px;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Fedify Debug Dashboard</h1>
            <div class="connection-status">
                <span class="status-indicator status-disconnected" id="status-indicator"></span>
                <span id="connection-status">Disconnected</span>
            </div>
        </header>
        
        <div class="stats" id="stats">
            <div class="stat-card">
                <div class="stat-value" id="total-activities">0</div>
                <div class="stat-label">Total Activities</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="inbound-activities">0</div>
                <div class="stat-label">Inbound</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="outbound-activities">0</div>
                <div class="stat-label">Outbound</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="verified-signatures">0</div>
                <div class="stat-label">Verified Signatures</div>
            </div>
        </div>
        
        <div class="filters">
            <h2 style="margin-bottom: 15px;">Filters</h2>
            <div class="filter-row">
                <div class="filter-group">
                    <label for="direction-filter">Direction</label>
                    <select id="direction-filter">
                        <option value="">All</option>
                        <option value="inbound">Inbound</option>
                        <option value="outbound">Outbound</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label for="type-filter">Activity Type</label>
                    <input type="text" id="type-filter" placeholder="e.g., Create, Follow">
                </div>
                <div class="filter-group">
                    <label for="search-filter">Search</label>
                    <input type="text" id="search-filter" placeholder="Search activities...">
                </div>
            </div>
            <div class="filter-row">
                <button onclick="applyFilters()">Apply Filters</button>
                <button onclick="clearFilters()" style="background: #6c757d;">Clear</button>
                <button onclick="clearAllActivities()" style="background: #dc3545;">Clear All Activities</button>
            </div>
        </div>
        
        <div class="activities" id="activities">
            <!-- Activities will be dynamically inserted here -->
        </div>
    </div>
    
    <div class="modal" id="activity-modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>Activity Details</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div id="modal-body">
                <!-- Activity details will be inserted here -->
            </div>
        </div>
    </div>
    
    <script>
        let ws = null;
        let activities = [];
        let reconnectInterval = null;
        
        // Initialize WebSocket connection
        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}\${window.location.pathname}ws\`;
            
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('WebSocket connected');
                updateConnectionStatus(true);
                if (reconnectInterval) {
                    clearInterval(reconnectInterval);
                    reconnectInterval = null;
                }
            };
            
            ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                
                if (message.type === 'activity') {
                    // Add new activity to the list
                    activities.unshift(message.data);
                    renderActivities();
                    updateStats();
                } else if (message.type === 'connected') {
                    console.log('Connected to debug server');
                    loadActivities();
                }
            };
            
            ws.onclose = () => {
                console.log('WebSocket disconnected');
                updateConnectionStatus(false);
                if (!reconnectInterval) {
                    reconnectInterval = setInterval(connectWebSocket, 5000);
                }
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            
            // Send ping every 30 seconds to keep connection alive
            setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);
        }
        
        // Update connection status indicator
        function updateConnectionStatus(connected) {
            const indicator = document.getElementById('status-indicator');
            const status = document.getElementById('connection-status');
            
            if (connected) {
                indicator.classList.remove('status-disconnected');
                indicator.classList.add('status-connected');
                status.textContent = 'Connected';
            } else {
                indicator.classList.remove('status-connected');
                indicator.classList.add('status-disconnected');
                status.textContent = 'Disconnected';
            }
        }
        
        // Load activities from API
        async function loadActivities() {
            try {
                const response = await fetch('/api/activities');
                const data = await response.json();
                activities = data.activities;
                renderActivities();
                updateStats();
            } catch (error) {
                console.error('Failed to load activities:', error);
            }
        }
        
        // Apply filters
        async function applyFilters() {
            const params = new URLSearchParams();
            
            const direction = document.getElementById('direction-filter').value;
            if (direction) params.append('direction', direction);
            
            const type = document.getElementById('type-filter').value;
            if (type) params.append('types', type);
            
            const search = document.getElementById('search-filter').value;
            if (search) params.append('searchText', search);
            
            try {
                const response = await fetch(\`/api/activities?\${params}\`);
                const data = await response.json();
                activities = data.activities;
                renderActivities();
            } catch (error) {
                console.error('Failed to apply filters:', error);
            }
        }
        
        // Clear filters
        function clearFilters() {
            document.getElementById('direction-filter').value = '';
            document.getElementById('type-filter').value = '';
            document.getElementById('search-filter').value = '';
            loadActivities();
        }
        
        // Clear all activities
        async function clearAllActivities() {
            if (!confirm('Are you sure you want to clear all activities?')) return;
            
            try {
                await fetch('/api/activities', { method: 'DELETE' });
                activities = [];
                renderActivities();
                updateStats();
            } catch (error) {
                console.error('Failed to clear activities:', error);
            }
        }
        
        // Render activities list
        function renderActivities() {
            const container = document.getElementById('activities');
            
            if (activities.length === 0) {
                container.innerHTML = '<div style="padding: 40px; text-align: center; color: #666;">No activities yet</div>';
                return;
            }
            
            container.innerHTML = activities.map(activity => \`
                <div class="activity" onclick="showActivityDetails('\${activity.id}')">
                    <div class="activity-header">
                        <div>
                            <span class="activity-type">\${activity.type}</span>
                            <span class="badge badge-\${activity.direction}">\${activity.direction}</span>
                        </div>
                        <span class="activity-time">\${formatTime(activity.timestamp)}</span>
                    </div>
                    \${activity.actor ? \`<div class="activity-actor">Actor: \${activity.actor.id}</div>\` : ''}
                    \${activity.object?.summary ? \`<div class="activity-summary">\${activity.object.summary}</div>\` : ''}
                </div>
            \`).join('');
        }
        
        // Update statistics
        async function updateStats() {
            try {
                const response = await fetch('/api/stats');
                const stats = await response.json();
                
                document.getElementById('total-activities').textContent = stats.totalActivities;
                document.getElementById('inbound-activities').textContent = stats.inboundActivities;
                document.getElementById('outbound-activities').textContent = stats.outboundActivities;
                document.getElementById('verified-signatures').textContent = stats.signatureStats.verified;
            } catch (error) {
                console.error('Failed to update stats:', error);
            }
        }
        
        // Show activity details modal
        async function showActivityDetails(id) {
            try {
                const response = await fetch(\`/api/activities/\${id}\`);
                const activity = await response.json();
                
                const modalBody = document.getElementById('modal-body');
                modalBody.innerHTML = \`
                    <h3>Activity Information</h3>
                    <p><strong>ID:</strong> \${activity.id}</p>
                    <p><strong>Type:</strong> \${activity.type}</p>
                    <p><strong>Direction:</strong> \${activity.direction}</p>
                    <p><strong>Timestamp:</strong> \${new Date(activity.timestamp).toLocaleString()}</p>
                    \${activity.activityId ? \`<p><strong>Activity ID:</strong> \${activity.activityId}</p>\` : ''}
                    \${activity.actor ? \`
                        <h3>Actor</h3>
                        <p><strong>ID:</strong> \${activity.actor.id}</p>
                        <p><strong>Type:</strong> \${activity.actor.type}</p>
                        \${activity.actor.name ? \`<p><strong>Name:</strong> \${activity.actor.name}</p>\` : ''}
                    \` : ''}
                    <h3>Raw Activity</h3>
                    <div class="json-view">\${JSON.stringify(activity.rawActivity, null, 2)}</div>
                \`;
                
                document.getElementById('activity-modal').style.display = 'block';
            } catch (error) {
                console.error('Failed to load activity details:', error);
            }
        }
        
        // Close modal
        function closeModal() {
            document.getElementById('activity-modal').style.display = 'none';
        }
        
        // Format timestamp
        function formatTime(timestamp) {
            const date = new Date(timestamp);
            const now = new Date();
            const diff = now - date;
            
            if (diff < 60000) {
                return 'just now';
            } else if (diff < 3600000) {
                return \`\${Math.floor(diff / 60000)}m ago\`;
            } else if (diff < 86400000) {
                return \`\${Math.floor(diff / 3600000)}h ago\`;
            } else {
                return date.toLocaleDateString();
            }
        }
        
        // Click outside modal to close
        window.onclick = (event) => {
            const modal = document.getElementById('activity-modal');
            if (event.target === modal) {
                closeModal();
            }
        };
        
        // Initialize on page load
        connectWebSocket();
        loadActivities();
        updateStats();
    </script>
</body>
</html>`;
}
