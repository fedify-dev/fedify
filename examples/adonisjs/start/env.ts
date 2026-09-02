/*
|--------------------------------------------------------------------------
| Env variables
|--------------------------------------------------------------------------
|
| This file defines the environment variables the application uses, with
| their validation rules. It is read by "bin/server.ts" and "bin/console.ts"
| before the application boots.
|
*/

import { Env } from "@adonisjs/core/env";

export default await Env.create(new URL("../", import.meta.url), {
  NODE_ENV: Env.schema.enum(["development", "production", "test"] as const),
  APP_KEY: Env.schema.string(),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: "host" }),
  LOG_LEVEL: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for configuring Fedify
  |----------------------------------------------------------
  */
  PUBLIC_URL: Env.schema.string.optional({ format: "url", tld: false }),
});
