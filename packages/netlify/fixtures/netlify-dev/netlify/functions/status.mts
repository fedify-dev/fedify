import { createServices } from "../lib/runtime.ts";

export default async function status(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (id == null || id.length < 1) {
    return new Response("Missing id.", { status: 400 });
  }
  const { kv } = createServices();
  const [attempts, completed, overlapped] = await Promise.all([
    kv.get<number>(["integration", id, "attempts"]),
    kv.get<{ value: string; eventId: string; position?: number }>([
      "integration",
      id,
      "completed",
    ]),
    kv.get<boolean>(["integration", id, "overlapped"]),
  ]);
  return Response.json({ attempts: attempts ?? 0, completed, overlapped });
}
