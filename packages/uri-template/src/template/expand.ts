import { operatorSpecs } from "../const.ts";
import { PrefixModifierNotApplicableError } from "../errors.ts";
import type {
  AssociativeValue,
  ExpandContext,
  PrimitiveValue,
  VarSpec,
} from "../types.ts";
import { encodeName, encodeValue, truncateValue } from "./encoding.ts";

/**
 * Expands one parsed URI Template expression against the supplied variable
 * context using the operator behavior table from RFC 6570.
 */
export default function expand(
  vars: VarSpec[],
  operator: keyof typeof operatorSpecs,
  context: ExpandContext,
): string {
  const spec = operatorSpecs[operator];
  const parts = vars.flatMap((varSpec) =>
    expandValue(varSpec, context[varSpec.name], spec)
  );
  return parts.length < 1 ? "" : `${spec.first}${parts.join(spec.sep)}`;
}

function expandValue(
  varSpec: VarSpec,
  value: ExpandContext[string],
  spec: typeof operatorSpecs[keyof typeof operatorSpecs],
): string[] {
  if (isUndefined(value)) return [];
  if (isList(value)) {
    const encoded = encodeListMembers(value, spec.allowReserved);
    if (encoded.length < 1) return [];
    assertNoPrefixModifier(varSpec, "list");
    return expandList(varSpec, encoded, spec);
  }
  if (isAssociative(value)) {
    const pairs = encodeAssociativePairs(value, spec.allowReserved);
    if (pairs.length < 1) return [];
    assertNoPrefixModifier(varSpec, "associative");
    return expandAssociative(varSpec, pairs, spec);
  }
  return expandPrimitive(varSpec, value, spec);
}

function expandPrimitive(
  varSpec: VarSpec,
  value: Exclude<PrimitiveValue, null | undefined>,
  spec: typeof operatorSpecs[keyof typeof operatorSpecs],
): string[] {
  const text = String(value);
  const prefixed = varSpec.prefix == null
    ? text
    : truncateValue(text, varSpec.prefix);
  const encoded = encodeValue(prefixed, spec.allowReserved);
  if (!spec.named) return [encoded];

  const name = encodeName(varSpec.name);
  return [encoded === "" ? `${name}${spec.ifEmpty}` : `${name}=${encoded}`];
}

function expandList(
  varSpec: VarSpec,
  encoded: readonly string[],
  spec: typeof operatorSpecs[keyof typeof operatorSpecs],
): string[] {
  const name = encodeName(varSpec.name);
  if (varSpec.explode) {
    return spec.named
      ? encoded.map((item) =>
        item === "" ? `${name}${spec.ifEmpty}` : `${name}=${item}`
      )
      : [...encoded];
  }

  const joined = encoded.join(",");
  return spec.named
    ? [joined === "" ? `${name}${spec.ifEmpty}` : `${name}=${joined}`]
    : [joined];
}

function expandAssociative(
  varSpec: VarSpec,
  pairs: readonly (readonly [key: string, value: string])[],
  spec: typeof operatorSpecs[keyof typeof operatorSpecs],
): string[] {
  if (varSpec.explode) {
    return pairs.map(([key, item]) => {
      return item === "" ? `${key}${spec.ifEmpty}` : `${key}=${item}`;
    });
  }

  const joined = pairs.flatMap(([key, item]) => [
    key,
    item,
  ]).join(",");

  if (!spec.named) return [joined];

  const name = encodeName(varSpec.name);
  return [joined === "" ? `${name}${spec.ifEmpty}` : `${name}=${joined}`];
}

function encodeListMembers(
  value: readonly PrimitiveValue[],
  allowReserved: boolean,
): string[] {
  return value
    .filter((item): item is Exclude<PrimitiveValue, null | undefined> =>
      !isUndefined(item)
    )
    .map((item) => encodeValue(String(item), allowReserved));
}

function encodeAssociativePairs(
  value: AssociativeValue,
  allowReserved: boolean,
): (readonly [key: string, value: string])[] {
  return Object.entries(value).flatMap(([key, item]) => {
    const normalized = normalizePairValue(item);
    return normalized == null ? [] : [
      [
        encodeValue(key, allowReserved),
        encodeValue(normalized, allowReserved),
      ] as const,
    ];
  });
}

function normalizePairValue(
  value: PrimitiveValue | readonly PrimitiveValue[],
): string | undefined {
  if (isUndefined(value)) return undefined;
  if (!Array.isArray(value)) return String(value);

  const items = value
    .filter((item): item is Exclude<PrimitiveValue, null | undefined> =>
      !isUndefined(item)
    )
    .map(String);
  return items.length < 1 ? undefined : items.join(",");
}

function isAssociative(
  value: ExpandContext[string],
): value is AssociativeValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(
  value: ExpandContext[string],
): value is readonly PrimitiveValue[] {
  return Array.isArray(value);
}

function isUndefined(value: unknown): value is null | undefined {
  return value == null;
}

function assertNoPrefixModifier(
  varSpec: VarSpec,
  valueType: "list" | "associative",
): void {
  if (varSpec.prefix == null) return;
  throw new PrefixModifierNotApplicableError(
    varSpec.name,
    varSpec.prefix,
    valueType,
  );
}
