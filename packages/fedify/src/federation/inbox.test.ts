import { test } from "@fedify/fixture";
import { Activity, Create, Invite, Offer, Update } from "@fedify/vocab";
import { parseIri } from "@fedify/vocab-runtime";
import { assertEquals } from "@std/assert/assert-equals";
import { assertFalse } from "@std/assert/assert-false";
import { assertThrows } from "@std/assert/assert-throws";
import type { InboxContext } from "./context.ts";
import { ActivityListenerSet } from "./activity-listener.ts";
import { actorsHaveSameOrigin } from "./inbox.ts";

test("actorsHaveSameOrigin()", () => {
  assertEquals(
    actorsHaveSameOrigin(
      new Create({ actor: new URL("https://remote.example/actor") }),
    ),
    true,
  );
  assertEquals(
    actorsHaveSameOrigin(
      new Create({
        id: new URL("https://remote.example/activity"),
        actors: [
          new URL("https://remote.example/actor/1"),
          new URL("https://remote.example:443/actor/2"),
        ],
      }),
    ),
    true,
  );

  for (
    const actor of [
      "http://remote.example/actor",
      "https://sub.remote.example/actor",
      "https://remote.example:8443/actor",
    ]
  ) {
    assertFalse(
      actorsHaveSameOrigin(
        new Create({
          id: new URL("https://remote.example/activity"),
          actor: new URL(actor),
        }),
      ),
    );
  }
  assertFalse(
    actorsHaveSameOrigin(
      new Create({
        id: new URL("urn:example:activity"),
        actor: new URL("urn:example:actor"),
      }),
    ),
  );
  assertFalse(
    actorsHaveSameOrigin(
      new Create({
        id: new URL("https://remote.example/activity"),
        actors: [
          new URL("https://remote.example/actor/1"),
          new URL("https://other.example/actor/2"),
        ],
      }),
    ),
  );
});

test("actorsHaveSameOrigin() compares portable IDs by their DIDs", () => {
  const did = "did:key:z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2";
  const otherDid = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
  const activityId = parseIri(`ap+ef61://${did}/activities/1`);
  for (
    const actor of [
      `ap+ef61://${did}/actor`,
      `https://gw.example/.well-known/apgateway/${did}/actor`,
    ]
  ) {
    assertEquals(
      actorsHaveSameOrigin(
        new Create({ id: activityId, actor: parseIri(actor) }),
      ),
      true,
    );
  }
  for (
    const actor of [
      `ap+ef61://${otherDid}/actor`,
      `https://gw.example/.well-known/apgateway/${otherDid}/actor`,
      "https://gw.example/actor",
    ]
  ) {
    assertFalse(
      actorsHaveSameOrigin(
        new Create({ id: activityId, actor: parseIri(actor) }),
      ),
    );
  }
});

test("ActivityListenerSet", () => {
  const listeners = new ActivityListenerSet<InboxContext<void>>();
  const activity = new Activity({});
  const offer = new Offer({});
  const invite = new Invite({});
  const create = new Create({});
  const update = new Update({});

  assertEquals(listeners.dispatch(activity), null);
  assertEquals(listeners.dispatch(offer), null);
  assertEquals(listeners.dispatch(invite), null);
  assertEquals(listeners.dispatch(create), null);
  assertEquals(listeners.dispatch(update), null);

  const listenOffer = () => {};
  listeners.add(Offer, listenOffer);
  assertEquals(listeners.dispatch(activity), null);
  assertEquals(
    listeners.dispatchWithClass(offer),
    { class: Offer, listener: listenOffer },
  );
  assertEquals(listeners.dispatch(offer), listenOffer);
  assertEquals(
    listeners.dispatchWithClass(invite),
    { class: Offer, listener: listenOffer },
  );
  assertEquals(listeners.dispatch(invite), listenOffer);
  assertEquals(listeners.dispatch(create), null);
  assertEquals(listeners.dispatch(update), null);

  const listenCreate = () => {};
  listeners.add(Create, listenCreate);
  assertEquals(listeners.dispatch(activity), null);
  assertEquals(listeners.dispatch(offer), listenOffer);
  assertEquals(
    listeners.dispatchWithClass(offer),
    { class: Offer, listener: listenOffer },
  );
  assertEquals(listeners.dispatch(invite), listenOffer);
  assertEquals(
    listeners.dispatchWithClass(invite),
    { class: Offer, listener: listenOffer },
  );
  assertEquals(listeners.dispatch(create), listenCreate);
  assertEquals(
    listeners.dispatchWithClass(create),
    { class: Create, listener: listenCreate },
  );
  assertEquals(listeners.dispatch(update), null);

  const listenActivity = () => {};
  listeners.add(Activity, listenActivity);
  assertEquals(listeners.dispatch(activity), listenActivity);
  assertEquals(
    listeners.dispatchWithClass(activity),
    { class: Activity, listener: listenActivity },
  );
  assertEquals(listeners.dispatch(offer), listenOffer);
  assertEquals(
    listeners.dispatchWithClass(offer),
    { class: Offer, listener: listenOffer },
  );
  assertEquals(listeners.dispatch(invite), listenOffer);
  assertEquals(
    listeners.dispatchWithClass(invite),
    { class: Offer, listener: listenOffer },
  );
  assertEquals(listeners.dispatch(create), listenCreate);
  assertEquals(
    listeners.dispatchWithClass(create),
    { class: Create, listener: listenCreate },
  );
  assertEquals(listeners.dispatch(update), listenActivity);
  assertEquals(
    listeners.dispatchWithClass(update),
    { class: Activity, listener: listenActivity },
  );

  assertThrows(
    () => listeners.add(Activity, listenActivity),
    TypeError,
    "Listener already set for this type.",
  );
});
