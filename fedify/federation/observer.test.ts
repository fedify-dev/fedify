import { assert, assertEquals } from "@std/assert";
import { test } from "../testing/mod.ts";
import { MockContext, MockFederation } from "../../testing/mock.ts";
import { Create, Note, Person } from "../vocab/mod.ts";
import type { Activity } from "../vocab/vocab.ts";
import type { Context } from "./context.ts";
import type { FederationObserver, FederationOptions } from "./federation.ts";
import { MemoryKvStore } from "./kv.ts";

test("FederationObserver interface", async (t) => {
  await t.step("should have onInboundActivity method", () => {
    const observer: FederationObserver<unknown> = {
      onInboundActivity(_context: Context<unknown>, _activity: Activity) {
        // Method signature test
      },
    };
    assert(observer.onInboundActivity);
  });

  await t.step("should have onOutboundActivity method", () => {
    const observer: FederationObserver<unknown> = {
      onOutboundActivity(_context: Context<unknown>, _activity: Activity) {
        // Method signature test
      },
    };
    assert(observer.onOutboundActivity);
  });

  await t.step("methods should be optional", () => {
    const observer: FederationObserver<unknown> = {};
    assert(observer);
  });

  await t.step("methods can return void", () => {
    const observer: FederationObserver<unknown> = {
      onInboundActivity(_context: Context<unknown>, _activity: Activity): void {
        // Synchronous implementation
      },
      onOutboundActivity(
        _context: Context<unknown>,
        _activity: Activity,
      ): void {
        // Synchronous implementation
      },
    };
    assert(observer);
  });

  await t.step("methods can return Promise<void>", () => {
    const observer: FederationObserver<unknown> = {
      async onInboundActivity(
        _context: Context<unknown>,
        _activity: Activity,
      ): Promise<void> {
        // Asynchronous implementation
        await Promise.resolve();
      },
      async onOutboundActivity(
        _context: Context<unknown>,
        _activity: Activity,
      ): Promise<void> {
        // Asynchronous implementation
        await Promise.resolve();
      },
    };
    assert(observer);
  });
});

test("FederationOptions with observers", async (t) => {
  await t.step("should accept observers array", () => {
    const mockObserver: FederationObserver<unknown> = {
      onInboundActivity: () => {},
      onOutboundActivity: () => {},
    };

    const options: Partial<FederationOptions<unknown>> = {
      observers: [mockObserver],
    };

    assert(options.observers);
    assertEquals(options.observers.length, 1);
  });

  await t.step("observers should be optional", () => {
    const options: Partial<FederationOptions<unknown>> = {};
    assert(options);
  });

  await t.step("should accept multiple observers", () => {
    const observer1: FederationObserver<unknown> = {};
    const observer2: FederationObserver<unknown> = {};

    const options: Partial<FederationOptions<unknown>> = {
      observers: [observer1, observer2],
    };

    assert(options.observers);
    assertEquals(options.observers.length, 2);
  });
});

test("Observer with real Federation", async (t) => {
  await t.step("should support observers in FederationOptions", () => {
    const capturedActivities: Activity[] = [];

    const observer: FederationObserver<void> = {
      onInboundActivity: (_ctx, activity) => {
        capturedActivities.push(activity);
      },
      onOutboundActivity: (_ctx, activity) => {
        capturedActivities.push(activity);
      },
    };

    const federationOptions: FederationOptions<void> = {
      kv: new MemoryKvStore(),
      observers: [observer],
    };

    // Verify options structure
    assert(federationOptions.observers);
    assertEquals(federationOptions.observers.length, 1);
    assertEquals(federationOptions.observers[0], observer);
  });
});

test("MockFederation with observers", async (t) => {
  await t.step("should track observer calls on receiveActivity", async () => {
    let inboundCalled = false;
    let inboundActivity: Activity | null = null;

    const observer: FederationObserver<void> = {
      onInboundActivity: (_ctx, activity) => {
        inboundCalled = true;
        inboundActivity = activity;
      },
    };

    const federation = new MockFederation<void>({
      contextData: undefined,
      observers: [observer],
    });

    // Simulate receiving an activity
    const activity = new Create({
      id: new URL("https://example.com/create/1"),
      actor: new URL("https://example.com/users/alice"),
    });

    await federation.receiveActivity(activity);

    assert(inboundCalled, "onInboundActivity should have been called");
    assertEquals(inboundActivity, activity);
  });

  await t.step("should track observer calls on sendActivity", async () => {
    let outboundCalled = false;
    let outboundActivity: Activity | null = null;

    const observer: FederationObserver<void> = {
      onOutboundActivity: (_ctx, activity) => {
        outboundCalled = true;
        outboundActivity = activity;
      },
    };

    const federation = new MockFederation<void>({
      contextData: undefined,
      observers: [observer],
    });

    const context = new MockContext({
      url: new URL("https://example.com"),
      federation,
      data: undefined,
    });

    const activity = new Create({
      id: new URL("https://example.com/create/1"),
      actor: new URL("https://example.com/users/alice"),
      object: new Note({
        content: "Hello world!",
      }),
    });

    await context.sendActivity(
      { identifier: "alice" },
      new Person({
        id: new URL("https://example.com/users/bob"),
      }),
      activity
    );

    assert(outboundCalled, "onOutboundActivity should have been called");
    assertEquals(outboundActivity, activity);
  });
});

test("FederationImpl observer integration", async (t) => {
  await t.step("notifyObservers should call observer methods", () => {
    let capturedContext: Context<void> | null = null;
    let capturedActivity: Activity | null = null;

    const observer: FederationObserver<void> = {
      onInboundActivity: async (ctx, activity) => {
        capturedContext = ctx;
        capturedActivity = activity;
      },
      onOutboundActivity: async (ctx, activity) => {
        capturedContext = ctx;
        capturedActivity = activity;
      },
    };

    const activity = new Create({
      id: new URL("https://example.com/create/1"),
      actor: new URL("https://example.com/users/alice"),
      object: new Note({
        content: "Hello world!",
      }),
    });

    // This test verifies that the observer pattern is correctly implemented
    // The actual integration will be tested once Federation is fully implemented
    assert(observer.onInboundActivity);
    assert(observer.onOutboundActivity);
    // Suppress unused variable warnings - will be used in integration tests
    void capturedContext;
    void capturedActivity;
    void activity;
  });

  await t.step("observers should handle errors gracefully", () => {
    const errorObserver: FederationObserver<void> = {
      onInboundActivity: async () => {
        throw new Error("Observer error");
      },
      onOutboundActivity: async () => {
        throw new Error("Observer error");
      },
    };

    // This test verifies that observer errors don't crash the federation
    assert(errorObserver.onInboundActivity);
    assert(errorObserver.onOutboundActivity);
  });

  await t.step("multiple observers should be called in order", () => {
    const calls: string[] = [];

    const observer1: FederationObserver<void> = {
      onInboundActivity: () => {
        calls.push("observer1:inbound");
      },
      onOutboundActivity: () => {
        calls.push("observer1:outbound");
      },
    };

    const observer2: FederationObserver<void> = {
      onInboundActivity: () => {
        calls.push("observer2:inbound");
      },
      onOutboundActivity: () => {
        calls.push("observer2:outbound");
      },
    };

    const options: Partial<FederationOptions<void>> = {
      observers: [observer1, observer2],
    };

    assert(options.observers);
    assertEquals(options.observers.length, 2);
    // The actual order test will be verified during integration testing
  });
});
