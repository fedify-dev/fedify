import type {
  ExpandContext,
  Reporter,
  TemplateOptions,
  Token,
} from "../types.ts";
import expand from "./expand.ts";
import tokenize from "./token.ts";

/**
 * Parsed RFC 6570 URI Template that can be expanded repeatedly.
 *
 * This class owns tokenization and delegates expression expansion to the
 * expansion module.
 */
export default class Template {
  readonly #tokens: Token[];
  readonly fullOptions: TemplateOptions;

  constructor(
    /**
     * URI template string to parse. See [RFC 6570] for syntax details.
     *
     * [RFC 6570]: https://datatracker.ietf.org/doc/html/rfc6570
     */
    public readonly uriTemplate: string,
    /**
     * Options for parsing the template. By default, `strict` is `true` and
     * `report` ignores parse errors. If `strict` is `true`, the first error
     * encountered while parsing will be automatically thrown after being
     * reported. If `strict` is `false`, errors will be reported but none will
     * be thrown unless the `report` function itself throws.
     */
    readonly options: Partial<TemplateOptions> = {},
  ) {
    this.fullOptions = fillOptions(options);
    this.#tokens = tokenize(uriTemplate, this.fullOptions);
  }

  /**
   * Parses a URI Template using default strict parsing options.
   */
  static parse(uriTemplate: string): Template {
    return new Template(uriTemplate);
  }

  /**
   * Parsed token stream for diagnostics and router integration.
   */
  get tokens(): readonly Token[] {
    return this.#tokens;
  }

  #expand(context: ExpandContext): string {
    return this.#tokens.map((token) =>
      token.kind === "literal"
        ? token.text
        : expand(token.vars, token.operator, context)
    ).join("");
  }
  /**
   * Expands this template against a variable context.
   */
  expand: (context: ExpandContext) => string = this.#expand.bind(this);
}

const defaultReporter = (_error: Error): void => {};

const fillOptions = (
  { strict, report }: Partial<TemplateOptions>,
): TemplateOptions => {
  report ??= defaultReporter;
  strict ??= true;
  report = strict ? strictWrapper(report) : report;
  return { strict, report };
};

const strictWrapper = (reporter: Reporter) => (error: Error): never => {
  reporter(error);
  throw error;
};
