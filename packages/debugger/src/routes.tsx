/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
/**
 * Hono route definitions for the debug dashboard.
 *
 * @module
 */
import type { FedifySpanExporter, TraceSummary } from "@fedify/fedify/otel";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  checkAuth,
  type FederationDebuggerAuth,
  generateHmacKey,
  SESSION_COOKIE_NAME,
  signSession,
  verifySession,
} from "./auth.ts";
import type { LogStore, SerializedLogRecord } from "./log-store.ts";
import { LoginPage } from "./views/login.tsx";
import { TraceDetailPage } from "./views/trace-detail.tsx";
import { TracesListPage } from "./views/traces-list.tsx";

/** Collects the distinct activity types across all traces, sorted. */
function distinctActivityTypes(traces: readonly TraceSummary[]): string[] {
  const types = new Set<string>();
  for (const trace of traces) {
    for (const type of trace.activityTypes) types.add(type);
  }
  return [...types].sort();
}

/**
 * Keeps only the traces whose `activityTypes` include at least one of the
 * given `types`.  An empty `types` list means "no filter"—all traces pass
 * through unchanged.
 */
function filterTracesByTypes(
  traces: readonly TraceSummary[],
  types: readonly string[],
): TraceSummary[] {
  if (types.length === 0) return [...traces];
  return traces.filter((trace) =>
    trace.activityTypes.some((type) => types.includes(type))
  );
}

/**
 * Computes a string that changes whenever the trace corpus changes in a
 * way the traces list page's live-poll script needs to react to.  Rather
 * than comparing a handful of hand-picked summary fields—which has missed
 * a real change each time a new one turned up—this serializes every trace
 * that currently matches `selectedTypes` as `id:types:activityCount`, so
 * a trace being replaced, an existing trace's activity count going up, or
 * its activity types growing are all covered by the same comparison.  The
 * distinct activity types across *all* traces are tracked separately,
 * since a type that does not match the active filter still needs to make
 * its checkbox appear.  The page embeds this as the poll script's
 * starting point, so the very first poll tick is compared against the
 * data the page was actually rendered with, rather than treating
 * whatever that first tick happens to see as the baseline.
 */
function snapshotOf(
  traces: readonly TraceSummary[],
  selectedTypes: readonly string[],
): string {
  const types = distinctActivityTypes(traces);
  const rows = filterTracesByTypes(traces, selectedTypes)
    .map((trace) =>
      `${trace.traceId}:${
        [...trace.activityTypes].sort().join("+")
      }:${trace.activityCount}`
    )
    .sort();
  return `${types.join(",")}|${rows.join(";")}`;
}

/** Collects the distinct dot-joined log categories, sorted. */
function distinctLogCategories(
  logs: readonly SerializedLogRecord[],
): string[] {
  const categories = new Set<string>();
  for (const log of logs) categories.add(log.category.join("."));
  return [...categories].sort();
}

/**
 * Criteria for narrowing down a trace's log records on the trace detail
 * page.  Every present field must match (AND); an absent or empty field
 * is not applied.
 */
interface LogFilter {
  readonly category?: string;
  readonly level?: string;
  readonly q?: string;
}

/** Applies a {@link LogFilter} to a list of log records. */
function filterLogs(
  logs: readonly SerializedLogRecord[],
  filter: LogFilter,
): readonly SerializedLogRecord[] {
  let filtered = logs;
  if (filter.category) {
    const category = filter.category;
    filtered = filtered.filter((log) => log.category.join(".") === category);
  }
  if (filter.level) {
    const level = filter.level;
    filtered = filtered.filter((log) => log.level === level);
  }
  if (filter.q) {
    const needle = filter.q.toLowerCase();
    filtered = filtered.filter((log) =>
      log.message.toLowerCase().includes(needle)
    );
  }
  return filtered;
}

export function createDebugApp(
  pathPrefix: string,
  exporter: FedifySpanExporter,
  logStore: LogStore,
  auth?: FederationDebuggerAuth,
): Hono {
  const app = new Hono({ strict: false }).basePath(pathPrefix);

  // For "password" and "usernamePassword" modes, we need an HMAC key
  // for signing session cookies.
  let hmacKeyPromise: Promise<CryptoKey> | undefined;
  if (auth != null && auth.type !== "request") {
    hmacKeyPromise = generateHmacKey();
  }

  // Auth middleware
  if (auth != null) {
    if (auth.type === "request") {
      // Request-based auth: check every request, return 403 on failure
      app.use("*", async (c, next) => {
        const allowed = await auth.authenticate(c.req.raw);
        if (!allowed) {
          return c.text("Forbidden", 403);
        }
        await next();
      });
    } else {
      // Cookie-based auth for "password" and "usernamePassword" modes
      const showUsername = auth.type === "usernamePassword";

      // POST /login handler
      app.post("/login", async (c) => {
        const body = await c.req.parseBody();
        const password = typeof body.password === "string" ? body.password : "";
        const username = typeof body.username === "string"
          ? body.username
          : undefined;
        const ok = await checkAuth(auth, { username, password });
        if (!ok) {
          return c.html(
            <LoginPage
              pathPrefix={pathPrefix}
              showUsername={showUsername}
              error="Invalid credentials."
            />,
            401,
          );
        }
        const key = await hmacKeyPromise!;
        const sig = await signSession(key);
        const secure = new URL(c.req.url).protocol === "https:";
        return new Response(null, {
          status: 303,
          headers: {
            "Location": pathPrefix + "/",
            "Set-Cookie":
              `${SESSION_COOKIE_NAME}=${sig}; Path=${pathPrefix}; HttpOnly; SameSite=Strict${
                secure ? "; Secure" : ""
              }`,
          },
        });
      });

      // GET /logout handler
      app.get("/logout", (c) => {
        const secure = new URL(c.req.url).protocol === "https:";
        return new Response(null, {
          status: 303,
          headers: {
            "Location": pathPrefix + "/",
            "Set-Cookie":
              `${SESSION_COOKIE_NAME}=; Path=${pathPrefix}; HttpOnly; SameSite=Strict${
                secure ? "; Secure" : ""
              }; Max-Age=0`,
          },
        });
      });

      // Auth check middleware (skip for /login and /logout)
      app.use("*", async (c, next) => {
        const path = new URL(c.req.url).pathname;
        const loginPath = pathPrefix + "/login";
        const logoutPath = pathPrefix + "/logout";
        if (path === loginPath || path === logoutPath) {
          await next();
          return;
        }

        const sessionValue = getCookie(c, SESSION_COOKIE_NAME);
        if (sessionValue) {
          const key = await hmacKeyPromise!;
          const valid = await verifySession(key, sessionValue);
          if (valid) {
            await next();
            return;
          }
        }

        // Not authenticated — show login form
        return c.html(
          <LoginPage
            pathPrefix={pathPrefix}
            showUsername={showUsername}
          />,
          401,
        );
      });
    }
  }

  app.get("/api/traces", async (c) => {
    const traces = await exporter.getRecentTraces();
    const types = c.req.queries("type") ?? [];
    return c.json(filterTracesByTypes(traces, types));
  });

  app.get("/api/logs/:traceId", async (c) => {
    const traceId = c.req.param("traceId");
    await logStore.flush();
    const logs = await logStore.get(traceId);
    const logFilter: LogFilter = {
      category: c.req.query("category"),
      level: c.req.query("level"),
      q: c.req.query("q"),
    };
    return c.json(filterLogs(logs, logFilter));
  });

  app.get("/traces/:traceId", async (c) => {
    const traceId = c.req.param("traceId");
    await logStore.flush();
    const activities = await exporter.getActivitiesByTraceId(traceId);
    const logs = await logStore.get(traceId);
    const logFilter: LogFilter = {
      category: c.req.query("category"),
      level: c.req.query("level"),
      q: c.req.query("q"),
    };
    return c.html(
      <TraceDetailPage
        traceId={traceId}
        activities={activities}
        logs={filterLogs(logs, logFilter)}
        totalLogCount={logs.length}
        availableCategories={distinctLogCategories(logs)}
        selectedCategory={logFilter.category}
        selectedLevel={logFilter.level}
        selectedQuery={logFilter.q}
        pathPrefix={pathPrefix}
      />,
    );
  });

  app.get("/", async (c) => {
    const traces = await exporter.getRecentTraces();
    const selectedTypes = c.req.queries("type") ?? [];
    return c.html(
      <TracesListPage
        traces={filterTracesByTypes(traces, selectedTypes)}
        availableTypes={distinctActivityTypes(traces)}
        selectedTypes={selectedTypes}
        initialSnapshot={snapshotOf(traces, selectedTypes)}
        pathPrefix={pathPrefix}
      />,
    );
  });

  return app;
}
