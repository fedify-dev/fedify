// Borrowed from https://github.com/hugoalh/http-header-link-es
const parametersNeedLowerCase: readonly string[] = ["rel", "type"];

const regexpLinkWhitespace = /[\n\r\s\t]/;

/**
 * HTTP header `Link` entry.
 */
export type HttpHeaderLinkEntry = [
  uri: string,
  parameters: { [key: string]: string },
];

function validateURI(uri: string): void {
  if (uri.includes("\n") || regexpLinkWhitespace.test(uri)) {
    throw new SyntaxError(`\`${uri}\` is not a valid URI!`);
  }
}

function* parseLinkFromString(input: string): Generator<HttpHeaderLinkEntry> {
  // Remove Unicode characters of BOM (Byte Order Mark) and no-break space.
  const inputFmt: string = input.replaceAll("\u00A0", "").replaceAll(
    "\uFEFF",
    "",
  );
  for (let cursor: number = 0; cursor < inputFmt.length; cursor += 1) {
    while (regexpLinkWhitespace.test(inputFmt.charAt(cursor))) {
      cursor += 1;
    }
    if (inputFmt.charAt(cursor) !== "<") {
      throw new SyntaxError(
        `Unexpected character \`${
          inputFmt.charAt(cursor)
        }\` at position ${cursor}; Expect character \`<\`!`,
      );
    }
    cursor += 1;
    const cursorEndUri: number = inputFmt.indexOf(">", cursor);
    if (cursorEndUri === -1) {
      throw new SyntaxError(
        `Missing end of URI delimiter character \`>\` after position ${cursor}!`,
      );
    }
    if (cursorEndUri === cursor) {
      throw new SyntaxError(`Missing URI at position ${cursor}!`);
    }
    const uriSlice: string = inputFmt.slice(cursor, cursorEndUri);
    validateURI(uriSlice);
    const uri: HttpHeaderLinkEntry[0] = decodeURI(uriSlice);
    const parameters: HttpHeaderLinkEntry[1] = {};
    cursor = cursorEndUri + 1;
    while (regexpLinkWhitespace.test(inputFmt.charAt(cursor))) {
      cursor += 1;
    }
    if (
      cursor === inputFmt.length ||
      inputFmt.charAt(cursor) === ","
    ) {
      yield [uri, parameters];
      continue;
    }
    if (inputFmt.charAt(cursor) !== ";") {
      throw new SyntaxError(
        `Unexpected character \`${
          inputFmt.charAt(cursor)
        }\` at position ${cursor}; Expect character \`;\`!`,
      );
    }
    cursor += 1;
    while (cursor < inputFmt.length) {
      while (regexpLinkWhitespace.test(inputFmt.charAt(cursor))) {
        cursor += 1;
      }
      const parameterKey: string | undefined = inputFmt.slice(cursor).match(
        /^[\w-]+\*?/,
      )?.[0].toLowerCase();
      if (typeof parameterKey === "undefined") {
        throw new SyntaxError(
          `Unexpected character \`${
            inputFmt.charAt(cursor)
          }\` at position ${cursor}; Expect a valid parameter key!`,
        );
      }
      cursor += parameterKey.length;
      while (regexpLinkWhitespace.test(inputFmt.charAt(cursor))) {
        cursor += 1;
      }
      if (
        cursor === inputFmt.length ||
        inputFmt.charAt(cursor) === ","
      ) {
        parameters[parameterKey] = "";
        break;
      }
      if (inputFmt.charAt(cursor) === ";") {
        parameters[parameterKey] = "";
        cursor += 1;
        continue;
      }
      if (inputFmt.charAt(cursor) !== "=") {
        throw new SyntaxError(
          `Unexpected character \`${
            inputFmt.charAt(cursor)
          }\` at position ${cursor}; Expect character \`=\`!`,
        );
      }
      cursor += 1;
      while (regexpLinkWhitespace.test(inputFmt.charAt(cursor))) {
        cursor += 1;
      }
      let parameterValue: string = "";
      if (inputFmt.charAt(cursor) === '"') {
        cursor += 1;
        while (cursor < inputFmt.length) {
          if (inputFmt.charAt(cursor) === '"') {
            cursor += 1;
            break;
          }
          if (inputFmt.charAt(cursor) === "\\") {
            cursor += 1;
          }
          parameterValue += inputFmt.charAt(cursor);
          cursor += 1;
        }
      } else {
        const cursorDiffParameterValue: number = inputFmt.slice(cursor).search(
          /[\s;,]/,
        );
        if (cursorDiffParameterValue === -1) {
          parameterValue += inputFmt.slice(cursor);
          cursor += parameterValue.length;
        } else {
          parameterValue += inputFmt.slice(cursor, cursorDiffParameterValue);
          cursor += cursorDiffParameterValue;
        }
      }
      parameters[parameterKey] = parametersNeedLowerCase.includes(parameterKey)
        ? parameterValue.toLowerCase()
        : parameterValue;
      while (regexpLinkWhitespace.test(inputFmt.charAt(cursor))) {
        cursor += 1;
      }
      if (
        cursor === inputFmt.length ||
        inputFmt.charAt(cursor) === ","
      ) {
        break;
      }
      if (inputFmt.charAt(cursor) === ";") {
        cursor += 1;
        continue;
      }
      throw new SyntaxError(
        `Unexpected character \`${
          inputFmt.charAt(cursor)
        }\` at position ${cursor}; Expect character \`,\`, character \`;\`, or end of the string!`,
      );
    }
    yield [uri, parameters];
  }
}

/**
 * Handle the HTTP header `Link` according to the specification RFC 8288.
 */
export class HttpHeaderLink {
  get [Symbol.toStringTag](): string {
    return "HTTPHeaderLink";
  }

  #entries: HttpHeaderLinkEntry[] = [];

  /**
   * Handle the HTTP header `Link` according to the specification RFC 8288.
   * @param {...(string | Headers | HttpHeaderLink | HttpHeaderLinkEntry[] | Response)} inputs Input.
   */
  constructor(
    ...inputs:
      (string | Headers | HttpHeaderLink | HttpHeaderLinkEntry[] | Response)[]
  ) {
    if (inputs.length > 0) {
      this.add(...inputs);
    }
  }

  /**
   * Add entries.
   * @param {...(string | Headers | HttpHeaderLink | HttpHeaderLinkEntry[] | Response)} inputs Input.
   * @returns {this}
   */
  add(
    ...inputs:
      (string | Headers | HttpHeaderLink | HttpHeaderLinkEntry[] | Response)[]
  ): this {
    for (const input of inputs) {
      if (input instanceof HttpHeaderLink) {
        this.#entries.push(...structuredClone(input.#entries));
      } else if (Array.isArray(input)) {
        this.#entries.push(
          ...input.map(
            ([uri, parameters]: HttpHeaderLinkEntry): HttpHeaderLinkEntry => {
              validateURI(uri);
              Object.entries(parameters).forEach(
                ([key, value]: [string, string]): void => {
                  if (
                    key !== key.toLowerCase() ||
                    !(/^[\w-]+\*?$/.test(key))
                  ) {
                    throw new SyntaxError(
                      `\`${key}\` is not a valid parameter key!`,
                    );
                  }
                  if (
                    parametersNeedLowerCase.includes(key) &&
                    value !== value.toLowerCase()
                  ) {
                    throw new SyntaxError(
                      `\`${value}\` is not a valid parameter value!`,
                    );
                  }
                },
              );
              return [uri, structuredClone(parameters)];
            },
          ),
        );
      } else {
        for (
          const entry of parseLinkFromString(
            ((
                input instanceof Headers ||
                input instanceof Response
              )
              ? ((input instanceof Headers) ? input : input.headers).get("Link")
              : input) ?? "",
          )
        ) {
          this.#entries.push(entry);
        }
      }
    }
    return this;
  }

  /**
   * Return all of the entries.
   * @returns {HttpHeaderLinkEntry[]} Entries.
   */
  entries(): HttpHeaderLinkEntry[] {
    return structuredClone(this.#entries);
  }

  /**
   * Get entries by parameter.
   * @param {string} key Key of the parameter.
   * @param {string} value Value of the parameter.
   * @returns {HttpHeaderLinkEntry[]} Entries which match the parameter.
   */
  getByParameter(key: string, value: string): HttpHeaderLinkEntry[] {
    if (key !== key.toLowerCase()) {
      throw new SyntaxError(`\`${key}\` is not a valid parameter key!`);
    }
    if (key === "rel") {
      return this.getByRel(value);
    }
    return structuredClone(
      this.#entries.filter((entry: HttpHeaderLinkEntry): boolean => {
        return (entry[1][key] === value);
      }),
    );
  }

  /**
   * Get entries by parameter `rel`.
   * @param {string} value Value of the parameter `rel`.
   * @returns {HttpHeaderLinkEntry[]} Entries which match the parameter.
   */
  getByRel(value: string): HttpHeaderLinkEntry[] {
    if (value !== value.toLowerCase()) {
      throw new SyntaxError(
        `\`${value}\` is not a valid parameter \`rel\` value!`,
      );
    }
    return structuredClone(
      this.#entries.filter((entity: HttpHeaderLinkEntry): boolean => {
        return (entity[1].rel?.toLowerCase() === value);
      }),
    );
  }

  /**
   * Whether have entries that match parameter.
   * @param {string} key Key of the parameter.
   * @param {string} value Value of the parameter.
   * @returns {boolean} Determine result.
   */
  hasParameter(key: string, value: string): boolean {
    return (this.getByParameter(key, value).length > 0);
  }

  /**
   * Stringify entries.
   * @returns {string} Stringified entries.
   */
  toString(): string {
    return this.#entries.map(
      ([uri, parameters]: HttpHeaderLinkEntry): string => {
        return [
          `<${encodeURI(uri)}>`,
          ...Object.entries(parameters).map(
            ([key, value]: [string, string]): string => {
              return ((value.length > 0)
                ? `${key}="${value.replaceAll('"', '\\"')}"`
                : key);
            },
          ),
        ].join("; ");
      },
    ).join(", ");
  }

  /**
   * Parse the HTTP header `Link` according to the specification RFC 8288.
   * @param {...(string | Headers | HttpHeaderLink | HttpHeaderLinkEntry[] | Response)} inputs Input.
   * @returns {HttpHeaderLink}
   */
  static parse(
    ...inputs:
      (string | Headers | HttpHeaderLink | HttpHeaderLinkEntry[] | Response)[]
  ): HttpHeaderLink {
    return new this(...inputs);
  }

  /**
   * Stringify as the HTTP header `Link` according to the specification RFC 8288.
   * @param {...(string | Headers | HttpHeaderLink | HttpHeaderLinkEntry[] | Response)} inputs Input.
   * @returns {string}
   */
  static stringify(
    ...inputs:
      (string | Headers | HttpHeaderLink | HttpHeaderLinkEntry[] | Response)[]
  ): string {
    return new this(...inputs).toString();
  }
}
