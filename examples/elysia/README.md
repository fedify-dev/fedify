Fedify–Elysia integration example
=================================

This is a simple example of how to integrate Fedify into an [Elysia]
application.

[Elysia]: https://elysiajs.com/


Running the example
-------------------

1.  Clone the repository:

    ~~~~ sh
    git clone https://github.com/fedify-dev/fedify.git
    ~~~~

2.  Build pacakges

    ~~~~ sh
    cd fedify/packages/elysia
    pnpm install
    pnpm build
    cd ../fedify
    pnpm build
    ~~~~

3.  Move to example folder

    ~~~~ sh
    cd ../../examples/elysia
    pnpm install
    ~~~~

4.  Start the server:

    ~~~~ sh
    bun run start
    ~~~~
