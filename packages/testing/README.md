<!-- deno-fmt-ignore-file -->

@fedify/testing
===============

Testing utilities for Fedify applications.

This package provides mock implementations of the `Federation` and `Context`
interfaces to facilitate unit testing of federated applications built with
Fedify.


Installation
------------

~~~~ bash
deno add @fedify/testing
~~~~

~~~~ bash
npm install @fedify/testing
~~~~

~~~~ bash
pnpm add @fedify/testing
~~~~

~~~~ bash
yarn add @fedify/testing
~~~~


Usage
-----

### `MockFederation`

The `MockFederation` class provides a mock implementation of the `Federation`
interface for unit testing:

~~~~ typescript
import { MockFederation } from "@fedify/testing";
import { Create } from "@fedify/vocab";

// Create a mock federation
const federation = new MockFederation<{ userId: string }>();

// Set up inbox listeners
federation
  .setInboxListeners("/users/{identifier}/inbox")
  .on(Create, async (ctx, activity) => {
    console.log("Received:", activity);
  });

// Simulate receiving an activity
await federation.receiveActivity(createActivity);

// Check sent activities
const sent = federation.sentActivities;
console.log(sent[0].activity);
~~~~

### `MockContext`

The `MockContext` class provides a mock implementation of the `Context`
interface:

~~~~ typescript
import { MockContext } from "@fedify/testing";

// Create a mock context
const context = new MockContext({
  url: new URL("https://example.com"),
  data: { userId: "test-user" },
  federation: mockFederation
});

// Send an activity
await context.sendActivity(
  { identifier: "alice" },
  recipient,
  activity
);

// Check sent activities
const sent = context.getSentActivities();
console.log(sent[0].activity);
~~~~

### Helper functions

The package also exports helper functions for creating various context types:

 -  `createContext()`: Creates a basic context
 -  `createRequestContext()`: Creates a request context
 -  `createInboxContext()`: Creates an inbox context

## Features

- Track sent activities with metadata
- Simulate activity reception
- Configure custom URI templates
- Test queue-based activity processing
- Mock document loaders and context loaders
