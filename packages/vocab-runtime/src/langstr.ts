/**
 * A language-tagged string which corresponds to the `rdf:langString` type.
 */
export class LanguageString extends String {
  /**
   * The locale of the string.
   * @since 2.0.0
   */
  readonly locale: Intl.Locale;

  /**
   * Constructs a new `LanguageString`.
   * @param value A string value written in the given language.
   * @param language The language of the string.  If a string is given, it will
   *                 be parsed as a `Intl.Locale` object.
   */
  constructor(value: string, language: Intl.Locale | string) {
    super(value);
    this.locale = typeof language === "string"
      ? new Intl.Locale(language)
      : language;
  }

  [Symbol.for("Deno.customInspect")](
    inspect: typeof Deno.inspect,
    options: Deno.InspectOptions,
  ): string {
    return `<${this.locale.baseName}> ${inspect(this.toString(), options)}`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](
    _depth: number,
    options: unknown,
    inspect: (value: unknown, options: unknown) => string,
  ): string {
    return `<${this.locale.baseName}> ${inspect(this.toString(), options)}`;
  }
}
