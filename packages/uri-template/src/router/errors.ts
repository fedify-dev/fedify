/**
 * Common base class for router-level errors.
 */
export class RouterError extends Error {
  /**
   * @param message Human-readable summary.
   */
  constructor(message: string) {
    super(message);
    this.name = "RouterError";
  }
}

/**
 * Raised when a route template is not a path template.
 */
export class RouteTemplatePathError extends RouterError {
  constructor(
    /**
     * The route template that failed validation.
     */
    public readonly template: string,
  ) {
    super("Path must start with a slash or a path expansion.");
    this.name = "RouteTemplatePathError";
  }
}

/**
 * Raised when the same variable name appears in multiple variable
 * specifications whose modifiers imply contradictory `multiple` semantics
 * within a single route template (for example, `{x}` together with `{x*}`).
 */
export class ConflictingVarSpecError extends RouterError {
  constructor(
    /**
     * The route template containing the conflicting variable specifications.
     */
    public readonly template: string,
    /**
     * The variable name with conflicting variable specifications.
     */
    public readonly variable: string,
  ) {
    super(
      `Variable "${variable}" has conflicting explode/prefix modifiers ` +
        `across the template "${template}".`,
    );
    this.name = "ConflictingVarSpecError";
  }
}

/**
 * Raised under the default `exact` route option when the `variables` keys
 * do not exactly match the route template's variables: the set of supplied
 * keys must equal the set of template variables (no unknown keys, none
 * missing).  All mismatched names — both unknown and missing — are reported.
 */
export class RouteTemplateOptionsNotMatchedError extends RouterError {
  constructor(
    /**
     * The route template whose variables were not matched exactly.
     */
    public readonly template: string,
    /**
     * The mismatched variable names: keys not declared by the template
     * together with template variables absent from the options.
     */
    public readonly variable: readonly string[],
  ) {
    super(
      `Route options variables do not exactly match the template ` +
        `"${template}"; mismatched: ${
          variable.map((v) => `"${v}"`).join(", ")
        }.`,
    );
    this.name = "RouteTemplateOptionsNotMatchedError";
  }
}

/**
 * Raised when a variable appears more than once in a route template while
 * its `duplicable` constraint is `false` (the default).
 */
export class DuplicateRouteVariableError extends RouterError {
  constructor(
    /**
     * The route template containing the duplicated variable.
     */
    public readonly template: string,
    /**
     * The variable name that appears more than once.
     */
    public readonly variable: string,
  ) {
    super(
      `Variable "${variable}" appears more than once in the template ` +
        `"${template}" but is not marked "duplicable: true".`,
    );
    this.name = "DuplicateRouteVariableError";
  }
}

/**
 * Raised when a variable specification uses the explode (`*`) or prefix
 * (`:N`) modifier while the corresponding `explodable`/`prefixable`
 * constraint is `false` (the default).
 */
export class DisallowedVarSpecModifierError extends RouterError {
  constructor(
    /**
     * The route template containing the disallowed modifier.
     */
    public readonly template: string,
    /**
     * The variable name whose specification uses the modifier.
     */
    public readonly variable: string,
    /**
     * The disallowed modifier.
     */
    public readonly modifier: "explode" | "prefix",
  ) {
    super(
      `Variable "${variable}" uses the ${modifier} modifier in the ` +
        `template "${template}" but is not marked ` +
        `"${modifier === "explode" ? "explodable" : "prefixable"}: true".`,
    );
    this.name = "DisallowedVarSpecModifierError";
  }
}

/**
 * Raised when a variable is used with an expression operator that is not in
 * its `operatables` allow-list.
 */
export class DisallowedOperatorError extends RouterError {
  constructor(
    /**
     * The route template containing the disallowed operator.
     */
    public readonly template: string,
    /**
     * The variable name used with the disallowed operator.
     */
    public readonly variable: string,
    /**
     * The disallowed expression operator (`""`, `"+"`, `"#"`, `"."`, `"/"`,
     * `";"`, `"?"`, or `"&"`).
     */
    public readonly operator: string,
  ) {
    super(
      `Variable "${variable}" is used with the operator ` +
        `"${operator}" in the template "${template}", which is not in its ` +
        `"operatables" allow-list.`,
    );
    this.name = "DisallowedOperatorError";
  }
}
