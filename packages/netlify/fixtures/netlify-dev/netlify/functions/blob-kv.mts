import { createServices } from "../lib/runtime.ts";

interface BlobKvBody {
  readonly action?: unknown;
  readonly expectedValue?: unknown;
  readonly id?: unknown;
  readonly newValue?: unknown;
  readonly value?: unknown;
}

export default async function blobKv(request: Request): Promise<Response> {
  const body = await request.json() as BlobKvBody;
  if (
    typeof body.id !== "string" || body.id.length < 1 ||
    typeof body.action !== "string"
  ) {
    return new Response("Invalid payload.", { status: 400 });
  }

  const { kv } = createServices();
  const key = ["integration", "blob-kv", body.id] as const;
  switch (body.action) {
    case "set":
      if (!("value" in body)) {
        return new Response("Missing value.", { status: 400 });
      }
      await kv.set(key, body.value);
      return Response.json({ written: true });
    case "get": {
      const value = await kv.get(key);
      return value === undefined
        ? Response.json({ found: false })
        : Response.json({ found: true, value });
    }
    case "delete":
      await kv.delete(key);
      return Response.json({ deleted: true });
    case "cas":
      if (kv.cas == null) {
        return new Response("CAS is unavailable.", { status: 500 });
      }
      return Response.json({
        swapped: await kv.cas(key, body.expectedValue, body.newValue),
      });
    default:
      return new Response("Invalid action.", { status: 400 });
  }
}
