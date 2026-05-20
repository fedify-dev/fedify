/**
 * Expansion behavior for a URI Template operator.
 *
 * Used by the expansion module to apply RFC 6570's `first`, `sep`, `named`,
 * `ifemp`, and allowed-character rules uniformly.
 */
export interface OperatorSpec {
  /** Prefix emitted before the first defined value in the expression. */
  first: string;
  /** Separator emitted between defined values or exploded members. */
  sep: string;
  /** Whether the expansion emits variable names or associative keys. */
  named: boolean;
  /** Suffix emitted after a name when the corresponding value is empty. */
  ifEmpty: string;
  /** Whether reserved characters and pct-encoded triplets pass through. */
  allowReserved: boolean;
}

/**
 * Operators implemented by this package, including `""` for simple string
 * expansion with no explicit operator.
 */
export const OPERATORS = ["", "+", ".", "/", ";", "?", "&", "#"] as const;

/**
 * Union of supported URI Template operators.
 */
export type Operator = typeof OPERATORS[number];

/**
 * RFC 6570 operator behavior table used during expansion.
 * This table is from RFC 6570 Appendix A.
 *
 * |       | `NUL`   | `+`     | `.`     | `/`     | `;`    | `?`    | `&`    | `#`     |
 * | ----- | ------- | ------- | ------- | ------- | ------ | ------ | ------ | ------- |
 * | first | `""`    | `""`    | `"."`   | `"/"`   | `";"`  | `"?"`  | `"&"`  | `"#"`   |
 * | sep   | `","`   | `","`   | `"."`   | `"/"`   | `";"`  | `"&"`  | `"&"`  | `","`   |
 * | named | `false` | `false` | `false` | `false` | `true` | `true` | `true` | `false` |
 * | ifemp | `""`    | `""`    | `""`    | `""`    | `""`   | `"="`  | `"="`  | `""`    |
 * | allow | `U`     | `U+R`   | `U`     | `U`     | `U`    | `U`    | `U`    | `U+R`   |
 */
export const operatorSpecs: Record<Operator, OperatorSpec> = {
  "": { first: "", sep: ",", named: false, ifEmpty: "", allowReserved: false },
  "+": { first: "", sep: ",", named: false, ifEmpty: "", allowReserved: true },
  ".": {
    first: ".",
    sep: ".",
    named: false,
    ifEmpty: "",
    allowReserved: false,
  },
  "/": {
    first: "/",
    sep: "/",
    named: false,
    ifEmpty: "",
    allowReserved: false,
  },
  ";": { first: ";", sep: ";", named: true, ifEmpty: "", allowReserved: false },
  "?": {
    first: "?",
    sep: "&",
    named: true,
    ifEmpty: "=",
    allowReserved: false,
  },
  "&": {
    first: "&",
    sep: "&",
    named: true,
    ifEmpty: "=",
    allowReserved: false,
  },
  "#": { first: "#", sep: ",", named: false, ifEmpty: "", allowReserved: true },
};

// cspell: ignore ifemp
