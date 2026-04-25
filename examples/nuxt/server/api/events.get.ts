import { addClient, removeClient } from "../sse";

export default defineEventHandler((event) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const client = {
        send(data: string) {
          try {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch {
            removeClient(client);
          }
        },
        close() {
          controller.close();
        },
      };

      addClient(client);

      event.node.req.on("close", () => {
        removeClient(client);
        client.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
