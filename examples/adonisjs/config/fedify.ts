import env from "#start/env";
import { defineConfig } from "@fedify/adonisjs";

export default defineConfig({
  /*
  |--------------------------------------------------------------------------
  | The canonical public origin
  |--------------------------------------------------------------------------
  |
  | Fedify mints actor URIs, activity IDs and collection URLs from this
  | value, so it has to be the address remote servers can reach, not the
  | address Node happens to be listening on.  Set PUBLIC_URL to the tunnel
  | or deployment address for that.
  |
  | Without PUBLIC_URL the origin follows the port the server actually
  | bound: "node ace serve" picks a free one when PORT is taken and passes
  | it to the app, so local lookups keep working after such a fallback.
  |
  */
  origin: env.get("PUBLIC_URL") ??
    `http://${reachableHost()}:${env.get("PORT")}`,
});

function reachableHost(): string {
  const host = env.get("HOST");
  if (host === "0.0.0.0" || host === "::") return "localhost";
  // An IPv6 literal must be bracketed to be valid inside a URL.
  return host.includes(":") ? `[${host}]` : host;
}
