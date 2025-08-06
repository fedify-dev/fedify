import { highlight } from "cli-highlight";

export function printJson(json: unknown): void {
  const formatted = JSON.stringify(json, null, 2);
  console.log(highlight(formatted, { language: "json" }));
}

export const colorEnabled: boolean = Deno.stdout.isTerminal() &&
  !Deno.env.has("NO_COLOR");

export function formatCliObjectOutputWithColor(
  obj: unknown,
  colors?: boolean,
): string {
  const enableColors = colors ?? colorEnabled;
  return Deno.inspect(obj, { colors: enableColors });
}
