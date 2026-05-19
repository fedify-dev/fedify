import type { Operator, Token, VarSpec } from "../types.ts";
import { isExpression } from "../utils.ts";
import {
  ConflictingVarSpecError,
  DisallowedOperatorError,
  DisallowedVarSpecModifierError,
  DuplicateRouteVariableError,
  RouteTemplateOptionsNotMatchedError,
} from "./errors.ts";
import type {
  RouteOptions,
  RouterPathPattern,
  VariableConstraint,
} from "./types.ts";

/**
 * Resolves a partial options input against a path pattern into fully-resolved
 * {@link RouteOptions}.  Mirrors `fillOptions` in *template.ts*: missing
 * fields are filled with their defaults, with `multiple` derived from the
 * variable specification when not given.  Throws when the supplied
 * `variables` keys do not match the template (under `exact`), when the same
 * variable name carries contradictory explode/prefix modifiers, or when a
 * per-field constraint is violated.
 */
export function fillRouteOptions(
  options: {
    readonly variables?: Readonly<Record<string, Partial<VariableConstraint>>>;
    readonly exact?: boolean;
  } = {},
  pattern: RouterPathPattern,
): RouteOptions {
  const overrides = options?.variables ?? {};
  const exact = options?.exact ?? true;

  // Under `exact` (the default), the supplied `variables` keys must equal
  // the template's variables exactly: `Set(keys) === pattern.variables`.
  // Skipped when no `variables` object was supplied at all, so routes
  // registered without per-variable options keep working.
  if (exact && options?.variables != null) {
    const keys = Object.keys(overrides);
    const unknown = keys.filter((key) => !pattern.variables.has(key));
    const missing = [...pattern.variables].filter(
      (name) => !(name in overrides),
    );
    const mismatched = [...unknown, ...missing];
    if (mismatched.length > 0) {
      throw new RouteTemplateOptionsNotMatchedError(
        pattern.path,
        mismatched,
      );
    }
  }

  const operatorsByName = groupVarOperators(pattern.template.tokens);
  const variables: Record<string, VariableConstraint> = {};
  for (const [name, specs] of groupVarSpecs(pattern.template.tokens)) {
    const override = overrides[name];

    const hasExplode = specs.some((spec) => spec.explode);
    const hasPrefix = specs.some((spec) => spec.prefix != null);
    const hasPlain = specs.some(
      (spec) => !spec.explode && spec.prefix == null,
    );

    const multiple = override?.multiple;
    if (
      (hasExplode && (hasPrefix || hasPlain)) ||
      (hasExplode && multiple === false) ||
      (hasPrefix && multiple === true)
    ) {
      throw new ConflictingVarSpecError(pattern.path, name);
    }

    variables[name] = {
      nullable: fillNullable(override?.nullable),
      multiple: fillMultiple(
        multiple,
        hasExplode,
        hasPrefix,
      ),
      duplicable: fillDuplicable(
        override?.duplicable,
        pattern.path,
        name,
        specs.length,
      ),
      prefixable: fillPrefixable(
        override?.prefixable,
        pattern.path,
        name,
        hasPrefix,
      ),
      explodable: fillExplodable(
        override?.explodable,
        pattern.path,
        name,
        hasExplode,
      ),
      operatables: fillOperatables(
        override?.operatables,
        pattern.path,
        name,
        operatorsByName.get(name),
      ),
    };
  }

  return { variables, exact };
}

export const fillNullable = (override: boolean | undefined): boolean =>
  override ?? false;

export const fillMultiple = (
  requested: boolean | undefined,
  hasExplode: boolean,
  hasPrefix: boolean,
): boolean => {
  if (hasExplode) return true;
  if (hasPrefix) return false;
  return requested ?? false;
};

export const fillDuplicable = (
  override: boolean | undefined,
  template: string,
  name: string,
  occurrences: number,
): boolean => {
  const duplicable = override ?? false;
  if (occurrences > 1 && !duplicable) {
    throw new DuplicateRouteVariableError(template, name);
  }
  return duplicable;
};

export const fillPrefixable = (
  override: boolean | undefined,
  template: string,
  name: string,
  hasPrefix: boolean,
): boolean => {
  const prefixable = override ?? false;
  if (hasPrefix && !prefixable) {
    throw new DisallowedVarSpecModifierError(template, name, "prefix");
  }
  return prefixable;
};

export const fillExplodable = (
  override: boolean | undefined,
  template: string,
  name: string,
  hasExplode: boolean,
): boolean => {
  const explodable = override ?? false;
  if (hasExplode && !explodable) {
    throw new DisallowedVarSpecModifierError(template, name, "explode");
  }
  return explodable;
};

export const fillOperatables = (
  override: readonly Operator[] | undefined,
  template: string,
  name: string,
  operators: ReadonlySet<Operator> | undefined,
): readonly Operator[] => {
  const operatables = override ?? [];
  if (operatables.length > 0 && operators != null) {
    for (const operator of operators) {
      if (!operatables.includes(operator)) {
        throw new DisallowedOperatorError(template, name, operator);
      }
    }
  }
  return operatables;
};

const groupVarSpecs = (
  tokens: readonly Token[],
): ReadonlyMap<string, readonly VarSpec[]> => {
  const grouped = new Map<string, VarSpec[]>();
  for (const token of tokens) {
    if (!isExpression(token)) continue;
    for (const varSpec of token.vars) {
      const list = grouped.get(varSpec.name);
      if (list == null) grouped.set(varSpec.name, [varSpec]);
      else list.push(varSpec);
    }
  }
  return grouped;
};

const groupVarOperators = (
  tokens: readonly Token[],
): ReadonlyMap<string, ReadonlySet<Operator>> => {
  const grouped = new Map<string, Set<Operator>>();
  for (const token of tokens) {
    if (!isExpression(token)) continue;
    for (const varSpec of token.vars) {
      const set = grouped.get(varSpec.name);
      if (set == null) grouped.set(varSpec.name, new Set([token.operator]));
      else set.add(token.operator);
    }
  }
  return grouped;
};
