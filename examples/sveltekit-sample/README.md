SvelteKit sample
================

A comprehensive example of building a federated server application using
[Fedify] with [SvelteKit]. This sample demonstrates how to create an
ActivityPub-compatible federated social media server that can interact with
other federated platforms like Mastodon, Pleroma, and other ActivityPub
implementations.

[Fedify]: https://fedify.dev
[SvelteKit]: https://kit.svelte.dev/


🚀 features
-----------

 -  **ActivityPub Protocol Support**: Full implementation of ActivityPub for
    federated social networking
 -  **Actor System**: User profile management with cryptographic key pairs
 -  **Follow/Unfollow**: Complete follow relationship handling with Accept/Undo
    activities
 -  **Inbox Processing**: Real-time activity processing from federated instances
 -  **Modern UI**: Built with SvelteKit and Tailwind CSS
 -  **TypeScript**: Full type safety throughout the application


📋 prerequisites
----------------

Before you begin, ensure you have the following installed:

 -  **Node.js** (version 22 or higher, as required by Fedify)
 -  **npm** or **yarn** package manager
 -  **Git** for version control


🛠️ setup and installation
-------------------------

### 1. clone the repository

~~~~ bash
git clone https://github.com/fedify-dev/fedify.git
cd fedify/examples/sveltekit-sample
~~~~

### 2. install dependencies

~~~~ bash
pnpm install
~~~~

### 3. environment setup

The application uses in-memory storage by default, so no additional database
setup is required for development. However, for production deployment, you may
want to configure external storage.


🏃 development server
---------------------

### Start the development server

~~~~ bash
pnpm dev
~~~~

The development server will start on `http://localhost:5173` by default.


⚙️ configuration options
------------------------

### Federation configuration

The federation setup is configured in `src/lib/federation.ts`:

~~~~ typescript
const federation = createFederation({
  kv: new MemoryKvStore(), // In-memory storage for development
});
~~~~

#### Key configuration options:

1.  **Storage Backend**:
     -  Development: `MemoryKvStore()` (data lost on restart)
     -  Production: Consider using persistent storage solutions

2.  **Actor Identifier**:
     -  Default: `"demo"`
     -  Modify the `IDENTIFIER` constant to change the demo user

3.  **Demo Actor Profile**:
     -  Name: “Fedify Demo”
     -  Summary: “This is a Fedify Demo account.”
     -  Icon: `/demo-profile.png`

### Server configuration

#### Proxy/tunnel support

The application includes support for proxy headers via `x-forwarded-fetch`.
This is configured in `src/lib/handles.ts`:

~~~~ typescript
export const replaceHost: Handle = async ({ event, resolve }) => {
  event.request = await getXForwardedRequest(event.request);
  return resolve(event);
};
~~~~

This is useful when deploying behind reverse proxies or using tunneling
services like ngrok.

But if you don't use proxy or tunnel, the handle is unnecessary.


📚 example usage scenarios
--------------------------

### 1. basic federation testing

1.  Start the development server:

    ~~~~ bash
    pnpm dev
    ~~~~

2.  Access the demo user profile:

    ~~~~
    curl http://localhost:5173/users/demo
    ~~~~

3.  The ActivityPub actor endpoint is available at:

    ~~~~
    curl -H "Accept: application/activity+json" http://localhost:5173/users/demo
    ~~~~

### 2. following from `activitypub.academy`

[`activitypub.academy`] is a platform for learning about the ActivityPub
protocol and its implementation.

To test federation with `activitypub.academy`:

1.  Deploy the application to a public server or use a tunneling service:

    ~~~~ bash
    # Using Fedify CLI to tunnel
    fedify tunnel 5173
    ~~~~

2.  From your `activitypub.academy` account, search for and follow:

    ~~~~
    @demo@6c10b40c63d9e1ce7da55667ef0ef8b4.serveo.net
    ~~~~

3.  The application will automatically:
     -  Receive the follow request
     -  Send an Accept activity back
     -  Store the relationship

[`activitypub.academy`]: https://activitypub.academy

### 3. custom actor creation

To create additional actors, modify `src/lib/federation.ts`:

~~~~ typescript
// Add more identifiers
const IDENTIFIERS = ["demo", "alice", "bob"];

federation.setActorDispatcher(
  "/users/{identifier}",
  async (context, identifier) => {
    if (!IDENTIFIERS.includes(identifier)) {
      return null;
    }
    // ... actor creation logic
  },
);
~~~~

### 4. activity monitoring

The application logs activities to the console. Monitor the development console
to see:

 -  Incoming follow requests
 -  Outgoing accept activities
 -  Undo operations

### 5. custom activities

Extend the inbox listeners to handle additional ActivityPub activities:

~~~~ typescript
federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (context, follow) => {
    // Handle follow requests
  })
  .on(Undo, async (context, undo) => {
    // Handle undo operations
  })
  .on(Like, async (context, like) => {
    // Add custom like handling
  });
~~~~


🏗️ project structure
--------------------

~~~~
src/
├── app.css              # Global styles
├── app.d.ts             # TypeScript app declarations
├── app.html             # HTML template
├── hooks.server.ts      # Server-side hooks
├── lib/
│   ├── federation.ts    # Main federation configuration
│   ├── fetch.ts         # Fetch utilities
│   ├── handles.ts       # Request handlers
│   ├── index.ts         # Library exports
│   ├── store.ts         # In-memory data storage
│   ├── types.ts         # TypeScript type definitions
│   ├── assets/
│   │   └── favicon.svg  # Favicon asset
│   └── components/
│       ├── Profile.svelte  # Profile component
│       └── Spinner.svelte  # Loading spinner component
└── routes/
    ├── +layout.svelte   # Layout component
    ├── +page.server.ts  # Home page server logic
    ├── +page.svelte     # Home page
    └── users/
        └── [identifier]/
            ├── +page.server.ts  # User profile server logic
            ├── +page.svelte     # User profile page
            └── posts/
                ├── +page.server.ts  # User posts server logic
                ├── +page.svelte     # User posts page
                └── [id]/
                    ├── +page.server.ts  # Individual post server logic
                    └── +page.svelte     # Individual post page
~~~~


🚀 deployment
-------------

### Production build

~~~~ bash
pnpm build
~~~~

pnpm preview

1.  **HTTPS Required**: ActivityPub requires HTTPS in production
2.  **Domain Configuration**: Ensure proper domain setup for federation
3.  **Storage**: Replace `MemoryKvStore` with persistent storage
4.  **Environment Variables**: Configure production-specific settings

### Example deployment commands

~~~~ bash
# Build for production
pnpm build

# Preview the build
pnpm preview

# Or deploy to your preferred platform
# (Vercel, Netlify, Docker, etc.)
~~~~


🤝 contributing
---------------

This is a sample application demonstrating Fedify capabilities. Feel free to:

 -  Experiment with the code
 -  Add new features
 -  [Fedify GitHub Repository]
 -  Use as a starting point for your own federated applications

[Fedify GitHub Repository]: https://github.com/fedify-dev/fedify


📄 license
----------

This sample application follows the same license as the main Fedify project.


🔗 links
--------

 -  [Fedify Documentation]
 -  [SvelteKit Documentation]
 -  [ActivityPub Specification]
 -  [Fedify GitHub Repository]

[Fedify Documentation]: https://fedify.dev
[SvelteKit Documentation]: https://kit.svelte.dev/
[ActivityPub Specification]: https://www.w3.org/TR/activitypub/
