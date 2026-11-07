import type { Rule } from "eslint";
import { RAW_PROPERTY_IRI_MESSAGES } from "../lib/messages.ts";
import {
  checkRawPropertyIris,
  type RawPropertyIriOptions,
} from "../lib/raw-property-iri.ts";

/** Check statically known raw-property IRIs using Deno's default modules. */
export const deno: Deno.lint.Rule = {
  create(context) {
    return {
      Program(node) {
        checkRawPropertyIris(node, { modules: [] }, (diagnostic) => {
          const { value, replacement, messageId } = diagnostic;
          const hint = replacement ? ` Did you mean "${replacement}"?` : "";
          context.report({
            node: diagnostic.node as Deno.lint.Node,
            message: RAW_PROPERTY_IRI_MESSAGES[messageId]
              .replace("{{value}}", () => value).replace(
                "{{hint}}",
                () => hint,
              ),
          });
        });
      },
    };
  },
};

/** ESLint and Oxlint adapter, with optional generated vocabulary modules. */
export const eslint: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Check full IRIs passed to raw-property helpers" },
    hasSuggestions: true,
    messages: RAW_PROPERTY_IRI_MESSAGES,
    schema: [{
      type: "object",
      properties: { modules: { type: "array", items: { type: "string" } } },
      additionalProperties: false,
    }],
  },
  create(context) {
    const options: RawPropertyIriOptions = context.options[0] ??
      { modules: [] };
    return {
      Program(node) {
        checkRawPropertyIris(node, options, (diagnostic) => {
          const { value, replacement, messageId, suggestionNode } = diagnostic;
          context.report({
            node: diagnostic.node as Rule.Node,
            messageId,
            data: {
              value,
              hint: replacement ? ` Did you mean "${replacement}"?` : "",
            },
            suggest: replacement && suggestionNode
              ? [{
                messageId: "expandPrefix",
                data: { replacement },
                fix: (fixer) =>
                  fixer.replaceText(
                    suggestionNode as Rule.Node,
                    JSON.stringify(replacement),
                  ),
              }]
              : undefined,
          });
        });
      },
    };
  },
};
