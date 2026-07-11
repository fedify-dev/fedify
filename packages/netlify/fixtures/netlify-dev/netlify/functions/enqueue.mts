import { createServices, createTaskFederation } from "../lib/runtime.ts";

interface EnqueueBody {
  readonly id?: unknown;
  readonly value?: unknown;
  readonly failures?: unknown;
  readonly hold?: unknown;
  readonly orderingKey?: unknown;
}

export default async function enqueue(request: Request): Promise<Response> {
  const body = await request.json() as EnqueueBody;
  if (
    typeof body.id !== "string" || typeof body.value !== "string" ||
    (body.failures !== undefined &&
      (!Number.isInteger(body.failures) || (body.failures as number) < 0)) ||
    (body.hold !== undefined &&
      (!Number.isInteger(body.hold) || (body.hold as number) < 0)) ||
    (body.orderingKey !== undefined &&
      (typeof body.orderingKey !== "string" || body.orderingKey.length < 1))
  ) {
    return new Response("Invalid payload.", { status: 400 });
  }

  const { kv, queue } = createServices();
  await Promise.all([
    kv.delete(["integration", body.id, "attempts"]),
    kv.delete(["integration", body.id, "completed"]),
    kv.delete(["integration", body.id, "overlapped"]),
  ]);
  const { federation, task } = createTaskFederation(kv, queue);
  const context = federation.createContext(new URL(request.url), {
    eventId: "producer",
    kv,
  });
  await context.enqueueTask(task, {
    id: body.id,
    value: body.value,
    failures: body.failures as number | undefined ?? 0,
    hold: body.hold as number | undefined ?? 0,
    orderingKey: body.orderingKey as string | undefined,
  }, { orderingKey: body.orderingKey as string | undefined });
  return new Response(null, { status: 202 });
}
