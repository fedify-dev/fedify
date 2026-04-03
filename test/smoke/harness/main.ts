import { federation } from "./federation.ts";
import { handleBackdoor } from "./backdoor.ts";

const PORT = parseInt(Deno.env.get("HARNESS_PORT") ?? "3001");

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (request: Request) => {
  const url = new URL(request.url);

  // Backdoor test-control routes
  if (url.pathname.startsWith("/_test/")) {
    return await handleBackdoor(request, federation);
  }

  // Federation routes (actor, inbox, webfinger, etc.)
  return await federation.fetch(request, {
    contextData: undefined,
    onNotFound: () => new Response("Not Found", { status: 404 }),
    onNotAcceptable: () => new Response("Not Acceptable", { status: 406 }),
  });
});
