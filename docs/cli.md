---
description: >-
  The fedify command is a CLI toolchain for Fedify and debugging
  ActivityPub-enabled federated server apps.  This section explains the key
  features of the fedify command.
---

`fedify`: CLI toolchain
=======================

The `fedify` command is a CLI toolchain for Fedify and debugging
ActivityPub-enabled federated server apps.  Although it is primarily designed
for developers who use Fedify, it can be used with any ActivityPub-enabled
server.


Installation
------------

### Using npm

If you have [Node.js] or [Bun] installed, you can install `fedify` by running
the following command:

::: code-group

~~~~ sh [Node.js]
npm install -g @fedify/cli
~~~~

~~~~ sh [Bun]
bun install -g @fedify/cli
~~~~

:::

[Node.js]: https://nodejs.org/
[Bun]: https://bun.sh/

### Using Homebrew on macOS and Linux

If you are using macOS or Linux and have [Homebrew] installed, you can install
`fedify` by running the following command:

~~~~ sh
brew install fedify
~~~~

[Homebrew]: https://brew.sh/

### Using Scoop on Windows

If you are using Windows and have [Scoop] installed, you can install `fedify`
by running the following command:

~~~~ powershell
scoop install fedify
~~~~

[Scoop]: https://scoop.sh/

### Using Deno

If you have [Deno] installed, you can install `fedify` by running the following
command:

::: code-group

~~~~ sh [Linux/macOS]
deno install \
  -g \
  -A \
  --unstable-fs --unstable-kv --unstable-temporal \
  -n fedify \
  jsr:@fedify/cli
~~~~

~~~~ powershell [Windows]
deno install `
  -g `
  -A `
  --unstable-fs --unstable-kv --unstable-temporal `
  -n fedify `
  jsr:@fedify/cli
~~~~

:::

[Deno]: https://deno.com/

### Downloading the executable

You can download the pre-built executables from the [releases] page.  Download
the appropriate executable for your platform and put it in your `PATH`.

[releases]: https://github.com/fedify-dev/fedify/releases


`fedify init`: Initializing a Fedify project
--------------------------------------------

*This command is available since Fedify 0.12.0.*

[![The “fedify init” command demo](https://asciinema.org/a/671658.svg)](https://asciinema.org/a/671658)

The `fedify init` command is used to initialize a new Fedify project.
It creates a new directory with the necessary files and directories for a
Fedify project.  To create a new Fedify project, run the below command:

~~~~ sh
fedify init my-fedify-project
~~~~

The above command will start the interactive prompt to initialize a new Fedify
project.  It will ask you a few questions to set up the project:

 -  JavaScript runtime: [Deno], [Bun], or [Node.js]
 -  Package manager (if Node.js): [npm], [pnpm], or [Yarn]
 -  Web framework: Bare-bones, [Fresh] (if Deno), [Hono], [Express] (unless
    Deno), or [Nitro] (unless Deno)
 -  key–value store: In-memory, [Redis], [PostgreSQL], or [Deno KV] (if Deno)
 -  Message queue: In-memory, [Redis], [PostgreSQL], [AMQP] (e.g., [RabbitMQ]),
    or [Deno KV] (if Deno)

Alternatively, you can specify the options in the command line to skip some of
interactive prompts:

[npm]: https://www.npmjs.com/
[pnpm]: https://pnpm.io/
[Yarn]: https://yarnpkg.com/
[Fresh]: https://fresh.deno.dev/
[Hono]: https://hono.dev/
[Express]: https://expressjs.com/
[Nitro]: https://nitro.unjs.io/
[Redis]: https://redis.io/
[PostgreSQL]: https://www.postgresql.org/
[AMQP]: https://www.amqp.org/
[RabbitMQ]: https://www.rabbitmq.com/
[Deno KV]: https://deno.com/kv

### `-r`/`--runtime`: JavaScript runtime

You can specify the JavaScript runtime by using the `-r`/`--runtime` option.
The available options are:

 -  `deno`: [Deno]
 -  `bun`: [Bun]
 -  `node`: [Node.js]

### `-p`/`--package-manager`: Node.js package manager

If you choose Node.js as the JavaScript runtime, you can specify the package
manager by using the `-p`/`--package-manager` option.  The available options
are:

 -  `npm`: [npm]
 -  `pnpm`: [pnpm]
 -  `yarn`: [Yarn]

It's ignored if you choose Deno or Bun as the JavaScript runtime.

### `-w`/`--web-framework`: Web framework

You can specify the web framework to integrate with Fedify by using
the `-w`/`--web-framework` option.  The available options are:

 -  `fresh`: [Fresh] (if Deno)
 -  `hono`: [Hono]
 -  `express`: [Express] (unless Deno)
 -  `nitro`: [Nitro] (unless Deno)

If it's omitted, no web framework will be integrated.

### `-k`/`--kv-store`: key–value store

You can specify the key–value store to use by using the `-k`/`--kv-store`
option.  The available options are:

 -  `redis`: [Redis]
 -  `postgres`: [PostgreSQL]
 -  `denokv`: [Deno KV] (if Deno)

If it's omitted, the in-memory key–value store (which is for development
purpose) will be used.

### `-q`/`--message-queue`: Message queue

You can specify the message queue to use by using the `-q`/`--message-queue`
option.  The available options are:

 -  `redis`: [Redis]
 -  `postgres`: [PostgreSQL]
 -  `amqp`: [AMQP] (e.g., [RabbitMQ])
 -  `denokv`: [Deno KV] (if Deno)

If it's omitted, the in-process message queue (which is for development purpose)
will be used.

### `--dry-run`: Preview without creating files

*This option is available since Fedify 1.8.0.*

The `--dry-run` option allows you to preview what files and configurations would
be created without actually creating them.  This is useful for reviewing the
project structure before committing to the initialization.

~~~~ sh
fedify init my-fedify-project --dry-run
~~~~

When using `--dry-run`, the command will:

 -  Display all files that would be created with their contents
 -  Show which dependencies would be installed
 -  Preview any commands that would be executed
 -  Not create any directories or files on your filesystem

This option works with all other initialization options, allowing you to preview
different configurations before making a decision.


`fedify lookup`: Looking up an ActivityPub object
-------------------------------------------------

The `fedify lookup` command is used to look up an ActivityPub object by its URL
or an actor by its handle.

For example, the below command looks up a `Note` object with the given URL:

~~~~ sh
fedify lookup https://todon.eu/@hongminhee/112341925069749583
~~~~

The output will be like the below:

~~~~
Note {
  id: URL "https://todon.eu/users/hongminhee/statuses/112341925069749583",
  attachments: [
    Document {
      name: "The demo video on my terminal",
      url: URL "https://todon.eu/system/media_attachments/files/112/341/916/300/016/369/original/f83659866f94054f.mp"... 1 more character,
      mediaType: "video/mp4"
    }
  ],
  attribution: URL "https://todon.eu/users/hongminhee",
  contents: [
    '<p>I&#39;m working on adding a CLI toolchain to <a href="https://todon.eu/tags/Fedify" class="mentio'... 379 more characters,
    <en> '<p>I&#39;m working on adding a CLI toolchain to <a href="https://todon.eu/tags/Fedify" class="mentio'... 379 more characters
  ],
  published: 2024-04-27T07:08:57Z,
  replies: Collection {
    id: URL "https://todon.eu/users/hongminhee/statuses/112341925069749583/replies",
    first: CollectionPage {
      items: [
        URL "https://todon.eu/users/hongminhee/statuses/112343493232608516"
      ],
      partOf: URL "https://todon.eu/users/hongminhee/statuses/112341925069749583/replies",
      next: URL "https://todon.eu/users/hongminhee/statuses/112341925069749583/replies?min_id=112343493232608516&page"... 5 more characters
    }
  },
  url: URL "https://todon.eu/@hongminhee/112341925069749583",
  to: URL "https://www.w3.org/ns/activitystreams#Public",
  cc: URL "https://todon.eu/users/hongminhee/followers",
  sensitive: false
}
~~~~

### Looking up an actor by handle

You can also look up an actor by its handle or URL.  For example, the below
command looks up an actor with the given handle:

~~~~ sh
fedify lookup @fedify-example@fedify-blog.deno.dev
~~~~

The output will be like the below:

~~~~
Person {
  id: URL "https://fedify-blog.deno.dev/users/fedify-example",
  name: "Fedify Example Blog",
  published: 2024-03-03T13:18:11.857384756Z,
  summary: "This blog is powered by Fedify, a fediverse server framework.",
  url: URL "https://fedify-blog.deno.dev/",
  preferredUsername: "fedify-example",
  publicKey: CryptographicKey {
    id: URL "https://fedify-blog.deno.dev/users/fedify-example#main-key",
    owner: URL "https://fedify-blog.deno.dev/users/fedify-example",
    publicKey: CryptoKey {
      type: "public",
      extractable: true,
      algorithm: {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 4096,
        publicExponent: Uint8Array(3) [ 1, 0, 1 ],
        hash: { name: "SHA-256" }
      },
      usages: [ "verify" ]
    }
  },
  inbox: URL "https://fedify-blog.deno.dev/users/fedify-example/inbox",
  outbox: URL "https://fedify-blog.deno.dev/users/fedify-example/outbox",
  following: URL "https://fedify-blog.deno.dev/users/fedify-example/following",
  followers: URL "https://fedify-blog.deno.dev/users/fedify-example/followers",
  endpoints: Endpoints { sharedInbox: URL "https://fedify-blog.deno.dev/inbox" },
  discoverable: true,
  suspended: false,
  memorial: false,
  indexable: true
}
~~~~

You can omit the `@` prefix when looking up an actor by handle:

~~~~ sh
fedify lookup fedify-example@fedify-blog.deno.dev
~~~~

Or you can look up an actor by `acct:` URL:

~~~~ sh
fedify lookup acct:fedify-example@fedify-blog.deno.dev
~~~~

### Looking up multiple objects at once

You can also look up multiple objects at once by specifying multiple URLs or
handles.  For example, the below command looks up multiple objects:

~~~~ sh
fedify lookup @hongminhee@fosstodon.org @fedify@hollo.social
~~~~

The output will be like the below:

~~~~
Person {
  ...
}
----
Person {
  ...
}
~~~~

As you can see, the outputs are separated by `----` by default.  You can change
the separator by using the [`-s`/`--separator`](#s-separator-output-separator)
option.

> [!NOTE]
> The `fedify lookup` command cannot take multiple argument if
> [`-t`/`--traverse`](#t-traverse-traverse-the-collection) option is turned
> on.

### `-t`/`--traverse`: Traverse the collection

*This option is available since Fedify 0.14.0.*

The `-t`/`--traverse` option is used to traverse the collection when looking up
a collection object.  For example, the below command looks up a collection
object:

~~~~ sh
fedify lookup --traverse https://fosstodon.org/users/hongminhee/outbox
~~~~

The difference between with and without the `-t`/`--traverse` option is that
the former will output the objects in the collection, while the latter will
output the collection object itself.

This option only works with a single argument, and it has to be a collection.

### `-S`/`--suppress-errors`: Suppress partial errors during traversal

*This option is available since Fedify 0.14.0.*

The `-S`/`--suppress-errors` option is used to suppress partial errors during
traversal.  For example, the below command looks up a collection object with
the `-t`/`--traverse` option:

~~~~ sh
fedify lookup --traverse --suppress-errors https://fosstodon.org/users/hongminhee/outbox
~~~~

The difference between with and without the `-S`/`--suppress-errors` option is
that the former will suppress the partial errors during traversal, while the
latter will stop the traversal when an error occurs.

This option depends on the `-t`/`--traverse` option.

### `-c`/`--compact`: Compact JSON-LD

> [!NOTE]
> This option is mutually exclusive with `-e`/`--expanded` and `-r`/`--raw`.

You can also output the object in the [compacted JSON-LD] format by using the
`-c`/`--compact` option:

~~~~ sh
fedify lookup --compact https://todon.eu/@hongminhee/112341925069749583
~~~~

The output will be like the below:

~~~~ json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "id": "https://todon.eu/users/hongminhee/statuses/112341925069749583",
  "type": "Note",
  "attachment": {
    "type": "Document",
    "mediaType": "video/mp4",
    "name": "The demo video on my terminal",
    "url": "https://todon.eu/system/media_attachments/files/112/341/916/300/016/369/original/f83659866f94054f.mp4"
  },
  "attributedTo": "https://todon.eu/users/hongminhee",
  "cc": "https://todon.eu/users/hongminhee/followers",
  "content": "<p>I&#39;m working on adding a CLI toolchain to <a href=\"https://todon.eu/tags/Fedify\" class=\"mention hashtag\" rel=\"tag\">#<span>Fedify</span></a> to help with debugging.  The first feature I implemented is the ActivityPub object lookup.</p><p>Here&#39;s a demo.</p><p><a href=\"https://todon.eu/tags/fedidev\" class=\"mention hashtag\" rel=\"tag\">#<span>fedidev</span></a> <a href=\"https://todon.eu/tags/ActivityPub\" class=\"mention hashtag\" rel=\"tag\">#<span>ActivityPub</span></a></p>",
  "contentMap": {
    "en": "<p>I&#39;m working on adding a CLI toolchain to <a href=\"https://todon.eu/tags/Fedify\" class=\"mention hashtag\" rel=\"tag\">#<span>Fedify</span></a> to help with debugging.  The first feature I implemented is the ActivityPub object lookup.</p><p>Here&#39;s a demo.</p><p><a href=\"https://todon.eu/tags/fedidev\" class=\"mention hashtag\" rel=\"tag\">#<span>fedidev</span></a> <a href=\"https://todon.eu/tags/ActivityPub\" class=\"mention hashtag\" rel=\"tag\">#<span>ActivityPub</span></a></p>"
  },
  "published": "2024-04-27T07:08:57Z",
  "replies": {
    "id": "https://todon.eu/users/hongminhee/statuses/112341925069749583/replies",
    "type": "Collection",
    "first": {
      "type": "CollectionPage",
      "items": "https://todon.eu/users/hongminhee/statuses/112343493232608516",
      "next": "https://todon.eu/users/hongminhee/statuses/112341925069749583/replies?min_id=112343493232608516&page=true",
      "partOf": "https://todon.eu/users/hongminhee/statuses/112341925069749583/replies"
    }
  },
  "as:sensitive": false,
  "to": "as:Public",
  "url": "https://todon.eu/@hongminhee/112341925069749583"
}
~~~~

[compacted JSON-LD]: https://www.w3.org/TR/json-ld/#compacted-document-form

### `-e`/`--expanded`: Expanded JSON-LD

> [!NOTE]
> This option is mutually exclusive with `-c`/`--compact` and `-r`/`--raw`.

You can also output the object in the [expanded JSON-LD] format by using the
`-e`/`--expanded` option:

~~~~ sh
fedify lookup --expand https://todon.eu/@hongminhee/112341925069749583
~~~~

The output will be like the below:

~~~~ json
[
  {
    "@id": "https://todon.eu/users/hongminhee/statuses/112341925069749583",
    "@type": [
      "https://www.w3.org/ns/activitystreams#Note"
    ],
    "https://www.w3.org/ns/activitystreams#attachment": [
      {
        "@type": [
          "https://www.w3.org/ns/activitystreams#Document"
        ],
        "https://www.w3.org/ns/activitystreams#mediaType": [
          {
            "@value": "video/mp4"
          }
        ],
        "https://www.w3.org/ns/activitystreams#name": [
          {
            "@value": "The demo video on my terminal"
          }
        ],
        "https://www.w3.org/ns/activitystreams#url": [
          {
            "@id": "https://todon.eu/system/media_attachments/files/112/341/916/300/016/369/original/f83659866f94054f.mp4"
          }
        ]
      }
    ],
    "https://www.w3.org/ns/activitystreams#attributedTo": [
      {
        "@id": "https://todon.eu/users/hongminhee"
      }
    ],
    "https://www.w3.org/ns/activitystreams#cc": [
      {
        "@id": "https://todon.eu/users/hongminhee/followers"
      }
    ],
    "https://www.w3.org/ns/activitystreams#content": [
      {
        "@value": "<p>I&#39;m working on adding a CLI toolchain to <a href=\"https://todon.eu/tags/Fedify\" class=\"mention hashtag\" rel=\"tag\">#<span>Fedify</span></a> to help with debugging.  The first feature I implemented is the ActivityPub object lookup.</p><p>Here&#39;s a demo.</p><p><a href=\"https://todon.eu/tags/fedidev\" class=\"mention hashtag\" rel=\"tag\">#<span>fedidev</span></a> <a href=\"https://todon.eu/tags/ActivityPub\" class=\"mention hashtag\" rel=\"tag\">#<span>ActivityPub</span></a></p>"
      },
      {
        "@language": "en",
        "@value": "<p>I&#39;m working on adding a CLI toolchain to <a href=\"https://todon.eu/tags/Fedify\" class=\"mention hashtag\" rel=\"tag\">#<span>Fedify</span></a> to help with debugging.  The first feature I implemented is the ActivityPub object lookup.</p><p>Here&#39;s a demo.</p><p><a href=\"https://todon.eu/tags/fedidev\" class=\"mention hashtag\" rel=\"tag\">#<span>fedidev</span></a> <a href=\"https://todon.eu/tags/ActivityPub\" class=\"mention hashtag\" rel=\"tag\">#<span>ActivityPub</span></a></p>"
      }
    ],
    "https://www.w3.org/ns/activitystreams#published": [
      {
        "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
        "@value": "2024-04-27T07:08:57Z"
      }
    ],
    "https://www.w3.org/ns/activitystreams#replies": [
      {
        "@id": "https://todon.eu/users/hongminhee/statuses/112341925069749583/replies",
        "@type": [
          "https://www.w3.org/ns/activitystreams#Collection"
        ],
        "https://www.w3.org/ns/activitystreams#first": [
          {
            "@type": [
              "https://www.w3.org/ns/activitystreams#CollectionPage"
            ],
            "https://www.w3.org/ns/activitystreams#items": [
              {
                "@id": "https://todon.eu/users/hongminhee/statuses/112343493232608516"
              }
            ],
            "https://www.w3.org/ns/activitystreams#next": [
              {
                "@id": "https://todon.eu/users/hongminhee/statuses/112341925069749583/replies?min_id=112343493232608516&page=true"
              }
            ],
            "https://www.w3.org/ns/activitystreams#partOf": [
              {
                "@id": "https://todon.eu/users/hongminhee/statuses/112341925069749583/replies"
              }
            ]
          }
        ]
      }
    ],
    "https://www.w3.org/ns/activitystreams#sensitive": [
      {
        "@value": false
      }
    ],
    "https://www.w3.org/ns/activitystreams#to": [
      {
        "@id": "https://www.w3.org/ns/activitystreams#Public"
      }
    ],
    "https://www.w3.org/ns/activitystreams#url": [
      {
        "@id": "https://todon.eu/@hongminhee/112341925069749583"
      }
    ]
  }
]
~~~~

[expanded JSON-LD]: https://www.w3.org/TR/json-ld/#expanded-document-form

### `-r`/`--raw`: Raw JSON

*This option is available since Fedify 0.15.0.*

> [!NOTE]
> This option is mutually exclusive with `-c`/`--compact` and `-e`/`--expanded`.

You can also output the fetched object in the raw JSON format by using
the `-r`/`--raw` option:

~~~~ sh
fedify lookup --raw https://todon.eu/@hongminhee/112341925069749583
~~~~

The output will be like the below:

~~~~ json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    {
      "ostatus": "http://ostatus.org#",
      "atomUri": "ostatus:atomUri",
      "inReplyToAtomUri": "ostatus:inReplyToAtomUri",
      "conversation": "ostatus:conversation",
      "sensitive": "as:sensitive",
      "toot": "http://joinmastodon.org/ns#",
      "votersCount": "toot:votersCount",
      "blurhash": "toot:blurhash",
      "focalPoint": {
        "@container": "@list",
        "@id": "toot:focalPoint"
      },
      "Hashtag": "as:Hashtag"
    }
  ],
  "id": "https://todon.eu/users/hongminhee/statuses/112341925069749583",
  "type": "Note",
  "summary": null,
  "inReplyTo": null,
  "published": "2024-04-27T07:08:57Z",
  "url": "https://todon.eu/@hongminhee/112341925069749583",
  "attributedTo": "https://todon.eu/users/hongminhee",
  "to": [
    "https://www.w3.org/ns/activitystreams#Public"
  ],
  "cc": [
    "https://todon.eu/users/hongminhee/followers"
  ],
  "sensitive": false,
  "atomUri": "https://todon.eu/users/hongminhee/statuses/112341925069749583",
  "inReplyToAtomUri": null,
  "conversation": "tag:todon.eu,2024-04-27:objectId=90184788:objectType=Conversation",
  "content": "<p>I&#39;m working on adding a CLI toolchain to <a href=\"https://todon.eu/tags/Fedify\" class=\"mention hashtag\" rel=\"tag\">#<span>Fedify</span></a> to help with debugging.  The first feature I implemented is the ActivityPub object lookup.</p><p>Here&#39;s a demo.</p><p><a href=\"https://todon.eu/tags/fedidev\" class=\"mention hashtag\" rel=\"tag\">#<span>fedidev</span></a> <a href=\"https://todon.eu/tags/ActivityPub\" class=\"mention hashtag\" rel=\"tag\">#<span>ActivityPub</span></a></p>",
  "contentMap": {
    "en": "<p>I&#39;m working on adding a CLI toolchain to <a href=\"https://todon.eu/tags/Fedify\" class=\"mention hashtag\" rel=\"tag\">#<span>Fedify</span></a> to help with debugging.  The first feature I implemented is the ActivityPub object lookup.</p><p>Here&#39;s a demo.</p><p><a href=\"https://todon.eu/tags/fedidev\" class=\"mention hashtag\" rel=\"tag\">#<span>fedidev</span></a> <a href=\"https://todon.eu/tags/ActivityPub\" class=\"mention hashtag\" rel=\"tag\">#<span>ActivityPub</span></a></p>"
  },
  "attachment": [
    {
      "type": "Document",
      "mediaType": "video/mp4",
      "url": "https://todon.eu/system/media_attachments/files/112/341/916/300/016/369/original/f83659866f94054f.mp4",
      "name": "The demo video on my terminal",
      "blurhash": "U87_4lWB_3WBt7bHazWV~qbHaybFozj[ayfj",
      "width": 1092,
      "height": 954
    }
  ],
  "tag": [
    {
      "type": "Hashtag",
      "href": "https://todon.eu/tags/fedify",
      "name": "#fedify"
    },
    {
      "type": "Hashtag",
      "href": "https://todon.eu/tags/fedidev",
      "name": "#fedidev"
    },
    {
      "type": "Hashtag",
      "href": "https://todon.eu/tags/activitypub",
      "name": "#activitypub"
    }
  ],
  "replies": {
    "id": "https://todon.eu/users/hongminhee/statuses/112341925069749583/replies",
    "type": "Collection",
    "first": {
      "type": "CollectionPage",
      "next": "https://todon.eu/users/hongminhee/statuses/112341925069749583/replies?min_id=112343493232608516&page=true",
      "partOf": "https://todon.eu/users/hongminhee/statuses/112341925069749583/replies",
      "items": [
        "https://todon.eu/users/hongminhee/statuses/112343493232608516"
      ]
    }
  }
}
~~~~

### `-a`/`--authorized-fetch`: Authorized fetch

You can also use the `-a`/`--authorized-fetch` option to fetch the object with
authentication.  Under the hood, this option generates an one-time key pair,
spins up a temporary ActivityPub server to serve the public key, and signs
the request with the private key.

Here's an example where the `fedify lookup` fails due to the object being
protected:

~~~~ sh
fedify lookup @tchambers@indieweb.social
~~~~

The above command will output the below error:

~~~~
Failed to fetch the object.
It may be a private object.  Try with -a/--authorized-fetch.
~~~~

However, you can fetch the object with the `-a`/`--authorized-fetch` option:

~~~~ sh
fedify lookup --authorized-fetch @tchambers@indieweb.social
~~~~

This time, the above command will output the object successfully:

~~~~
Person {
  id: URL "https://indieweb.social/users/tchambers",
  attachments: [
    PropertyValue {
      name: "Indieweb Site",
      value: '<a href="http://www.timothychambers.net" target="_blank" rel="nofollow noopener noreferrer me" trans'... 128 more characters
    },
    PropertyValue {
      name: "Gravatar",
      value: '<a href="https://en.gravatar.com/tchambers" target="_blank" rel="nofollow noopener noreferrer me" tr'... 134 more characters
    },
    PropertyValue {
      name: "Threads",
      value: '<a href="https://www.threads.net/@timothyjchambers" target="_blank" rel="nofollow noopener noreferre'... 150 more characters
    },
    PropertyValue {
      name: "GitHub",
      value: '<a href="https://github.com/Timothyjchambers" target="_blank" rel="nofollow noopener noreferrer me" '... 138 more characters
    }
  ],
  name: "Tim Chambers",
  icon: Image {
    url: URL "https://cdn.masto.host/indiewebsocial/accounts/avatars/000/000/002/original/5de753df6fe336d5.png",
    mediaType: "image/png"
  },
  image: Image {
    url: URL "https://cdn.masto.host/indiewebsocial/accounts/headers/000/000/002/original/38c44f4142b84cf4.png",
    mediaType: "image/png"
  },
  published: 2019-08-30T00:00:00Z,
  summary: "<p>Technologist, writer, admin of indieweb.social. Fascinated by how new politics impacts technology"... 346 more characters,
  url: URL "https://indieweb.social/@tchambers",
  preferredUsername: "tchambers",
  publicKey: CryptographicKey {
    id: URL "https://indieweb.social/users/tchambers#main-key",
    owner: URL "https://indieweb.social/users/tchambers",
    publicKey: CryptoKey {
      type: "public",
      extractable: true,
      algorithm: {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: Uint8Array(3) [ 1, 0, 1 ],
        hash: { name: "SHA-256" }
      },
      usages: [ "verify" ]
    }
  },
  manuallyApprovesFollowers: false,
  inbox: URL "https://indieweb.social/users/tchambers/inbox",
  outbox: URL "https://indieweb.social/users/tchambers/outbox",
  following: URL "https://indieweb.social/users/tchambers/following",
  followers: URL "https://indieweb.social/users/tchambers/followers",
  endpoints: Endpoints { sharedInbox: URL "https://indieweb.social/inbox" },
  discoverable: true,
  memorial: false,
  indexable: true
}
~~~~

### `--first-knock`: First-knock spec for `-a`/`--authorized-fetch`

*This option is available since Fedify 1.6.0.*

The `--first-knock` option is used to specify which HTTP Signatures spec to
try first when using the `-a`/`--authorized-fetch` option.  The ActivityPub
ecosystem currently uses different versions of HTTP Signatures specifications,
and the [double-knocking] technique (trying one version, then falling back to
another if rejected) allows for better compatibility across servers.

Available options are:

`draft-cavage-http-signatures-12`
:   [HTTP Signatures], which is obsolete but still widely adopted in
    the fediverse as of May 2025.

`rfc9421` (default)
:   [RFC 9421]: HTTP Message Signatures, which is the final revision of
    the specification and is recommended, but not yet widely adopted
    in the fediverse as of June 2025.

If the first signature attempt fails, Fedify will automatically try the other
specification format, implementing the [double-knocking] technique described in
the [ActivityPub HTTP Signatures] specification.

[double-knocking]: https://swicg.github.io/activitypub-http-signature/#how-to-upgrade-supported-versions
[HTTP Signatures]: https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12
[RFC 9421]: https://www.rfc-editor.org/rfc/rfc9421
[ActivityPub HTTP Signatures]: https://swicg.github.io/activitypub-http-signature/

### `-u`/`--user-agent`: Custom `User-Agent` header

*This option is available since Fedify 1.3.0.*

By default, the `fedify lookup` command sends the `User-Agent` header with the
value `Fedify/1.3.0 (Deno/2.0.4)` (version numbers may vary).  You can specify
a custom `User-Agent` header by using the `-u`/`--user-agent` option.  For
example, to send the `User-Agent` header with the value `MyApp/1.0`, run the
below command:

~~~~ sh
fedify lookup --user-agent MyApp/1.0 @fedify@hollo.social
~~~~

### `-s`/`--separator`: Output separator

*This option is available since Fedify 1.3.0.*

You can specify the separator between the outputs when looking up multiple
objects at once by using the `-s`/`--separator` option.  For example, to use
the separator `====` between the outputs, run the below command:

~~~~ sh
fedify lookup -s ==== @fedify@hollo.social @hongminhee@fosstodon.org
~~~~

It does not affect the output when looking up a single object.

> [!TIP]
> The separator is also used when looking up a collection object with the
> [`-t`/`--traverse`](#t-traverse-traverse-the-collection) option.


`fedify inbox`: Ephemeral inbox server
--------------------------------------

The `fedify inbox` command is used to spin up an ephemeral server that serves
the ActivityPub inbox with an one-time actor, through a short-lived public DNS
with HTTPS. This is useful when you want to test and debug the outgoing
activities of your server.  To start an ephemeral inbox server,
run the below command:

~~~~ sh
fedify inbox
~~~~

If it goes well, you will see the output like the below (without termination;
press <kbd>^C</kbd> to stop the server):

~~~~
✔ The ephemeral ActivityPub server is up and running: https://f9285cf4974c86.lhr.life/
✔ Sent follow request to @faguscus_dashirniul@activitypub.academy.
╭───────────────┬─────────────────────────────────────────╮
│ Actor handle: │ i@f9285cf4974c86.lhr.life               │
├───────────────┼─────────────────────────────────────────┤
│    Actor URI: │ https://f9285cf4974c86.lhr.life/i       │
├───────────────┼─────────────────────────────────────────┤
│  Actor inbox: │ https://f9285cf4974c86.lhr.life/i/inbox │
├───────────────┼─────────────────────────────────────────┤
│ Shared inbox: │ https://f9285cf4974c86.lhr.life/inbox   │
╰───────────────┴─────────────────────────────────────────╯
~~~~

Although the given URIs and handle are short-lived, they are anyway publicly
dereferenceable until the server is terminated.  You can use these URIs and
handle to test and debug the outgoing activities of your server.

If any incoming activities are received, the server will log them to the
console:

~~~~
╭────────────────┬─────────────────────────────────────╮
│     Request #: │ 2                                   │
├────────────────┼─────────────────────────────────────┤
│ Activity type: │ Follow                              │
├────────────────┼─────────────────────────────────────┤
│  HTTP request: │ POST /i/inbox                       │
├────────────────┼─────────────────────────────────────┤
│ HTTP response: │ 202                                 │
├────────────────┼─────────────────────────────────────┤
│        Details │ https://f9285cf4974c86.lhr.life/r/2 │
╰────────────────┴─────────────────────────────────────╯
~~~~

You can also see the details of the incoming activities by visiting the
`/r/:id` endpoint of the server in your browser:

![The details of the incoming activities](cli/fedify-inbox-web.png)

### `-f`/`--follow`: Follow an actor

The `-f`/`--follow` option is used to follow an actor.  You can specify the
actor handle or URI to follow.  For example, to follow the actor with the
handle *@john@doe.com* and *@jane@doe.com*, run the below command:

~~~~ sh
fedify inbox -f @john@doe.com -f @jane@doe.com
~~~~

> [!NOTE]
> Although `-f`/`--follow` option sends `Follow` activities to the specified
> actors, it does not guarantee that they will accept the follow requests.
> If the actors accept the follow requests, you will receive the `Accept`
> activities in the inbox server, and the server will log them to the console:
>
> ~~~~
> ╭────────────────┬─────────────────────────────────────╮
> │     Request #: │ 0                                   │
> ├────────────────┼─────────────────────────────────────┤
> │ Activity type: │ Accept                              │
> ├────────────────┼─────────────────────────────────────┤
> │  HTTP request: │ POST /i/inbox                       │
> ├────────────────┼─────────────────────────────────────┤
> │ HTTP response: │ 202                                 │
> ├────────────────┼─────────────────────────────────────┤
> │        Details │ https://f9285cf4974c86.lhr.life/r/0 │
> ╰────────────────┴─────────────────────────────────────╯
> ~~~~

### `-a`/`--accept-follow`: Accept follow requests

The `-a`/`--accept-follow` option is used to accept follow requests from
actors.  You can specify the actor handle or URI to accept follow requests.
Or you can accept all follow requests by specifying the wildcard `*`.
For example, to accept follow requests from the actor with the handle
*@john@doe.com* and *@jane@doe.com*, run the below command:

~~~~ sh
fedify inbox -a @john@doe.com -a @jane@doe.com
~~~~

When the follow requests are received from the specified actors, the server
will immediately send the `Accept` activities to them.  Otherwise, the server
will just log the `Follow` activities to the console without sending the
`Accept` activities.

### `-T`/`--no-tunnel`: Local server without tunneling

The `-T`/`--no-tunnel` option is used to disable the tunneling feature of the
inbox server.  By default, the inbox server tunnels the local server to the
public internet, so that the server is accessible from the outside.  If you
want to disable the tunneling feature, run the below command:

~~~~ sh
fedify inbox --no-tunnel
~~~~

It would be useful when you want to test the server locally but are worried
about the security implications of exposing the server to the public internet.

> [!NOTE]
> If you disable the tunneling feature, the ephemeral ActivityPub instance will
> be served via HTTP instead of HTTPS.


`fedify node`: Visualizing an instance's NodeInfo
-------------------------------------------------

*This command is available since Fedify 1.2.0.*

![The result of fedify lookup fosstodon.org. The NodeInfo document is
visualized along with the favicon.](cli/fedify-node.png)

The `fedify node` command fetches the given instance's [NodeInfo] document and
visualizes it in [`neofetch`]-style.  The argument can be either a bare hostname
or a full URL.

> [!TIP]
> Not all instances provide the NodeInfo document.  If the given instance does
> not provide the NodeInfo document, the command will output an error message.

[NodeInfo]: https://nodeinfo.diaspora.software/
[`neofetch`]: https://github.com/dylanaraps/neofetch

### `-r`/`--raw`: Raw JSON

> [!NOTE]
> This option is mutually exclusive with `-b`/`--best-effort`, `--no-favicon`
> and `-m`/`--metadata`.

You can also output the fetched NodeInfo document in the raw JSON format by using
the `-r`/`--raw` option:

~~~~ sh
fedify node --raw fosstodon.org
~~~~

The output will be like the below:

~~~~ json
{
  "version": "2.0",
  "software": {
    "name": "mastodon",
    "version": "4.4.2"
  },
  "protocols": [
    "activitypub"
  ],
  "services": {
    "outbound": [],
    "inbound": []
  },
  "usage": {
    "users": {
      "total": 62444,
      "activeMonth": 8788,
      "activeHalfyear": 14000
    },
    "localPosts": 4335412
  },
  "openRegistrations": false,
  "metadata": {
    "nodeName": "Fosstodon",
    "nodeDescription": "Fosstodon is an invite only Mastodon instance that is open to those who are interested in technology; particularly free & open source software.\r\n\r\nIf you wish to join, contact us for an invite."
  }
}
~~~~

### `-b`/`--best-effort`: Parsing with best effort

> [!NOTE]
> This option is mutually exclusive with `-r`/`--raw`.

The `-b`/`--best-effort` option is used to parse the NodeInfo document with
best effort.  If the NodeInfo document is not well-formed, the option will
try to parse it as much as possible.

### `--no-favicon`: Disabling favicon fetching

> [!NOTE]
> This option is mutually exclusive with `-r`/`--raw`.

The `--no-favicon` option is used to disable fetching the favicon of the
instance.

### `-m`/`--metadata`: Showing metadata

> [!NOTE]
> This option is mutually exclusive with `-r`/`--raw`.

The `-m`/`--metadata` option is used to show the extra metadata of the NodeInfo,
i.e., the `metadata` field of the document.

### `-u`/`--user-agent`: Custom `User-Agent` header

*This option is available since Fedify 1.3.0.*

By default, the `fedify node` command sends the `User-Agent` header with the
value `Fedify/1.3.0 (Deno/2.0.4)` (version numbers may vary).  You can specify
a custom `User-Agent` header by using the `-u`/`--user-agent` option.  For
example, to send the `User-Agent` header with the value `MyApp/1.0`, run the
below command:

~~~~ sh
fedify node --user-agent MyApp/1.0 mastodon.social
~~~~


`fedify tunnel`: Exposing a local HTTP server to the public internet
--------------------------------------------------------------------

*This command is available since Fedify 0.13.0.*

The `fedify tunnel` command is used to expose a local HTTP server to the public
internet using a secure tunnel.  It is useful when you want to test your
local ActivityPub server with the real-world ActivityPub instances.

To create a tunnel for a local server, for example, running on port 3000,
run the below command:

~~~~ sh
fedify tunnel 3000
~~~~

> [!TIP]
>
> The HTTP requests through the tunnel have the following headers:
>
>  `X-Forwarded-For`
>  :   The IP address of the client.
>
>  `X-Forwarded-Proto`
>  :   The protocol of the client, either `http` or `https`.
>
>  `X-Forwarded-Host`
>  :   The host of the public tunnel server.
>
> If you want to make your local server aware of these headers, you can use
> the [x-forwarded-fetch] middleware in front of your HTTP server.
>
> For more information, see [*How the `Federation` object recognizes the domain
> name* section](./manual/federation.md#how-the-federation-object-recognizes-the-domain-name)
> in the *Federation* document.

[x-forwarded-fetch]: https://github.com/dahlia/x-forwarded-fetch

### `-s`/`--service`: The tunneling service

The `-s`/`--service` option is used to specify the tunneling service to use.
Available services can be found in the output of the `fedify tunnel --help`
command.  For example, to use the serveo.net, run the below command:

~~~~ sh
fedify tunnel --service serveo.net 3000
~~~~

`fedify webfinger`: Looking up a WebFinger resource
---------------------------------------------------

*This command is available since Fedify 1.8.0.*

The `fedify webfinger` command is used to look up a WebFinger resource by
resource URI or handle.  [WebFinger] is a protocol that allows discovery of
information about people and other entities on the Internet using simple web
requests.  This command is useful for debugging and testing WebFinger
implementations.

To look up a WebFinger resource, for example, for a user handle, run the
below command:

~~~~ sh
fedify webfinger @username@domain.com
~~~~

The output will be like the below:

~~~~ json
{
  "subject": "acct:username@domain.com",
  "aliases": [
    "https://domain.com/@username",
    "https://domain.com/users/username"
  ],
  "links": [
    {
      "rel": "http://webfinger.net/rel/profile-page",
      "type": "text/html",
      "href": "https://domain.com/@username"
    },
    {
      "rel": "self",
      "type": "application/activity+json",
      "href": "https://domain.com/users/username"
    }
  ]
}
~~~~

You can also look up a WebFinger resource by its URL.  For example, the below
command looks up a WebFinger resource by http or acct URL:

~~~~ sh
fedify webfinger https://domain.com/@username
fedify webfinger acct:username@domain.com
~~~~

Or, you can also look up multiple WebFinger resources at once.  For example,
the below command looks up multiple WebFinger resources:

~~~~ sh
fedify webfinger @user1@domain.com https://domain.com/@username acct:username@domain.com
~~~~

The outputs will be displayed sequentially, each preceded by a success message
indicating which resource was found.

[WebFinger]: https://tools.ietf.org/html/rfc7033

### `-a`/`--user-agent`: Custom `User-Agent` header

By default, the `fedify webfinger` command sends the `User-Agent` header with
the value `Fedify/1.8.0 (Deno/2.4.0)` (version numbers may vary).  You can
specify a custom `User-Agent` header by using the `-a`/`--user-agent` option.
For example, to send the `User-Agent` header with the value `MyApp/1.0`, run
the below command:

~~~~ sh
fedify webfinger --user-agent MyApp/1.0 @username@domain.com
~~~~

### `-p`/`--allow-private-address`: Allow private IP addresses

The `-p`/`--allow-private-address` option is used to allow private IP addresses.
If you want to allow private IP addresses, run the below command:

~~~~ sh
fedify webfinger --allow-private-address @username@localhost
~~~~

Mostly useful for testing purposes.  *Do not use this in production.*


Shell completions
-----------------

The `fedify` command supports shell completions for [Bash](#bash),
[Fish](#fish), and [Zsh](#zsh).

### Bash

To enable Bash completions add the following line to your profile file
(*~/.bashrc*, *~/.bash_profile*, or *~/.profile*):

~~~~ bash
source <(fedify completions bash)
~~~~

### Fish

To enable Fish completions add the following line to your profile file
(*~/.config/fish/config.fish*):

~~~~ fish
source (fedify completions fish | psub)
~~~~

### Zsh

To enable Zsh completions add the following line to your profile file
(*~/.zshrc*):

~~~~ zsh
source <(fedify completions zsh)
~~~~

<!-- cSpell: ignore mentio fedidev Indieweb noreferre tchambers ostatus blurhash todon HaybFozj ayfj serveo psub fosstodon neofetch -->
