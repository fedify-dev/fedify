import type { Rule } from "eslint";
import { VOCAB_CLONE_VERIFIER_MESSAGES } from "../lib/messages.ts";
import {
  checkVocabClones,
  type VocabCloneOptions,
} from "../lib/vocab-clone.ts";

/**
 * Deno Lint adapter.  It is not registered in the Deno plugin, since Deno
 * enables every rule of a plugin and reports them all as errors, but it can be
 * wired up by hand.  Deno has no suggestion API, so it only reports.
 */
export const deno: Deno.lint.Rule = {
  create(context) {
    return {
      Program(node) {
        checkVocabClones(node, {}, ({ node, rechained }) => {
          context.report({
            node: node as Deno.lint.Node,
            message: rechained
              ? VOCAB_CLONE_VERIFIER_MESSAGES.dropsVerifierRechained
              : VOCAB_CLONE_VERIFIER_MESSAGES.dropsVerifier,
          });
        });
      },
    };
  },
};

/** ESLint and Oxlint adapter, with optional generated vocabulary modules. */
export const eslint: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn when a clone of a vocabulary object, which does not inherit its default portable-object verifier, is dereferenced without one",
    },
    hasSuggestions: true,
    messages: VOCAB_CLONE_VERIFIER_MESSAGES,
    schema: [
      {
        type: "object",
        properties: { modules: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options: VocabCloneOptions = context.options[0] ?? {};
    return {
      Program(node) {
        checkVocabClones(node, options, (diagnostic) => {
          const { node, rechained, suggestionNode } = diagnostic;
          context.report({
            node: node as Rule.Node,
            messageId: rechained ? "dropsVerifierRechained" : "dropsVerifier",
            suggest:
              suggestionNode == null
                ? []
                : [
                    {
                      messageId: "useDeepClone",
                      fix: (fixer) =>
                        fixer.replaceText(
                          suggestionNode as Rule.Node,
                          "deepClone",
                        ),
                    },
                  ],
          });
        });
      },
    };
  },
};
