import { defineEventHandler } from "h3";
import federation from "../federation";

export default defineEventHandler(async (event) => {
  // Construct the full URL from headers
  const proto = event.headers.get("x-forwarded-proto") || "http";
  const host = event.headers.get("host") || "localhost";
  const url = new URL(event.node.req.url || "", `${proto}://${host}`);

  const request = new Request(url, {
    method: event.node.req.method,
    headers: event.node.req.headers as Record<string, string>,
    body: ["GET", "HEAD", "DELETE"].includes(event.node.req.method)
      ? undefined
      : undefined,
  });

  const response = await federation.fetch(request, {
    contextData: undefined,
  });

  if (response.status === 404) return; // Let Nuxt handle 404
  return response;
});
