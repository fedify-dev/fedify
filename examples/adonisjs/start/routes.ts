/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from "@adonisjs/core/services/router";
import { followers } from "../app/federation/main.js";

/**
 * The home page, linking to the demo actor and listing its followers.
 */
router.get("/", ({ federation, response }) => {
  const uri = federation.getActorUri("demo");
  response.header("Content-Type", "text/plain");
  response.send(`
This small federated server app is a demo of Fedify + AdonisJS.
You can follow this demo app via the following handle:

    @demo@${uri.host}

This account has ${followers.size} followers:

${[...followers.keys()].join("\n")}
  `);
});

/**
 * An ordinary AdonisJS route on the same path as the actor dispatcher.
 *
 * Fedify serves the ActivityPub actor document when the client asks for it;
 * browsers asking for HTML fall through to this route instead. One URL, two
 * representations.
 */
router.get("/users/:identifier", ({ params, response }) => {
  // Only the one actor this app publishes has a page.  Rendering whatever the
  // path happened to contain would both invent actors that do not exist and
  // reflect the segment straight into the HTML.
  if (params.identifier !== "demo") {
    return response.notFound("No such actor.");
  }

  response.header("Content-Type", "text/html");
  response.send("<p>Hello, demo!</p>");
});
