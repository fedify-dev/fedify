Fedify–Next.js integration example
==================================

`create-next-app`
-----------------

If you created Fedify–Next.js app with `create-next-app` and
`-e https://github.com/fedify-dev/fedify --example-path examples/next-integration`
option, you should fix `@fedify/fedify` and `@fedify/next` packages version to
`^1.9.0` from `:workspace` in [`package.json`](./package.json).


Running the example
-------------------

1.  Clone the repository:

    ~~~~ sh
    git clone https://github.com/fedify-dev/fedify.git
    cd fedify/examples/next-integration
    ~~~~

2.  Install dependencies:

    ~~~~ sh
    pnpm i
    ~~~~

3.  Start the server:

    ~~~~ sh
    pnpm dev & pnpx @fedify/cli tunnel 3000
    ~~~~

4.  Open your browser tunneled URL and start interacting with the app.
    You can see your handle such as
    `@demo@6c10b40c63d9e1ce7da55667ef0ef8b4.serveo.net`.

5.  Access https://activitypub.academy/ and search your handle and follow.

6.  You can see following list like:

    ~~~~
    This account has the below 1 followers:
    https://activitypub.academy/users/beboes_bedoshs
    ~~~~
