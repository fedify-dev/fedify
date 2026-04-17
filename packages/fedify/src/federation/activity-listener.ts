import { Activity } from "@fedify/vocab";

type ActivityConstructor<TActivity extends Activity = Activity> =
  // deno-lint-ignore no-explicit-any
  new (...args: any[]) => TActivity;

type ActivityListener<TContext, TActivity extends Activity = Activity> = (
  context: TContext,
  activity: TActivity,
) => void | Promise<void>;

export class ActivityListenerSet<TContext> {
  #listeners: Map<ActivityConstructor, ActivityListener<TContext>>;

  constructor() {
    this.#listeners = new Map();
  }

  clone(): this {
    const Clone = this.constructor as new () => this;
    const clone = new Clone();
    clone.#listeners = new Map(this.#listeners);
    return clone;
  }

  add<TActivity extends Activity>(
    type: ActivityConstructor<TActivity>,
    listener: ActivityListener<TContext, TActivity>,
  ): void {
    if (this.#listeners.has(type)) {
      throw new TypeError("Listener already set for this type.");
    }
    this.#listeners.set(type, listener as ActivityListener<TContext>);
  }

  dispatchWithClass<TActivity extends Activity>(
    activity: TActivity,
  ): {
    class: ActivityConstructor;
    listener: ActivityListener<TContext, TActivity>;
  } | null {
    let cls: ActivityConstructor = activity.constructor as ActivityConstructor;
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
  ): ActivityListener<TContext, TActivity> | null {
    return this.dispatchWithClass(activity)?.listener ?? null;
  }
}
