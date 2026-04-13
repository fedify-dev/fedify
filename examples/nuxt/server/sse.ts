type EventClient = {
  send: (data: string) => void;
  close: () => void;
};

const clients = new Set<EventClient>();

export function addClient(client: EventClient): void {
  clients.add(client);
}

export function removeClient(client: EventClient): void {
  clients.delete(client);
}

export function broadcastEvent(): void {
  const data = JSON.stringify({ type: "update" });
  for (const client of clients) {
    client.send(data);
  }
}
