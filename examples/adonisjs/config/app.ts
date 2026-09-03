import app from "@adonisjs/core/services/app";
import { defineConfig } from "@adonisjs/core/http";

/*
|--------------------------------------------------------------------------
| HTTP server configuration
|--------------------------------------------------------------------------
|
| The HTTP server settings. The public address remote servers use is
| "PUBLIC_URL", which "config/fedify.ts" reads.
|
*/

export const http = defineConfig({
  generateRequestId: true,

  cookie: {
    domain: "",
    path: "/",
    maxAge: "2h",
    httpOnly: true,
    secure: app.inProduction,
    sameSite: "lax",
  },
});
