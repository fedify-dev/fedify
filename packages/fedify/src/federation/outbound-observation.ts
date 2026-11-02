import { getLogger } from "@logtape/logtape";
import type { Context } from "./context.ts";
import type { OutboundObservers } from "./outbound-report.ts";

/** Observe entry without changing the unobserved send's execution path. */
export function observeOutboundBroadcastStart<TContextData>(
  context: Context<TContextData>,
  observer: OutboundObservers<TContextData>["onBroadcast"],
  send: () => Promise<void>,
): Promise<void> {
  if (observer == null) return send();
  return notify().then(send);

  async function notify(): Promise<void> {
    const event = Object.freeze({
      broadcastId: crypto.randomUUID(),
      operation: "send" as const,
      stage: "started" as const,
    });
    try {
      await observer!(context, event);
    } catch (error) {
      try {
        getLogger(["fedify", "federation", "outbox"]).error(
          "An unexpected error occurred in outbound broadcast observer:\n{error}",
          { error },
        );
      } catch {
        // A logging sink must not replace the send's result either.
      }
    }
  }
}
