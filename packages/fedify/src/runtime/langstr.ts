import { type LanguageTag, parseLanguageTag } from "@phensley/language-tag";

/**
 * A language-tagged string which corresponds to the `rdf:langString` type.
 */
export class LanguageString extends String {
  readonly language: LanguageTag;

  /**
   * Constructs a new `LanguageString`.
   * @param value A string value written in the given language.
   * @param language The language of the string.  If a string is given, it will
   *                 be parsed as a `LanguageTag`.
   */
  constructor(value: string, language: LanguageTag | string) {
    super(value);
    this.language = typeof language === "string"
      ? parseLanguageTag(language)
      : language;
  }

  [Symbol.for("Deno.customInspect")](
    inspect: typeof Deno.inspect,
    options: Deno.InspectOptions,
  ): string {
    return `<${this.language.compact()}> ${inspect(this.toString(), options)}`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](
    _depth: number,
    options: unknown,
    inspect: (value: unknown, options: unknown) => string,
  ): string {
    return `<${this.language.compact()}> ${inspect(this.toString(), options)}`;
  }
}
