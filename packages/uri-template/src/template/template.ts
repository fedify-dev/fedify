import type {
  ExpandContext,
  Reporter,
  TemplateOptions,
  Token,
  VarSpec,
} from "../types.ts";
import expand from "./expand.ts";
import match from "./match.ts";
import tokenize from "./token.ts";

/**
 * Parsed RFC 6570 URI Template that can be expanded repeatedly.
 *
 * This class owns tokenization and delegates expression expansion to the
 * expansion module.  Instances are immutable after construction.
 */
export default class Template {
  readonly #tokens: readonly Token[];
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
     * `report` is a no-op. If `strict` is `true`, the first error encountered
     * while parsing or expanding will be automatically thrown after being
     * reported. If `strict` is `false`, errors will be reported but none will
     * be thrown unless the `report` function itself throws. The rest of the
     * part remains as literal text.
     */
    readonly options: Partial<TemplateOptions> = {},
  ) {
    this.#fullOptions = fillOptions(options);
    this.#tokens = freezeTokens(tokenize(uriTemplate, this.#fullOptions));
    Object.freeze(this);
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
   * Immutable parsed token stream for diagnostics and router integration.
   */
  get tokens(): readonly Token[] {
    return this.#tokens;
  }

  /**
   * Expands this template against a variable context.
   */
  readonly expand: (context: ExpandContext) => string = (
    context: ExpandContext,
  ): string => expand(this.#tokens, context, this.#fullOptions);

  /**
   * Matches a URI against this template, returning the variable context if the
   * URI matches or `null` if it does not.
   */
  readonly match: (uri: string) => ExpandContext | null = (
    uri: string,
  ): ExpandContext | null => match(this.#tokens, uri, this.#fullOptions);

  readonly toString = (): string => this.uriTemplate;
}

const freezeTokens = (tokens: Token[]): readonly Token[] =>
  Object.freeze(tokens.map(freezeToken));

const freezeToken = (token: Token): Token =>
  token.kind === "literal"
    ? Object.freeze({ kind: "literal", text: token.text })
    : Object.freeze({
      kind: "expression",
      operator: token.operator,
      vars: Object.freeze(token.vars.map(freezeVarSpec)),
    });

const freezeVarSpec = (varSpec: VarSpec): VarSpec =>
  Object.freeze({
    name: varSpec.name,
    explode: varSpec.explode,
    ...(varSpec.prefix == null ? {} : { prefix: varSpec.prefix }),
  });

const defaultReporter: Reporter = () => void 0;

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
