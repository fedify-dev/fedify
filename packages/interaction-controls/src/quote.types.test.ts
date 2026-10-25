import type { Context } from "@fedify/fedify";
import type { QuoteRequest } from "@fedify/vocab";
import {
  type InteractionRequestVerificationOptions,
  quoteInteraction,
} from "./mod.ts";

// These consumer fixtures are checked by Deno.  Node.js and Bun strip the
// types without checking them; no runtime calls are needed here.
export function quoteRequestInputTypes(
  context: Context<void>,
  oldOptions: InteractionRequestVerificationOptions<QuoteRequest>,
): void {
  void quoteInteraction.verifyRequest(context, oldOptions);
  void quoteInteraction.verifyRequest(context, {
    ...oldOptions,
    quoteReference: "strict",
  });
  void quoteInteraction.verifyRequest(context, {
    ...oldOptions,
    quoteReference: "prefer-quote",
  });
  void quoteInteraction.verifyRequest(context, {
    ...oldOptions,
    quoteReference: "any",
  });
  void quoteInteraction.verifyRequest(context, {
    ...oldOptions,
    // @ts-expect-error This spelling was never released and has no input alias.
    quoteReference: "preferQuote",
  });
}
