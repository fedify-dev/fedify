import type { Activity } from "@fedify/vocab";
import { getStatusText } from "@poppanator/http-constants";
import { getContextLoader } from "../docloader.ts";

export async function renderRequest(request: Request): Promise<string> {
  // @ts-ignore: Work around `deno publish --dry-run` bug
  request = request.clone();
  const url = new URL(request.url);
  let code = `${request.method} ${url.pathname + url.search}\n`;
  for (const [key, value] of request.headers.entries()) {
    code += `${capitalize(key)}: ${value}\n`;
  }
  let body: string;
  try {
    body = await request.text();
  } catch (_) {
    body = "[Failed to decode body; it may be binary.]";
  }
  code += `\n${body}`;
  return code;
}

export async function renderResponse(response: Response): Promise<string> {
  response = response.clone();
  let code = `${response.status} ${
    response.statusText === ""
      ? getStatusText(response.status)
      : response.statusText
  }\n`;
  for (const [key, value] of response.headers.entries()) {
    code += `${capitalize(key)}: ${value}\n`;
  }
  let body: string;
  try {
    body = await response.text();
  } catch (_) {
    body = "[Failed to decode body; it may be binary.]";
  }
  code += `\n${body}`;
  return code;
}

export async function renderRawActivity(request: Request): Promise<string> {
  // @ts-ignore: Work around `deno publish --dry-run` bug
  request = request.clone();
  try {
    const activity = await request.json();
    return JSON.stringify(activity, null, 2);
  } catch {
    return "[Failed to decode body; it may not be JSON.]";
  }
}

export async function renderActivity(
  activity: Activity,
  expand: boolean = false,
): Promise<string> {
  const contextLoader = await getContextLoader();
  const jsonLd = await activity.toJsonLd({
    contextLoader,
    format: expand ? "expand" : "compact",
  });
  return JSON.stringify(jsonLd, null, 2);
}

function capitalize(name: string): string {
  return name.replace(/(^|-)./g, (match) => match.toUpperCase());
}
