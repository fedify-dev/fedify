import { test } from "@fedify/fixture";
import { Activity, Create, Invite, Offer, Update } from "@fedify/vocab";
import { assertEquals } from "@std/assert/assert-equals";
import { assertThrows } from "@std/assert/assert-throws";
import { InboxListenerSet } from "./inbox.ts";

test("InboxListenerSet", () => {
  const listeners = new InboxListenerSet<void>();
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
