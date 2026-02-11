/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
/**
 * Hono route definitions for the debug dashboard.
 *
 * @module
 */
import type { FedifySpanExporter } from "@fedify/fedify/otel";
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
import type { LogStore } from "./log-store.ts";
import { LoginPage } from "./views/login.tsx";
import { TraceDetailPage } from "./views/trace-detail.tsx";
import { TracesListPage } from "./views/traces-list.tsx";

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
    return c.json(traces);
  });

  app.get("/api/logs/:traceId", async (c) => {
    const traceId = c.req.param("traceId");
    await logStore.flush();
    const logs = await logStore.get(traceId);
    return c.json(logs);
  });

  app.get("/traces/:traceId", async (c) => {
    const traceId = c.req.param("traceId");
    await logStore.flush();
    const activities = await exporter.getActivitiesByTraceId(traceId);
    const logs = await logStore.get(traceId);
    return c.html(
      <TraceDetailPage
        traceId={traceId}
        activities={activities}
        logs={logs}
        pathPrefix={pathPrefix}
      />,
    );
  });

  app.get("/", async (c) => {
    const traces = await exporter.getRecentTraces();
    return c.html(
      <TracesListPage traces={traces} pathPrefix={pathPrefix} />,
    );
  });

  return app;
}
