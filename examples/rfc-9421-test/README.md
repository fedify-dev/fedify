RFC 9421 Interoperability Field Test
=====================================

A Fedify-based server for testing RFC 9421 HTTP Message Signatures
interoperability with Bonfire, Mastodon, and other fediverse implementations.

See [../../plans/field-test.md](../../plans/field-test.md) for the full test
plan.


Prerequisites
-------------

 -  [Deno] installed
 -  Run `mise run install` (or `pnpm install`) from the repo root
 -  A public tunnel for testing (e.g., `fedify tunnel`)


Quick start
-----------

### 1. Start the server

~~~~sh
# Default (RFC 9421 first knock + Accept-Signature challenge):
deno run -A main.ts

# With nonce replay protection:
CHALLENGE_NONCE=1 deno run -A main.ts

# Without challenge (plain signature verification only):
CHALLENGE_ENABLED=0 deno run -A main.ts
~~~~

### 2. Expose publicly with `fedify tunnel`

In a separate terminal, from the repo root:

~~~~sh
deno task cli tunnel 8000
~~~~

Note the public URL (e.g., `https://xxxxx.tunnel.example`).

### 3. Send test activities

Open your browser or use curl.  Both GET (query params) and POST (JSON body)
are supported:

~~~~sh
# Follow a remote actor (GET):
curl 'https://xxxxx.tunnel.example/send/follow?handle=@user@bonfire.example'

# Follow a remote actor (POST):
curl -X POST -H 'Content-Type: application/json' \
  -d '{"handle":"@user@bonfire.example"}' \
  https://xxxxx.tunnel.example/send/follow

# Send a note:
curl 'https://xxxxx.tunnel.example/send/note?handle=@user@bonfire.example&content=Hello!'

# Unfollow:
curl 'https://xxxxx.tunnel.example/send/unfollow?handle=@user@bonfire.example'
~~~~


Configuration
-------------

All configuration is via environment variables:

| Variable            | Default     | Description                               |
|---------------------|-------------|-------------------------------------------|
| `PORT`              | `8000`      | Server listen port                        |
| `FIRST_KNOCK`       | `rfc9421`   | Initial signature spec (`rfc9421` or `draft-cavage-http-signatures-12`) |
| `CHALLENGE_ENABLED` | (enabled)   | Set to `0` to disable `Accept-Signature` on `401` |
| `CHALLENGE_NONCE`   | (disabled)  | Set to `1` to include one-time nonce      |
| `NONCE_TTL`         | `300`       | Nonce time-to-live in seconds             |


Endpoints
---------

### Monitoring

 -  `GET /` — Server info and endpoint list
 -  `GET /log` — Received activities (newest first)
 -  `GET /followers-list` — Current followers

### Sending activities (outbound)

All send endpoints accept GET (query params) or POST (JSON body).

 -  `/send/follow` — Send a Follow activity
     -  `handle` (required): remote actor handle
 -  `/send/note` — Send a Create(Note) activity
     -  `handle` (required): remote actor handle
     -  `content` (optional): note text
 -  `/send/unfollow` — Send an Undo(Follow) activity
     -  `handle` (required): remote actor handle


Test scenarios
--------------

### Scenario A: Fedify -> Bonfire (outbound)

1.  Start the server and expose via tunnel.
2.  Use `/send/follow` and `/send/note` to send activities to a Bonfire actor.
3.  Check Bonfire server logs for RFC 9421 signature verification.

### Scenario B: Bonfire -> Fedify (inbound with challenge)

1.  Start the server with `CHALLENGE_ENABLED=1`.
2.  Have Bonfire send a `Follow` to `@test@<your-domain>`.
3.  Verify Fedify returns `401` with `Accept-Signature` header.
4.  Verify Bonfire retries with a compatible signature and succeeds.
5.  Repeat with `CHALLENGE_NONCE=1` for replay protection testing.

### Scenario C: Fedify -> Mastodon (outbound)

1.  Start the server and expose via tunnel.
2.  Use `/send/follow` targeting a Mastodon actor.
3.  Monitor logs for double-knock behavior and 5xx workaround.

### Scenario D: Mastodon -> Fedify (inbound)

1.  Start the server (optionally with challenge enabled).
2.  From a Mastodon account, follow `@test@<your-domain>`.
3.  Check the `/log` endpoint and server logs.

[Deno]: https://deno.com/
