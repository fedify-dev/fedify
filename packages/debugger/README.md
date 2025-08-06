# @fedify/debugger

ActivityPub debugger for Fedify applications. Provides real-time monitoring and
debugging tools through an extensible observer pattern.

## Features

- **Real-time Activity Monitoring**: Capture and inspect all inbound/outbound
  ActivityPub activities
- **Web Dashboard**: Interactive web interface for browsing activities
- **CLI Tool**: Terminal-based activity viewer with real-time following
- **Flexible Integration**: Multiple integration patterns for different use cases
- **Production Ready**: Built-in security features for production environments
- **Circular Buffer Storage**: Efficient in-memory storage with configurable
  capacity

## Installation

```bash
deno add @fedify/debugger
```

## Quick Start

### Basic Integration

The simplest way to add debugging to your Fedify application:

```typescript
import { createFederation } from "@fedify/fedify";
import { integrateDebugger } from "@fedify/debugger";

const federation = createFederation({
  kv: new MemoryKvStore(),
});

// Add debugger in development
if (Deno.env.get("DENO_ENV") !== "production") {
  const { handler } = integrateDebugger(federation, {
    path: "/__debugger__",
    maxActivities: 1000,
  });
  
  // Mount the debug handler with your web framework
  // Example with Hono:
  app.route("/__debugger__", handler);
}
```

### Standalone Setup

For more control over the integration:

```typescript
import { createDebugger } from "@fedify/debugger";

const { observer, handler } = createDebugger({
  maxActivities: 1000,
  production: false,
});

// Add observer when creating federation
const federation = createFederation({
  kv: new MemoryKvStore(),
  observers: [observer],
});

// Mount handler separately
app.route("/__debugger__", handler);
```

## Configuration Options

### DebugObserverOptions

- `path` (string): URL path for the debug dashboard. Default: `"/__debugger__"`
- `maxActivities` (number): Maximum activities to store. Default: `1000`
- `production` (boolean): Enable production mode. Default: `false`
- `token` (string): Access token for authentication (production mode)
- `ipAllowlist` (string[]): Allowed IP addresses (production mode)

## Production Mode

When running in production, enable security features:

```typescript
const { handler } = integrateDebugger(federation, {
  production: true,
  token: Deno.env.get("DEBUG_TOKEN"),
  ipAllowlist: ["127.0.0.1", "10.0.0.0/8"],
});
```

## API Endpoints

The debug handler provides the following REST API endpoints:

- `GET /api/activities` - List activities with filtering
- `GET /api/activities/:id` - Get specific activity
- `DELETE /api/activities` - Clear all activities
- `GET /api/stats` - Get statistics
- `GET /ws` - WebSocket endpoint (not yet implemented)

### Filtering Activities

```typescript
// Query parameters for GET /api/activities
interface ActivityFilters {
  direction?: "inbound" | "outbound";
  types?: string[];         // Activity types
  actors?: string[];        // Actor IDs
  startTime?: string;       // ISO timestamp
  endTime?: string;         // ISO timestamp
  searchText?: string;      // Full-text search
  limit?: number;
  offset?: number;
  sortBy?: "timestamp" | "type" | "actor";
  sortOrder?: "asc" | "desc";
}
```

## Architecture

The debugger uses the Observer pattern to capture activities without impacting
federation performance:

```
Federation → FederationObserver → DebugObserver → ActivityStore
                                                          ↓
                                   Dashboard ← Handler ← API
```

## Development

### Running Tests

```bash
deno test --allow-env
```

### Type Checking

```bash
deno check mod.ts
```

## CLI Usage

The debugger package includes a CLI tool for terminal-based debugging:

### Installation

```bash
# Install globally
deno install --allow-net --allow-env -n fedify-debug jsr:@fedify/debugger/cli

# Or run directly
deno run --allow-net --allow-env jsr:@fedify/debugger/cli
```

### Basic Usage

```bash
# Connect to local debugger (default: http://localhost:3000/__debugger__)
fedify-debug

# Connect to remote debugger
fedify-debug --url https://example.com/__debugger__

# Follow new activities in real-time
fedify-debug --follow

# Filter by direction
fedify-debug --direction inbound

# Search for specific activities
fedify-debug --filter "Create"

# Output as JSON for processing
fedify-debug --json
```

### Options

- `-u, --url <URL>` - Debug endpoint URL (default: http://localhost:3000/__debugger__)
- `-f, --filter <TEXT>` - Filter activities by text search
- `-d, --direction <DIR>` - Filter by direction: inbound or outbound
- `-w, --follow` - Follow mode - show new activities as they arrive
- `-j, --json` - Output raw JSON instead of formatted text
- `-h, --help` - Show help message

## Migration from Old CLI Debug

If you were using the old CLI-based debug command, here's how to migrate:

**Before:**
```bash
fedify debug --port 3000
```

**After:**
```typescript
// In your application code
const { handler } = integrateDebugger(federation);
app.route("/__debugger__", handler);
```

Then use the new CLI to connect:
```bash
fedify-debug --url http://localhost:3000/__debugger__
```
