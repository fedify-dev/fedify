import { fedifyHook } from "@fedify/sveltekit";
import { sequence } from "@sveltejs/kit/hooks";
import federation from "$lib/federation";
import { replaceHost } from "$lib/handles";

export const handle = sequence(
  replaceHost,
  fedifyHook(federation),
);
