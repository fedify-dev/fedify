Fedify on Cloudflare Workers
============================

This project contains an example of Fedify on [Cloudflare Workers].  Although
it can just accept `Follow` and `Undo(Follow)` activities, it sufficiently
shows how to use Fedify on Cloudflare Workers.

The application code is placed in the *src/index.ts* file, and the most
important part for integration with Cloudflare Workers is the end of the file,
where the `export default` statement is used to export the `fetch()` and
`queue()` methods.

Here are some important notes about the code:

 -  Since `KvNamespace` and `Queue` are not bound to global variables,
    but rather passed as an argument to the `fetch()` and `queue()` methods,
    you need to instantiate your `Federation` object inside these methods,
    rather than at the top level.

 -  Since defining a `queue()` method is the only way to consume messages from
    the queue in Cloudflare Workers, we need to define it so that the messages
    can be manually processed by `Federation.processQueuedTake()` method.

You can run this example in your local machine using the `pnpm dev` command:

~~~~ bash
pnpm install
pnpm dev
~~~~

[Cloudflare Workers]: https://workers.cloudflare.com/
