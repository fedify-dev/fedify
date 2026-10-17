import { Activity } from "@fedify/vocab";

type ActivityConstructor<TActivity extends Activity = Activity> =
  // deno-lint-ignore no-explicit-any
  new (...args: any[]) => TActivity;

type ActivityListener<TContext, TActivity extends Activity = Activity> = (
  context: TContext,
  activity: TActivity,
) => void | Promise<void>;

/**
 * Options for an inbox listener.
 * @since 2.5.0
 */
export interface InboxListenerOptions {
  /**
   * Whether activities that declare no `actor` at all may reach the listener.
   *
   * Some protocols identify the requester without an `actor`; for example,
   * Mastodon sends [FEP-7aa9] `FeatureRequest` activities without one.  When
   * this is `true`, such an activity is dispatched to the listener if Fedify
   * authenticated at least one principal for it, i.e., the signer of its
   * Object Integrity Proofs or Linked Data Signature, or otherwise the signer
   * of the HTTP request, and its `id`, if any, has the same origin as that
   * principal.  The listener is then responsible for authorizing the request
   * with {@link InboxContext.authentication}, e.g., with
   * `featureInteraction.verifyRequest()` from
   * `@fedify/interaction-controls`.
   *
   * An activity that declares an `actor` is never affected by this option;
   * its actor must be authenticated as usual.
   *
   * [FEP-7aa9]: https://w3id.org/fep/7aa9
   * @default `false`
   */
  readonly allowActorless?: boolean;
}

interface ListenerEntry<TContext> {
  readonly listener: ActivityListener<TContext>;
  readonly options: InboxListenerOptions;
}

export class ActivityListenerSet<TContext> {
  #listeners: Map<ActivityConstructor, ListenerEntry<TContext>>;

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
    options: InboxListenerOptions = {},
  ): void {
    if (this.#listeners.has(type)) {
      throw new TypeError("Listener already set for this type.");
    }
    this.#listeners.set(type, {
      listener: listener as ActivityListener<TContext>,
      options: { ...options },
    });
  }

  dispatchWithClass<TActivity extends Activity>(
    activity: TActivity,
  ): {
    class: ActivityConstructor;
    listener: ActivityListener<TContext, TActivity>;
    options: InboxListenerOptions;
  } | null {
    let cls: ActivityConstructor = activity.constructor as ActivityConstructor;
    while (cls != null) {
      if (this.#listeners.has(cls)) break;
      if (cls === Activity) return null;
      cls = globalThis.Object.getPrototypeOf(cls);
    }
    if (cls == null) return null;
    const { listener, options } = this.#listeners.get(cls)!;
    return { class: cls, listener, options };
  }

  dispatch<TActivity extends Activity>(
    activity: TActivity,
  ): ActivityListener<TContext, TActivity> | null {
    return this.dispatchWithClass(activity)?.listener ?? null;
  }
}
