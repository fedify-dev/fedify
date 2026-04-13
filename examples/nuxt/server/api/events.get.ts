import { setResponseHeader } from "h3";
import { addClient, removeClient } from "../sse";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Content-Type", "text/event-stream");
  setResponseHeader(event, "Cache-Control", "no-cache");
  setResponseHeader(event, "Connection", "keep-alive");

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const client = {
        send(data: string) {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        },
        close() {
          controller.close();
        },
      };

      addClient(client);

      event.node.req.on("close", () => {
        removeClient(client);
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
