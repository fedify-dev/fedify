import { NOT_IMPLEMENTED } from "./constants.ts";
import type { ExpandContext, Template } from "./types.ts";

/**
 * Parses an RFC 6570 URI template string into a {@link Template}.
 */
export function parseTemplate(template: string): Template {
  return new TemplateImpl(template);
}

class TemplateImpl implements Template {
  readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  expand(_context: ExpandContext): string {
    throw new Error(NOT_IMPLEMENTED);
  }
}
