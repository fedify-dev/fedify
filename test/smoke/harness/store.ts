export interface ReceivedActivity {
  id: string;
  type: string;
  receivedAt: string;
}

const inbox: ReceivedActivity[] = [];

export const store = {
  push(a: ReceivedActivity): void {
    inbox.push(a);
  },
  latest(): ReceivedActivity | null {
    return inbox.at(-1) ?? null;
  },
  all(): ReceivedActivity[] {
    return [...inbox];
  },
  clear(): void {
    inbox.splice(0);
  },
};
