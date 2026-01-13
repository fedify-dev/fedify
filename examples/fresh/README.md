Fedify–Fresh integration example
================================

This is a simple example of how to integrate Fedify into an [Fresh]
application.

[Fresh]: https://fresh.deno.dev/


Running the example
-------------------

1.  Clone the repository:

    ~~~~ sh
    git clone https://github.com/fedify-dev/fedify.git
    ~~~~

2.  Build pacakges

    ~~~~ sh
    cd fedify
    deno task build
    ~~~~

3.  Move to example folder

    ~~~~ sh
    cd ../../examples/fresh
    ~~~~

4.  Start the server:

    ~~~~ sh
    deno task dev
    ~~~~

5.  Check NodeInfo of server

    ~~~~ sh
    fedify nodeinfo https://localhost:5173
    ~~~~
