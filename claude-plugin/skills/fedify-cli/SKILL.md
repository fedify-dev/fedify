---
name: fedify-cli
description: >-
  Use the fedify CLI to inspect and debug ActivityPub servers, including
  servers built without the Fedify framework. Apply when looking up actors
  or objects, diagnosing handle discovery or federation failures, fetching
  WebFinger or NodeInfo, traversing collections or reply chains, resolving
  portable objects through gateways, testing delivery with an
  ephemeral inbox, exposing a local server through a tunnel, running a test
  relay, or scaffolding a project with fedify init. Covers installation,
  version checks, command selection, output interpretation, and remote
  effects. Use for fedify CLI tasks even outside a JavaScript project.
---

Fedify CLI skill
================

Use `fedify` to inspect ActivityPub servers without writing an application.
The target server can use any framework. For building an application with
Fedify's TypeScript APIs, use the separate `fedify` skill.

Read <https://fedify.dev/cli.md> for detailed options. The documentation is
available as raw Markdown with the `.md` suffix; remove that suffix when
presenting links to the user. These examples target Fedify CLI 2.5.0.
If the installed version differs, its `--help` output takes precedence over
these examples.


Check the command first
-----------------------

~~~~ sh
fedify --version
fedify --help
fedify lookup --help
~~~~

Check the chosen subcommand's `--help` before using version-dependent flags.
Use a project-local executable when the project already provides one. In a
Fedify source checkout, follow its contributor instructions and use
`mise run cli -- <arguments>`.

If the command is missing, choose an installation method that fits the user's
runtime. For example, with Node.js:

~~~~ sh
npm install -g @fedify/cli
~~~~

Deno, Bun, Homebrew, Scoop, mise, and standalone executables are covered at
<https://fedify.dev/cli.md#installation>. Installing the CLI executable and
installing this skill are separate steps; see
<https://fedify.dev/install.md#agentic-skill>.

Configuration files can supply defaults, including options that contact
remote servers. Inspect relevant defaults before running diagnostics. For
an isolated invocation, put `--ignore-config` before the subcommand:

~~~~ sh
fedify --ignore-config lookup @alice@example.com
~~~~

The domains and handles below are placeholders. Substitute the user's target.
Discovery and lookup commands contact remote servers and may appear in their
logs. Traversal fetches additional pages and objects. Keep the request volume
appropriate to the diagnostic task.


Choose a diagnostic command
---------------------------

| Question                                   | Command                               | What to inspect                                                                      |
| ------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------ |
| Where does a handle point?                 | `fedify webfinger @alice@example.com` | The JSON resource descriptor's `subject`, `aliases`, and ActivityPub `self` link.    |
| Can the actor or object be fetched?        | `fedify lookup @alice@example.com`    | The parsed vocabulary object, its `id`, type, inbox, and advertised collection URLs. |
| What software does the instance advertise? | `fedify nodeinfo example.com`         | Software name/version, protocols, usage, and registration policy.                    |

WebFinger discovers a resource; it does not fetch the actor document.
`lookup` resolves and dereferences the resource. NodeInfo describes an
instance and does not establish that a particular actor or inbox works.

### Investigate a lookup failure

1.  Run `webfinger` for a handle and inspect the `self` link whose type is
    `application/activity+json` or `application/ld+json` with the
    ActivityStreams profile. A profile-page link is for browsers and may not be
    the actor's ID.

2.  Run `lookup` on that `self` URL. If this works while the handle fails,
    focus on WebFinger discovery, redirects, and the advertised link.

3.  Choose a JSON output format after a successful lookup:

    ~~~~ sh
    fedify lookup --raw https://example.com/users/alice
    fedify nodeinfo --raw example.com
    ~~~~

    `lookup` normally prints a vocabulary object. Its `--raw` option
    serializes the parsed object back to JSON-LD. `--compact` and `--expand`
    select other JSON-LD forms. These three format options are mutually
    exclusive, and all require successful parsing. To investigate a parsing
    failure, request the resource directly with an ActivityPub `Accept`
    header:

    ~~~~ sh
    curl -i -H 'Accept: application/activity+json' https://example.com/users/alice
    ~~~~

    Inspect the status, `Content-Type`, and response body. This unsigned
    request may receive a different response from a server that requires
    signed fetch.

4.  Record the exact command, CLI version, exit status, and error. Check
    DNS/TLS, HTTP errors, redirects, and content negotiation as indicated by
    the evidence. Do not conclude from a single failed request that an account
    does not exist. Use `fedify --debug lookup <target>` when more detail is
    needed; redact private content and credentials before sharing logs.

For a server requiring signed requests, consider:

~~~~ sh
fedify lookup --authorized-fetch @alice@example.com
~~~~

This creates a one-time key pair and a temporary public server through a
tunnel so the remote server can fetch the signing key. It does not log in as
the user's account or grant access to private posts. Explain the exposure
before running it and use it only within the user's authorized task.

Do not enable `--allow-private-address` for arbitrary remote data. It permits
fetching private or loopback addresses; reserve it for an explicitly intended
local test. See <https://fedify.dev/cli.md> for signature options, timeouts,
and other version-specific diagnostics.

### Traverse a collection

Copy the collection URL from the fetched actor, then inspect it before
traversing it:

~~~~ sh
fedify lookup https://example.com/users/alice/outbox
fedify lookup --traverse https://example.com/users/alice/outbox
~~~~

Without `--traverse`, the result is the collection itself. With it, the
command follows collection pages and prints their items. Each target must
resolve to a collection, so passing the actor URL is insufficient. Separate
results use `----` by default; do not treat the entire stream as one JSON
array. Traversal can fetch many pages and objects. Keep errors visible while
diagnosing; `--suppress-errors` can produce partial results and does not prove
every item was retrieved. Use the CLI reference for separators, output files,
and relationship recursion rather than guessing flags.


Advanced diagnostic recipes
---------------------------

### Reconstruct a conversation from one post

Follow a post's reply targets to inspect its ancestors without relying on a
server's web UI:

~~~~ sh
fedify lookup --recurse replyTarget --recurse-depth 5 --reverse https://example.com/posts/leaf
fedify lookup --recurse quote --recurse-depth 3 https://example.com/posts/quoted
~~~~

`replyTarget` is the vocabulary property name for ActivityStreams
`inReplyTo`. `quote` and `quoteUrl` follow quote relationships instead. A
depth limit bounds the walk; it does not establish that the conversation is
complete. `--reverse` buffers results before printing them in reverse order,
which can make an ancestor chain easier to read. Relationship recursion and
`--traverse` are mutually exclusive: use recursion for links between objects
and traversal for collection membership. This can help locate a broken link
or a serialization difference between servers.

### Compare discovery before and after an account move

Use multiple targets to inspect both handles in one terminal session:

~~~~ sh
fedify webfinger @alice@old.example @alice@new.example
fedify lookup --raw @alice@old.example @alice@new.example
~~~~

Compare WebFinger `self` links, actor IDs, and any advertised `movedTo` or
`alsoKnownAs` relationships. A matching display name is not evidence that two
actors are the same identity. This is an inspection workflow; it does not
move accounts or send a `Move` activity. For a reproducible diagnostic
artifact, `lookup --raw --output actor.json <actor-url>` saves the parsed
actor as JSON-LD. Review private content before sharing it, and remember that a
multi-target output uses separators rather than forming a JSON array.

### Separate portable identity from gateway availability

On versions supporting FEP-ef61 portable objects, provide a gateway for a
bare portable ID:

~~~~ sh
fedify lookup --gateway https://gateway.example 'ap://did:key:z6Mk.../actor'
~~~~

Replace the abbreviated DID and path with the complete ID under test.
Portable IDs carry identity independently of the serving host. A gateway URL
or an ID with `@gateway` location hints can supply the fetch location instead
of `--gateway`. Distinguish a gateway fetch failure from an integrity-proof
failure: successfully receiving JSON does not mean its proof is valid.
The CLI validates the portable object's integrity proof before accepting it.
See <https://fedify.dev/cli.md#looking-up-portable-objects> for identifier
forms and gateway rules.


Create a project
----------------

~~~~ sh
fedify init my-federated-app
~~~~

`init` runs an interactive wizard for runtime, package manager, framework,
KV store, and message queue. Choose an intended new directory and resolve
those choices with the user before running the wizard. Scaffolding writes
files and may install dependencies. It is useful for a new Fedify app, but is
not needed for CLI-only diagnosis. See
<https://fedify.dev/cli.md#fedify-init-initializing-a-fedify-project>.


Receive test activities
-----------------------

~~~~ sh
fedify inbox
~~~~

This starts a temporary actor and inbox with a public HTTPS tunnel. Use the
printed actor handle or URI as a recipient from the server under test, then
inspect the logged activity type, HTTP status, and request-details URL. A
successful HTTP response alone does not establish that an application's
business logic handled an activity. Stop the process with Ctrl-C when done;
the actor and tunnel are short-lived.

For a local-only test, check `fedify inbox --help` for `--no-tunnel`. Remote
peers cannot reach a loopback-only endpoint.

`--follow` sends Follow activities to the named actors, and `--accept-follow`
can send Accept activities. These affect remote servers; use them only when
the user has authorized that interaction. Inspect configuration defaults so
a plain `inbox` invocation does not unexpectedly follow or accept actors.
See <https://fedify.dev/cli.md#fedify-inbox-ephemeral-inbox-server>.


Expose a local server or test a relay
-------------------------------------

~~~~ sh
fedify tunnel 3000
fedify relay --protocol mastodon
~~~~

`tunnel` exposes an existing local HTTP service to the public internet. Use
it only for the intended development service, with test data. Ensure that
the service recognizes its public origin, including forwarded headers where
appropriate, so actor IDs do not point to localhost.

`relay` runs an ActivityPub relay and forwards activities between participating
servers. It opens a public tunnel by default and uses in-memory storage
unless persistence is configured. Choose Mastodon or LitePub according to
the test, and use controlled participants; accepting subscriptions and
forwarding activities have remote effects. Starting a relay is not a passive
connectivity check. Stop temporary servers when the test ends.

Read <https://fedify.dev/cli.md> for tunnel providers, relay persistence,
subscription controls, and local-only modes.
