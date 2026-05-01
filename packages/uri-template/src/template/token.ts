import {
  InvalidLiteralError,
  NestedOpeningBraceError,
  StrayClosingBraceError,
  UnclosedExpressionError,
} from "../errors.ts";
import type { TemplateOptions, Token } from "../types.ts";
import { isLiteralAt, readCodePoint } from "./encoding.ts";
import parseExpression from "./expression.ts";

/**
 * Splits a URI Template source string into literal and expression tokens.
 *
 * This module validates RFC 6570 literal syntax and delegates expression
 * parsing to the expression parser.
 */
export default function tokenize(
  template: string,
  options: TemplateOptions,
): Token[] {
  const { report } = options;
  const tokens: Token[] = [];
  const appendLiteral = (text: string): void => {
    const previous = tokens.at(-1);
    if (previous?.kind === "literal") {
      previous.text += text;
    } else {
      tokens.push({ kind: "literal", text });
    }
  };

  for (let index = 0; index < template.length;) {
    const char = template[index];

    if (char === "{") {
      const closeIndex = template.indexOf("}", index + 1);
      if (closeIndex < 0) {
        report(new UnclosedExpressionError(template, index));
        appendLiteral(template.slice(index));
        break;
      }

      const nestedIndex = template.indexOf("{", index + 1);
      if (nestedIndex >= 0 && nestedIndex < closeIndex) {
        report(new NestedOpeningBraceError(template, nestedIndex));
        appendLiteral(template.slice(index, closeIndex + 1));
        index = closeIndex + 1;
        continue;
      }

      const expression = template.slice(index + 1, closeIndex);
      try {
        tokens.push(parseExpression(expression, template, index, options));
      } catch (error) {
        report(error instanceof Error ? error : new Error(String(error)));
        appendLiteral(template.slice(index, closeIndex + 1));
      }
      index = closeIndex + 1;
      continue;
    }

    if (char === "}") {
      report(new StrayClosingBraceError(template, index));
      appendLiteral(char);
      index++;
      continue;
    }

    const literalLength = isLiteralAt(template, index);
    if (literalLength > 0) {
      appendLiteral(template.slice(index, index + literalLength));
      index += literalLength;
      continue;
    }

    const { char: invalidChar, size } = readCodePoint(template, index);
    report(new InvalidLiteralError(template, index, invalidChar));
    appendLiteral(invalidChar);
    index += size;
  }

  return tokens;
}
