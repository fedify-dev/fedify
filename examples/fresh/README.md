Fedify–Fresh integration example
================================

This is a simple example of how to integrate Fedify into an [Fresh]
application.

> [!WARNING]
> This integration remains supported throughout the Fedify 2.x series, but
> Fresh is not recommended for new projects.  Deno's team will provide bug
> fixes and security updates for the Deno runtime until October 2027, then end
> its own development of the runtime, and this example targets Fresh 2.x, which
> runs on Deno.  Fresh has announced plans for non-Deno runtimes in Fresh 3, but
> that support is not yet released or stable enough for this integration and
> its example.
>
> The integration is tentatively planned for removal in Fedify 3.0.0; see
> [#1326] for the removal plan and the reassessment it requires.  That plan may
> be reconsidered if Fresh gains stable support that lets Fedify run and test
> the integration and its example on a supported non-Deno runtime.  See the
> [Deno announcement] and the [Fresh announcement] for background.

Use Deno 2.7.7 or later.  Deno 2.7.6 had an upstream Fresh/Vite dev-server
regression that caused `Callback called multiple times` errors before Fedify
code could run.

[Fresh]: https://fresh.deno.dev/
[#1326]: https://github.com/fedify-dev/fedify/issues/1326
[Deno announcement]: https://deno.com/blog/cloudflare
[Fresh announcement]: https://github.com/freshframework/fresh/discussions/3830


Running the example
-------------------

1.  Clone the repository:

    ~~~~ sh
    git clone https://github.com/fedify-dev/fedify.git
    ~~~~

2.  Build pacakges

    ~~~~ sh
    cd fedify
    mise install
    ~~~~

3.  Move to example folder

    ~~~~ sh
    cd examples/fresh
    ~~~~

4.  Start the server:

    ~~~~ sh
    deno task dev
    ~~~~

5.  Check NodeInfo of server

    ~~~~ sh
    fedify nodeinfo https://localhost:5173
    ~~~~
