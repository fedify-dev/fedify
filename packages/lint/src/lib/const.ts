export const FEDERATION_SETUP = `
import {
  createFederation,
  MemoryKvStore,
  InProcessMessageQueue,
} from "@fedify/fedify";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});
` as const;
