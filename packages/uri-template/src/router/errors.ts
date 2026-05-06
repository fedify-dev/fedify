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
