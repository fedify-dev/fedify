/*
|--------------------------------------------------------------------------
| HTTP kernel file
|--------------------------------------------------------------------------
|
| The HTTP kernel file is used to register the middleware with the server
| or the router.
|
*/

import server from "@adonisjs/core/services/server";

/**
 * The server middleware stack runs middleware on all the HTTP
 * requests, even if there is no route registered for
 * the request URL.
 *
 * The Fedify middleware goes first, which is also where
 * "node ace configure @fedify/adonisjs" puts it: it negotiates on the
 * client's real "Accept" header, so nothing that rewrites the header may
 * run ahead of it -- the API starter kit's "force_json_response_middleware"
 * turns every "Accept" into "application/json", which Fedify reads as a
 * request for the ActivityPub document, and the HTML fall-through this
 * example relies on could never happen.
 */
server.use([
  () => import("@fedify/adonisjs/fedify_middleware"),
  () => import("#start/container_bindings_middleware"),
]);
