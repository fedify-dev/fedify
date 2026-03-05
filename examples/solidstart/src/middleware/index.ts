import { createMiddleware } from "@solidjs/start/middleware";
import federation from "../lib/federation";

export default createMiddleware({
  onRequest: async (event) => {
    const response = await federation.fetch(event.request, {
      contextData: undefined,
      onNotFound: async () => {
        return new Response("Not Found", { status: 404 });
      },
      onNotAcceptable: async () => {
        return new Response("Not Acceptable", {
          status: 406,
          headers: { "Content-Type": "text/plain", Vary: "Accept" },
        });
      },
    });

    // If Fedify doesn't have this route, let SolidStart handle it:
    if (response.status === 404) return;

    // If content negotiation failed (client doesn't want JSON-LD),
    // store the 406 response and let SolidStart try to serve HTML.
    // If SolidStart also can't handle it, onBeforeResponse will
    // return the 406:
    if (response.status === 406) {
      event.locals.__fedifyNotAcceptable = response;
      return;
    }

    // Fedify handled the request successfully:
    return response;
  },
  onBeforeResponse: (event) => {
    // Content negotiation: if Fedify had a 406 and SolidStart's response
    // is a 404 (no page for this route), return the stored 406 instead:
    const status = event.response.status ?? 200;
    if (event.locals.__fedifyNotAcceptable != null && status === 404) {
      return event.locals.__fedifyNotAcceptable;
    }
  },
});
