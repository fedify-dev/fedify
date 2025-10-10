/**
 * Error thrown when parsing an invalid RFC 6570 URI template.
 */
export class ParseError extends Error {
  /**
   * The error name, always "RFC6570ParseError".
   */
  override name: "RFC6570ParseError" = "RFC6570ParseError" as const;
  
  /**
   * The index in the template string where the error occurred.
   */
  index: number;

  /**
   * Create a new ParseError.
   * 
   * @param message - The error message
   * @param index - The index in the template string where the error occurred
   */
  constructor(message: string, index: number) {
    super(message);
    this.index = index;
    // Maintains proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ParseError.prototype);
  }
}

/**
 * Create a ParseError with a formatted message.
 * @internal
 */
export function err(_src: string, index: number, msg: string): ParseError {
  return new ParseError(`${msg} at ${index}`, index);
}
