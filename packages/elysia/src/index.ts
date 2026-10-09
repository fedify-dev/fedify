import type { Federation } from "@fedify/fedify";
import type { Elysia } from "elysia";

export type ContextDataFactory<TContextData> = (
  req?: Request,
) => TContextData | Promise<TContextData>;

export const fedify = <TContextData = unknown>(
  federation: Federation<TContextData>,
  contextDataFactory: ContextDataFactory<TContextData>,
) => {
  const notAcceptableRequests = new WeakSet<Request>();
  return (app: Elysia) => {
    observeApplicationParents(app);
    return app
      .decorate("federation", federation)
      .onRequest(async ({ request, set, federation }) => {
        notAcceptableRequests.delete(request);
        let notFound = false;
        let notAcceptable = false;

        // Create context data using the factory or default to empty object
        const contextData = await contextDataFactory(request);

        const response = await federation.fetch(request, {
          contextData,
          onNotFound: () => {
            // Let Elysia handle non-federation routes
            notFound = true;
            return new Response("Not found", { status: 404 });
          },
          onNotAcceptable: () => {
            // Let Elysia handle when federation doesn't accept the request
            notAcceptable = true;
            notAcceptableRequests.add(request);
            return new Response("Not acceptable", {
              status: 406,
              headers: {
                "Content-Type": "text/plain",
                Vary: "Accept",
              },
            });
          },
        });

        if (!notFound && !notAcceptable) {
          set.status = response.status;

          // Return response body if it exists
          if (response.body) {
            return response;
          }

          response.headers.forEach((value, key) => {
            set.headers[key] = value;
          });

          // Return empty response for successful requests without body
          return new Response(null, { status: response.status });
        }

        // Continue to next handler if federation didn't handle the request
      })
      .onTransform(({ request }) => {
        // A matched route owns its response, including a deliberate 404.
        notAcceptableRequests.delete(request);
      })
      .onError(async function notAcceptableFallback(context) {
        const { request, code, set } = context;
        if (
          code !== "NOT_FOUND" || !notAcceptableRequests.has(request) ||
          context.route || context.error.message !== "NOT_FOUND"
        ) return;
        notAcceptableRequests.delete(request);
        // Elysia has no next() for error hooks. Let later application hooks
        // handle the request once before supplying our terminal fallback.
        // The context's store identifies the application handling this
        // request, even when the installation plugin has several parents.
        const activeApp = findApplication(app, context.store);
        const hooks = activeApp.event.error ?? [];
        const index = hooks.findIndex((hook) =>
          hook.fn === notAcceptableFallback
        );
        for (const hook of index < 0 ? [] : hooks.slice(index + 1)) {
          const response = await hook.fn(context);
          if (
            activeApp.config.aot === false
              ? response != null
              : response !== undefined
          ) {
            return response;
          }
        }
        const vary: string[] = [];
        for (const header of Object.keys(set.headers)) {
          const name = header.toLowerCase();
          if (name === "vary") {
            vary.push(...String(set.headers[header]).split(","));
          }
          if (
            [
              "content-type",
              "vary",
              "content-encoding",
              "content-language",
              "content-range",
              "content-length",
              "etag",
              "last-modified",
              "transfer-encoding",
            ].includes(name)
          ) delete set.headers[header];
        }
        const fields = vary.map((field) => field.trim()).filter(Boolean);
        if (
          !fields.some((field) =>
            field === "*" || field.toLowerCase() === "accept"
          )
        ) {
          fields.push("Accept");
        }
        set.status = 406;
        // Return a Response: Elysia 1.3.8's AOT error mapper can fail for a
        // string result when application mapResponse hooks are installed.
        return new Response("Not acceptable", {
          status: 406,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            Vary: fields.join(", "),
          },
        });
      })
      .as("global");
  };
};

// Elysia links plugin instances to their parent through a private getParent
// assignment. Observe these links without changing its getter behavior. Weak
// references keep a reusable plugin from retaining discarded applications.
const applicationParents = new WeakMap<Elysia, Set<WeakRef<Elysia>>>();

function observeApplicationParents(app: Elysia): void {
  if (applicationParents.has(app)) return;
  const parents = new Set<WeakRef<Elysia>>();
  applicationParents.set(app, parents);
  let getParent = (app as unknown as {
    getParent?: () => Elysia | null;
  }).getParent;
  const rememberParent = (): void => {
    const parent = getParent?.call(app);
    if (parent == null || parent === app) return;
    for (const reference of parents) {
      const value = reference.deref();
      if (value === parent) return;
      if (value == null) parents.delete(reference);
    }
    parents.add(new WeakRef(parent));
    observeApplicationParents(parent);
  };
  rememberParent();
  Object.defineProperty(app, "getParent", {
    configurable: true,
    enumerable: true,
    get: () => getParent,
    set: (value: typeof getParent) => {
      getParent = value;
      rememberParent();
    },
  });
}

function findApplication(app: Elysia, store: object): Elysia {
  const pending = [app];
  const visited = new Set<Elysia>();
  while (pending.length > 0) {
    const candidate = pending.pop()!;
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    if (candidate.singleton.store === store) return candidate;
    const parents = applicationParents.get(candidate);
    for (const reference of parents ?? []) {
      const parent = reference.deref();
      if (parent == null) parents?.delete(reference);
      else pending.push(parent);
    }
  }
  return app;
}
