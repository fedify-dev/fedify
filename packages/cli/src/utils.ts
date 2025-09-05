import { highlight } from "cli-highlight";

export const colorEnabled: boolean = Deno.stdout.isTerminal() &&
  !Deno.env.has("NO_COLOR");

export function formatObject(
  obj: unknown,
  colors?: boolean,
  json?: boolean,
): string {
  const enableColors = colors ?? colorEnabled;
  if (!json) return Deno.inspect(obj, { colors: enableColors });
  const formatted = JSON.stringify(obj, null, 2);
  if (enableColors) {
    return highlight(formatted, { language: "json" });
  }
  return formatted;
}
