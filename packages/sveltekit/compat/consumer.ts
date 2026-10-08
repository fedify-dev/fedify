import type { Federation } from "@fedify/fedify/federation";
import { fedifyHook } from "@fedify/sveltekit";
import { sequence } from "@sveltejs/kit/hooks";

declare const federation: Federation<{ request: Request }>;

// sequence accepts Handle in both major versions, even though the named type
// is exported from different modules.  Check the consumer's hook assignment,
// context callback, and composition without skipping library declarations.
const hook: ReturnType<typeof sequence> = fedifyHook(
  federation,
  (event) => ({ request: event.request }),
);
const asyncHook: ReturnType<typeof sequence> = fedifyHook(
  federation,
  (event) => Promise.resolve({ request: event.request }),
);
const composed: ReturnType<typeof sequence> = sequence(hook, asyncHook);
void composed;
