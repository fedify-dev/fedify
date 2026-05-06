import { operatorSpecs } from "../const.ts";
import type {
  AssociativeValue,
  ExpandContext,
  OperatorSpec,
  PrimitiveValue,
  TemplateOptions,
  Token,
  VarSpec,
} from "../types.ts";
import { encodeName, encodeValue, truncateValue } from "./encoding.ts";
import { PrefixModifierNotApplicableError } from "./errors.ts";

/**
 * Expands one parsed URI Template expression against the supplied variable
 * context using the operator behavior table from RFC 6570.
 */
export default function expand(
  tokens: readonly Token[],
  context: ExpandContext,
  options: TemplateOptions,
): string {
  return tokens.map((token) =>
    token.kind === "literal"
      ? token.text
      : expandExpressions(token.vars, token.operator, context, options)
  ).join("");
}

function expandExpressions(
  vars: VarSpec[],
  operator: keyof typeof operatorSpecs,
  context: ExpandContext,
  options: TemplateOptions,
): string {
  const spec = operatorSpecs[operator];
  const parts = vars.flatMap((varSpec) =>
    expandValue(varSpec, context[varSpec.name], spec, options)
  );
  return parts.length < 1 ? "" : `${spec.first}${parts.join(spec.sep)}`;
}

function expandValue(
  varSpec: VarSpec,
  value: ExpandContext[string],
  spec: OperatorSpec,
  options: TemplateOptions,
): string[] {
  if (value == null) return [];
  if (isPrimitiveList(value)) {
    const encoded = encodeListMembers(value, spec.allowReserved);
    if (encoded.length < 1) return [];
    if (!reportPrefixModifierError(varSpec, "list", options)) return [];
    return expandList(varSpec, encoded, spec);
  }
  if (isAssociative(value)) {
    const pairs = encodeAssociativePairs(value, spec.allowReserved);
    if (pairs.length < 1) return [];
    if (!reportPrefixModifierError(varSpec, "associative", options)) return [];
    return expandAssociative(varSpec, pairs, spec);
  }
  return expandPrimitive(varSpec, value, spec);
}

function expandPrimitive(
  varSpec: VarSpec,
  value: Exclude<PrimitiveValue, null | undefined>,
  spec: OperatorSpec,
): string[] {
  const text = String(value);
  const prefixed = varSpec.prefix == null
    ? text
    : truncateValue(text, varSpec.prefix);
  const encoded = encodeValue(spec.allowReserved)(prefixed);
  if (!spec.named) return [encoded];

  const name = encodeName(varSpec.name);
  return [expandNamedPair(name, encoded, spec)];
}

function expandList(
  varSpec: VarSpec,
  encoded: readonly string[],
  spec: OperatorSpec,
): string[] {
  const name = encodeName(varSpec.name);
  if (varSpec.explode) {
    return spec.named
      ? encoded.map((item) => expandNamedPair(name, item, spec))
      : [...encoded];
  }

  const joined = encoded.join(",");
  return spec.named ? [expandNamedPair(name, joined, spec)] : [joined];
}

function expandAssociative(
  varSpec: VarSpec,
  pairs: readonly (readonly [key: string, value: string])[],
  spec: OperatorSpec,
): string[] {
  if (varSpec.explode) {
    return pairs.map(([key, item]) => expandNamedPair(key, item, spec));
  }

  const item = pairs.flat(1).join(",");
  if (!spec.named) return [item];

  const key = encodeName(varSpec.name);
  return [expandNamedPair(key, item, spec)];
}

const expandNamedPair = (
  key: string,
  item: string,
  spec: OperatorSpec,
): string => item === "" ? `${key}${spec.ifEmpty}` : `${key}=${item}`;

const encodeListMembers = (
  value: readonly PrimitiveValue[],
  allowReserved: boolean,
): string[] =>
  value
    .filter((item) => item != null)
    .map(String)
    .map(encodeValue(allowReserved));

const encodeAssociativePairs = (
  value: AssociativeValue,
  allowReserved: boolean,
): (readonly [key: string, value: string])[] =>
  Object.entries(value)
    .map(([key, item]) => [key, normalizePairValue(item) as string] as const)
    .filter(([, normalized]) => normalized != null)
    .map((kv) => kv.map(encodeValue(allowReserved)) as [string, string]);

function normalizePairValue(
  value: PrimitiveValue | readonly PrimitiveValue[],
): string | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return String(value);

  const items = value.filter((item) => item != null).map(String);
  return items.length < 1 ? null : items.join(",");
}

const isAssociative = (
  value: ExpandContext[string],
): value is AssociativeValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPrimitiveList = (
  value: ExpandContext[string],
): value is readonly PrimitiveValue[] => Array.isArray(value);

function reportPrefixModifierError(
  varSpec: VarSpec,
  valueType: "list" | "associative",
  { report, strict }: TemplateOptions,
): boolean {
  if (varSpec.prefix == null) return true;
  const error = new PrefixModifierNotApplicableError(
    varSpec.name,
    varSpec.prefix,
    valueType,
  );
  report(error);
  if (strict) throw error;
  return false;
}
