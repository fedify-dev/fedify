Fedify–H3 integration example
=============================

This is a simple example of how to integrate Fedify into an [H3]
application.

[H3]: https://h3.unjs.io/


Running the example
-------------------

1.  Clone the repository:

    ~~~~ sh
    git clone https://github.com/fedify-dev/fedify.git
    ~~~~

2.  Move to the example folder:

    ~~~~ sh
    cd examples/h3
    ~~~~

3.  Install dependencies:

    ~~~~ sh
    pnpm install
    ~~~~

4.  Start the server:

    ~~~~ sh
    deno serve -A index.ts
    ~~~~

5.  Look up the actor URL:

    ~~~~
    http://localhost:8000/users/{identifier}
    ~~~~
