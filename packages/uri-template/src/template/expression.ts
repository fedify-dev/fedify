import { OPERATORS } from "../const.ts";
import {
  EmptyExpressionError,
  EmptyVarNameError,
  InvalidPrefixError,
  InvalidVarNameError,
  ReservedOperatorError,
  TrailingCommaError,
  UnexpectedCharacterError,
  UnknownOperatorError,
} from "../errors.ts";
import type { Operator, TemplateOptions, Token, VarSpec } from "../types.ts";
import { isVarcharAt } from "./encoding.ts";

const reservedOperators = ["=", ",", "!", "@", "|"] as const;

/**
 * Parses the content between `{` and `}` into one expression token.
 *
 * The tokenizer supplies the original template and offset so errors can point
 * at the original source string.
 */
export default function parseExpression(
  source: string,
  template: string,
  position: number,
  { report }: TemplateOptions,
): Token {
  const reportExpressionError = (error: Error): Token => {
    report(error);
    return {
      kind: "literal",
      text: template.slice(position, position + source.length + 2),
    };
  };

  if (source.length < 1) {
    return reportExpressionError(new EmptyExpressionError(template, position));
  }

  const first = source[0];
  if (isReservedOperator(first)) {
    return reportExpressionError(
      new ReservedOperatorError(template, position + 1, first),
    );
  }
  if (!isOperator(first) && isVarcharAt(source, 0) < 1) {
    return reportExpressionError(
      new UnknownOperatorError(template, position + 1, first),
    );
  }

  const operator: Operator = isOperator(first) ? first : "";
  const varListStart = operator === "" ? 0 : 1;
  const vars = parseVarList(source, template, position + 1, varListStart);
  return {
    kind: "expression",
    operator,
    vars,
  };
}

function parseVarList(
  source: string,
  template: string,
  offset: number,
  start: number,
): VarSpec[] {
  if (start >= source.length) {
    throw new EmptyVarNameError(template, offset + start);
  }

  const vars: VarSpec[] = [];
  for (let index = start; index < source.length;) {
    if (source[index] === ",") {
      throw index === source.length - 1
        ? new TrailingCommaError(template, offset + index)
        : new EmptyVarNameError(template, offset + index);
    }

    const varStart = index;
    const nameEnd = readVarNameEnd(source, index);
    if (nameEnd === varStart) {
      throw new EmptyVarNameError(template, offset + index);
    }

    const name = source.slice(varStart, nameEnd);
    index = nameEnd;

    const modifier = readModifier(source, template, offset, index, name);
    index = modifier.index;

    if (index < source.length && source[index] !== ",") {
      throw modifier.used
        ? new UnexpectedCharacterError(template, offset + index, source[index])
        : new InvalidVarNameError(
          template,
          offset + index,
          name,
          source[index],
        );
    }

    vars.push({
      name,
      explode: modifier.explode,
      ...(modifier.prefix == null ? {} : { prefix: modifier.prefix }),
    });

    if (index < source.length) {
      index++;
      if (index >= source.length) {
        throw new TrailingCommaError(template, offset + index - 1);
      }
    }
  }

  return vars;
}

function readVarNameEnd(source: string, start: number): number {
  let index = start;
  let expectVarchar = true;
  while (index < source.length) {
    const varcharLength = isVarcharAt(source, index);
    if (varcharLength > 0) {
      index += varcharLength;
      expectVarchar = false;
      continue;
    }
    if (source[index] !== ".") break;
    if (expectVarchar || isVarcharAt(source, index + 1) < 1) break;
    index++;
    expectVarchar = true;
  }
  return index;
}

function readModifier(
  source: string,
  template: string,
  offset: number,
  index: number,
  varSpec: string,
): {
  readonly explode: boolean;
  readonly index: number;
  readonly prefix?: number;
  readonly used: boolean;
} {
  if (source[index] === "*") {
    return { explode: true, index: index + 1, used: true };
  }

  if (source[index] !== ":") {
    return { explode: false, index, used: false };
  }

  const digitsStart = index + 1;
  let digitsEnd = digitsStart;
  while (digitsEnd < source.length && isDigit(source[digitsEnd])) digitsEnd++;

  const prefix = source.slice(digitsStart, digitsEnd);
  if (!/^[1-9][0-9]{0,3}$/.test(prefix)) {
    throw new InvalidPrefixError(template, offset + index, varSpec, prefix);
  }

  return {
    explode: false,
    index: digitsEnd,
    prefix: Number(prefix),
    used: true,
  };
}

function isOperator(char: string): char is Operator {
  return (OPERATORS as readonly string[]).includes(char) && char !== "";
}

function isReservedOperator(char: string): boolean {
  return (reservedOperators as readonly string[]).includes(char);
}

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0x30 && code <= 0x39;
}
