---
description: >-
  Logging is a useful tool for debugging your federated server app.  This
  section explains how to enable logging in your federated server app.
---

Logging
=======

*This API is available since Fedify 0.7.0.*

> [!TIP]
> We highly recommend enabling logging in your federated server app to debug
> your app easily.

Fedify uses the [LogTape] package to log messages.  You can enable logging in
your federated server app by installing the `@logtape/logtape` package and
configuring it in the entry point of your app.

[LogTape]: https://logtape.org/


Setting up LogTape
------------------

To enable logging in your federated server app, you need to install the
`@logtape/logtape` package (available on both [JSR] and [npm]):

::: code-group

~~~~ sh [Deno]
deno add jsr:@logtape/logtape
~~~~

~~~~ sh [npm]
npm add @logtape/logtape
~~~~

~~~~ sh [pnpm]
pnpm add @logtape/logtape
~~~~

~~~~ sh [Yarn]
yarn add @logtape/logtape
~~~~

~~~~ sh [Bun]
bun add @logtape/logtape
~~~~

:::

Then, you can [`configure()`] the logger in the entry point of your app:

~~~~ typescript twoslash
import { AsyncLocalStorage } from "node:async_hooks";
import { configure, getConsoleSink } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: "your-app", sinks: ["console"], lowestLevel: "debug" },
    { category: "fedify",   sinks: ["console"], lowestLevel: "error" },
  ],
  contextLocalStorage: new AsyncLocalStorage(),
});
~~~~

The `configure()` function takes an object with three properties:

`sinks` (mandatory)
:   An object that maps sink names to sink instances.  In this example, we use
    the `getConsoleSink()` function to get a console sink instance.

`filters` (mandatory)
:   An object that maps logger categories to filter functions.  In this example,
    we use an empty object to disable filtering.

`loggers` (mandatory)
:   An array of logger configurations.  Each configuration is an object with
    four properties:

`loggers.category` (mandatory)
:   The `category` property is an array of string or a string that specifies
    the logger category.  If a string is given, it is treated as an array
    with a single element.

`loggers.sinks` (optional)
:   The `sinks` property is an array of string that specifies the sink names
    that the logger should use.

`loggers.filters` (optional)
:   The `filters` property is an array of string that specifies the filter
    names that the logger should use.

`loggers.lowestLevel` (optional)
:   The `lowestLevel` property is a string that specifies the log level.
    The log level can be one of the following: `"debug"`, `"info"`, `"warning"`,
    `"error"`, or `"fatal"`.

    > [!NOTE]
    > The `lowestLevel` property was introduced in LogTape 0.8.0.  Prior to
    > LogTape 0.8.0, please use the `level` property instead of `lowestLevel`.

`contextLocalStorage` (recommended)
:   *This property is available since LogTape 0.7.0.*

    An instance of [`AsyncLocalStorage`] that is used to store
    [implicit contexts] of the log messages.  This is useful when you want to
    trace the log messages in a specific context.

[JSR]: https://jsr.io/@logtape/logtape
[npm]: https://www.npmjs.com/package/@logtape/logtape
[`configure()`]: https://jsr.io/@logtape/logtape/doc/~/configure
[`AsyncLocalStorage`]: https://nodejs.org/api/async_context.html#class-asynclocalstorage
[implicit contexts]: https://logtape.org/manual/contexts#implicit-contexts


Categories
----------

> [!TIP]
> A logger category is an array of strings that specifies the logger category.
> The logger category is used to filter log messages, or to configure
> the specific sink for the logger.  Since it's hierarchical, you can filter
> out log messages by specifying a prefix of the logger category while
> seeing log messages of a specific subcategory.
>
> Note that the logger category is case-sensitive.  A bare string is treated
> as an array with a single element.

Fedify uses the following logger categories:

### `"fedify"`

The `"fedify"` category is used for everything related to the Fedify library.

### `["fedify", "compat", "transformers"]`

*This category is available since Fedify 1.4.0.*

The `["fedify", "compat", "transformers"]` category is used for logging
`ActivityTransformer`-related messages.

### `["fedify", "federation"]`

The `["fedify", "federation"]` category is used for logging federation-related
messages.

### `["fedify", "federation", "actor"]`

*This category is available since Fedify 0.9.0.*

The `["fedify", "federation", "actor"]` category is used for logging messages
related to actor dispatcher.

### `["fedify", "federation", "collection"]`

*This category is available since Fedify 0.8.0.*

The `["fedify", "federation", "collection"]` category is used for logging
messages related to collections (e.g., outbox, followers, following).

### `["fedify", "federation", "fanout"]`

*This category is available since Fedify 1.5.0.*

The `["fedify", "federation", "fanout"]` category is used for logging
messages related to fanning out outgoing activities.

### `["fedify", "federation", "http"]`

*This category is available since Fedify 0.9.0.*

The `["fedify", "federation", "http"]` category is used for logging messages
related to HTTP requests and responses.  When you are curious about the
HTTP requests and responses, you can check the log messages in this category
with the `"info"` level.

### `["fedify", "federation", "inbox"]`

The `["fedify", "federation", "inbox"]` category is used for logging messages
related to incoming activities.  When you cannot receive an activity, you can
check the log messages in this category with the `"debug"` level.

### `["fedify", "federation", "object"]`

The `["fedify", "federation", "object"]` category is used for logging messages
related to object dispatchers.

### `["fedify", "federation", "outbox"]`

The `["fedify", "federation", "outbox"]` category is used for logging messages
related to outgoing activities.  When you cannot send an activity, you can
check the log messages in this category with the `"debug"` level.

### `["fedify", "federation", "queue"]`

*This category is available since Fedify 0.12.0.*

The `["fedify", "federation", "queue"]` category is used for logging messages
related to the task queue.  When you are curious about the task queue, you can
check the log messages in this category with the `"debug"` level.

### `["fedify", "nodeinfo", "client"]`

*This category is available since Fedify 1.2.0.*

The `["fedify", "nodeinfo", "client"]` category is used for logging messages
related to the NodeInfo client.  When you are curious about the NodeInfo client,
you can check the log messages in this category with the `"error"` level.

### `["fedify", "otel", "exporter"]`

*This category is available since Fedify 1.10.0.*

The `["fedify", "otel", "exporter"]` category is used for logging messages
related to the `FedifySpanExporter`.  When span export to the `KvStore` fails,
you can check the log messages in this category with the `"error"` level.

### `["fedify", "runtime", "docloader"]`

*This category is available since Fedify 0.8.0.*

The `["fedify", "runtime", "docloader"]` category is used for logging messages
related to the document loader.  When you are curious about what specific
requests are made by the document loader, you can check the log messages in
this category with the `"debug"` level.

### `["fedify", "sig", "http"]`

*This category is available since Fedify 0.9.0.*

The `["fedify", "sig", "ld"]` category is used for logging messages related
to [HTTP Signatures](./send.md#http-signatures).  When you are curious about
the signature verification process, you can check the log messages in this
category with the `"debug"` level.

### `["fedify", "sig", "ld"]`

*This category is available since Fedify 1.0.0.*

The `["fedify", "sig", "ld"]` category is used for logging messages related to
[Linked Data Signatures](./send.md#linked-data-signatures).  When you are
curious about the signature verification process, you can check the log
messages in this category with the `"debug"` level.

### `["fedify", "sig", "proof"]`

*This category is available since Fedify 0.10.0.*

The `["fedify", "sig", "proof"]` category is used for logging messages related
to [Object Integrity Proofs](./send.md#object-integrity-proofs).  When you are
curious about the proof verification process, you can check the log messages in
this category with the `"debug"` level.

### `["fedify", "sig", "key"]`

*This category is available since Fedify 0.10.0.*

The `["fedify", "sig", "key"]` category is used for logging messages related
to key generation and key retrieval.  When you are curious about these
processes, you can check the log messages in this category with the `"debug"`
level.

### `["fedify", "vocab", "lookup"]`

*This category is available since Fedify 0.10.0.*

The `["fedify", "vocab", "lookup"]` category is used for logging messages
related to looking up ActivityPub objects.  When you are curious about the
lookup process, you can check the log messages in this category with the
`"debug"` level.

### `["fedify", "webfinger", "server"]`

*This category is available since Fedify 0.13.0.*

The `["fedify", "webfinger", "server"]` category is used for logging messages
related to the WebFinger server.  When you are curious about the WebFinger
server, you can check the log messages in this category with the `"debug"`
level.

### `["fedify", "webfinger", "lookup"]`

*This category is available since Fedify 0.10.0.*

The `["fedify", "webfinger", "lookup"]` category is used for logging messages
related to looking up WebFinger resources.  When you are curious about the
lookup process, you can check the log messages in this category with the
`"debug"` level.


Sinks
-----

A sink is a destination where log messages are sent.  LogTape provides few
built-in sinks:

 -  [console sink]
 -  [stream sink]
 -  [file sink]
 -  [rotating file sink]
 -  [OpenTelemetry sink]

However, you can create your own sink by implementing the [`Sink`] interface,
e.g., to send log messages to a database or a cloud service.

For more information about sinks, see the [*Sinks* section] in the LogTape docs.

[console sink]: https://logtape.org/manual/sinks#console-sink
[stream sink]: https://logtape.org/manual/sinks#stream-sink
[file sink]: https://logtape.org/manual/sinks#file-sink
[rotating file sink]: https://logtape.org/manual/sinks#rotating-file-sink
[OpenTelemetry sink]: https://logtape.org/manual/sinks#opentelemetry-sink
[`Sink`]: https://jsr.io/@logtape/logtape/doc/~/Sink
[*Sinks* section]: https://logtape.org/manual/sinks


Deprecation warnings
--------------------

When you are using deprecated APIs, you can see deprecation warnings in the
log messages.  The deprecation warnings are logged with the `"warning"` level
in each category where the deprecated API is used.  If you want to see all
deprecation warnings, you can set the log level to `"warning"` for the
[`"fedify"` category](#fedify).


Tracing
-------

*This feature is available since Fedify 1.2.0.*

> [!CAUTION]
> Traceable log messages rely on [implicit contexts] which was introduced in
> LogTape 0.7.0.  If you don't configure `contextLocalStorage` in
> [`configure()`], you cannot trace log messages.

The most of log messages made by Fedify can be traced by either below two
properties:

`requestId`
:   If the log message is made in the context of an HTTP request,
    the `requestId` property is included in it.  The `requestId` is a unique
    identifier for the HTTP request, which is derived from one of the following
    headers:

     -  [`X-Request-Id`]
     -  `X-Correlation-Id`
     -  [`Traceparent`]
     -  Otherwise, the `requestId` is a unique string derived from
        the current timestamp and the random number.

`messageId`
:   If the log message is made in the context of a background task,
    the `messageId` property is included in it.  The `messageId` is a unique
    identifier for the background task, which is a UUID.

When you want to trace log messages, first of all you need to use a sink that
writes log messages as structured data.  For example, you can use
a [file sink] with a [JSON Lines] formatter.  Oh, and don't forget to set
`contextLocalStorage` in [`configure()`]!  To sum up, you can configure
loggers like this:

~~~~ typescript twoslash
import { AsyncLocalStorage } from "node:async_hooks";
import { getFileSink } from "@logtape/file";
import { type LogRecord, configure } from "@logtape/logtape";

await configure({
  sinks: {
    file: getFileSink("fedify-logs.jsonld", {
      formatter(record: LogRecord): string {
        return JSON.stringify(record) + "\n";
      }
    })
  },
  loggers: [
    { category: "fedify", sinks: ["file"], lowestLevel: "info" },
  ],
  contextLocalStorage: new AsyncLocalStorage(),
});
~~~~

If your loggers are configured like this, you can filter log messages by
`requestId` or `messageId` in the log file.  For example, you can filter log
messages by `requestId` using [`jq`]:

~~~~ sh
jq -r 'select(.properties.requestId == "your-request-id")' fedify-logs.jsonl
~~~~

[`X-Request-Id`]: https://http.dev/x-request-id
[`Traceparent`]: https://www.w3.org/TR/trace-context/#traceparent-header
[JSON Lines]: https://jsonlines.org/
[`jq`]: https://jqlang.github.io/jq/
