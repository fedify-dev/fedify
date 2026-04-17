import { Activity } from "@fedify/vocab";
import type { OutboxListener } from "./callback.ts";

export class OutboxListenerSet<TContextData> {
  #listeners: Map<
    new (...args: unknown[]) => Activity,
    OutboxListener<TContextData, Activity>
  >;

  constructor() {
    this.#listeners = new Map();
  }

  clone(): OutboxListenerSet<TContextData> {
    const clone = new OutboxListenerSet<TContextData>();
    clone.#listeners = new Map(this.#listeners);
    return clone;
  }

  add<TActivity extends Activity>(
    // deno-lint-ignore no-explicit-any
    type: new (...args: any[]) => TActivity,
    listener: OutboxListener<TContextData, TActivity>,
  ): void {
    if (this.#listeners.has(type)) {
      throw new TypeError("Listener already set for this type.");
    }
    this.#listeners.set(
      type,
      listener as OutboxListener<TContextData, Activity>,
    );
  }

  dispatchWithClass<TActivity extends Activity>(
    activity: TActivity,
  ): {
    // deno-lint-ignore no-explicit-any
    class: new (...args: any[]) => Activity;
    listener: OutboxListener<TContextData, TActivity>;
  } | null {
    // deno-lint-ignore no-explicit-any
    let cls: new (...args: any[]) => Activity = activity
      // deno-lint-ignore no-explicit-any
      .constructor as unknown as new (...args: any[]) => Activity;
    while (true) {
      if (this.#listeners.has(cls)) break;
      if (cls === Activity) return null;
      cls = globalThis.Object.getPrototypeOf(cls);
    }
    const listener = this.#listeners.get(cls)!;
    return { class: cls, listener };
  }

  dispatch<TActivity extends Activity>(
    activity: TActivity,
  ): OutboxListener<TContextData, TActivity> | null {
    return this.dispatchWithClass(activity)?.listener ?? null;
  }
}
