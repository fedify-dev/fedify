export class ParseError extends Error {
  override name: "RFC6570ParseError" = "RFC6570ParseError" as const;
  index: number;

  constructor(message: string, index: number) {
    super(message);
    this.index = index;
    // Maintains proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ParseError.prototype);
  }
}

export function err(_src: string, index: number, msg: string): ParseError {
  return new ParseError(`${msg} at ${index}`, index);
}
