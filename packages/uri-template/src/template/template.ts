import { getLogger } from "@logtape/logtape";
import type {
  ExpandContext,
  Reporter,
  TemplateOptions,
  Token,
} from "../types.ts";
import expand from "./expand.ts";
import match from "./match.ts";
import tokenize from "./token.ts";

/**
 * Parsed RFC 6570 URI Template that can be expanded repeatedly.
 *
 * This class owns tokenization and delegates expression expansion to the
 * expansion module.
 */
export default class Template {
  readonly #tokens: Token[];
  readonly #fullOptions: TemplateOptions;

  constructor(
    /**
     * URI template string to parse. See [RFC 6570] for syntax details.
     *
     * [RFC 6570]: https://datatracker.ietf.org/doc/html/rfc6570
     */
    public readonly uriTemplate: string,
    /**
     * Options for parsing the template. By default, `strict` is `true` and
     * `report` logs errors using the default logger. If `strict` is `true`, the
     * first error encountered while parsing or expanding will be automatically
     * thrown after being reported. If `strict` is `false`, errors will be
     * reported but none will be thrown unless the `report` function itself
     * throws. The rest of the part remains as literal text.
     */
    readonly options: Partial<TemplateOptions> = {},
  ) {
    this.#fullOptions = fillOptions(options);
    this.#tokens = tokenize(uriTemplate, this.#fullOptions);
  }

  /**
   * Parses a URI Template using default strict parsing options.
   */
  static parse(
    uriTemplate: string,
    options: Partial<TemplateOptions> = {},
  ): Template {
    return new Template(uriTemplate, options);
  }

  /**
   * Parsed token stream for diagnostics and router integration.
   */
  get tokens(): readonly Token[] {
    return this.#tokens;
  }

  /**
   * Expands this template against a variable context.
   */
  expand: (context: ExpandContext) => string = (
    context: ExpandContext,
  ): string => expand(this.#tokens, context, this.#fullOptions);

  /**
   * Matches a URI against this template, returning the variable context if the
   * URI matches or `null` if it does not.
   */
  match: (uri: string) => ExpandContext | null = (
    uri: string,
  ): ExpandContext | null => match(this.#tokens, uri, this.#fullOptions);

  toString = (): string => this.uriTemplate;
}

const logger = getLogger(["fedify", "uri-template", "template"]);

const defaultReporter: Reporter = (error: Error) => logger.error(error);

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
