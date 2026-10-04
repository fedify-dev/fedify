import { fedifyHook } from "@fedify/sveltekit";
import { sequence } from "@sveltejs/kit/hooks";
import federation from "#lib/federation";

export const handle = sequence(
  fedifyHook(federation),
);
