<!-- deno-fmt-ignore-file -->

Fedify example architecture
===========================

This document defines the shared architecture for Fedify example applications.
Every example should follow these conventions regardless of the web framework
used, so that learners can compare examples and transfer knowledge between them.


Middleware integration
----------------------

Every Fedify framework adapter exposes a middleware or hook function that
intercepts incoming requests.  Register this middleware at the top level of
the server so that it runs before any application routes.

The middleware inspects the `Accept` and `Content-Type` headers.  Requests
carrying ActivityPub media types (`application/activity+json`,
`application/ld+json`, etc.) or targeting well-known federation endpoints
are forwarded to the `Federation` instance.  All other requests fall through
to the application's own routes.

The specific API differs, but the role is identical: delegate federation
traffic to Fedify, let everything else pass through.


Reverse proxy support
---------------------

If needed, wrap the middleware (or the request handler it receives) with
`getXForwardedRequest` from the `x-forwarded-fetch` package.  This rewrites
the request URL to respect `X-Forwarded-Host` and related headers, which is
required when the server runs behind a tunneling tool or reverse proxy during
local development. Apply this wrapping at the same level as the Fedify
middleware registration, before any routing logic executes.


Routing
-------

### `GET /`

The main page.  Contains the following sections:

**Search**

A text input for searching fediverse accounts by handle.  The client
debounces input with a 300ms delay, then sends a `GET` request with the
handle as a URL query parameter (e.g. `/?q=@user@example.com`).  The server
resolves the handle using Fedify's `lookupObject` and returns the result.
The result shows: profile image, display name, handle, and a follow button.
If the local actor already follows the target, show an unfollow button
instead.

**User info**

Displays the local actor's profile.  Because this is a demo there is exactly
one actor, `@demo`.

 -  Profile image: `/demo-profile.png`
 -  Name: `"Fedify Demo"`
 -  Handle: `@demo`
 -  Summary: `"This is a Fedify Demo account."`

**Following**

Lists accounts the local actor follows.  Shows the total count and, for
each account: profile image, display name, handle, and an unfollow button.

**Followers**

Lists accounts that follow the local actor.  Shows the total count and, for
each account: profile image, display name, and handle.

The following and followers sections update in real time via SSE (see below).

**Compose**

A text area and a submit button for writing a new post.  On submission the
server creates a `Note`, stores it in `postStore`, wraps it in a `Create`
activity, and sends it to followers.  If sending fails, the post is removed
from the store.

**Posts**

Lists all posts by the local actor in reverse chronological order.  Each
entry shows the post content, published timestamp, and a link to the
single post detail page (`/users/{identifier}/posts/{id}`).

### `GET /users/{identifier}`

Actor profile page.  Shares its path with the Fedify actor dispatcher.
When a federation peer requests this URL with an ActivityPub media type, the
middleware handles it.  Otherwise the request falls through to this route,
which renders an HTML page showing:

 -  Profile image
 -  Name
 -  Handle
 -  Summary
 -  Following count
 -  Followers count

### `GET /users/{identifier}/posts/{id}`

Single post detail page.  Shares its path with the Fedify `Note` object
dispatcher.  Same content-negotiation fallback as the actor profile: the
middleware serves ActivityPub JSON to federation peers, and this route
renders HTML for browsers.  Shows:

 -  Author profile (same layout as the actor profile page)
 -  Post content
 -  Published timestamp

### `POST /post`

Accepts post content from the compose form, creates a `Note`, stores it in
`postStore`, wraps it in a `Create` activity, and sends it to followers.
If sending fails, the post is removed from the store.  Redirects back to
`/` on completion.

### `POST /follow`

Accepts a target actor URI, sends a `Follow` activity from the local actor,
and stores the relationship locally.

### `POST /unfollow`

Accepts a target actor URI, sends an `Undo(Follow)` activity, and removes
the relationship locally.

### `GET /events`

SSE endpoint.  See the SSE section below.


Server-sent events
------------------

The `/events` endpoint keeps an open SSE connection to the client.
When the following or followers list changes (a follow is accepted, a
remote follow arrives, an unfollow occurs, etc.), the server pushes an
event so the page can update without a full reload.

The server maintains a set of active SSE connections.  Whenever the
follower or following store is mutated—inside inbox listeners or after a
local follow/unfollow request—it broadcasts an event to every open
SSE connection.

The client listens on an `EventSource` and replaces the relevant DOM
section with the received data.


Server-side data access
-----------------------

Use Fedify's `RequestContext` to bridge between the framework routing layer
and the federation layer.  Obtain a context by calling
`federation.createContext(request, contextData)` inside a route handler.
Through this context, routes can look up actors, resolve object URIs, and
invoke `sendActivity` without coupling to Fedify internals.

Avoid accessing the data stores directly from route handlers when a
`RequestContext` method exists for the same purpose.  This keeps the
routing layer thin and ensures that Fedify's internal bookkeeping (key
resolution, URI canonicalization, etc.) is applied consistently.


Federation
----------

Use `src/federation.ts`.


Storing
-------

Use `src/store.ts` and the provided in-memory stores.


View rendering
--------------

See `DESIGN.md`.


Logging
-------

Use `@logtape/logtape` and `src/logging.ts`.
