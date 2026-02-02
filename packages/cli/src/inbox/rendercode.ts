import type { Activity } from "@fedify/vocab";
import { getStatusText } from "@poppanator/http-constants";
import { getContextLoader } from "../docloader.ts";

export async function renderRequest(request: Request): Promise<string> {
  // @ts-ignore: Work around `deno publish --dry-run` bug
  request = request.clone();
  const url = new URL(request.url);
  const statusLine = `${request.method} ${url.pathname + url.search}`;
  return await render(request, statusLine);
}

export async function renderResponse(response: Response): Promise<string> {
  response = response.clone();
  const statusLine = `${response.status} ${
    response.statusText === ""
      ? getStatusText(response.status)
      : response.statusText
  }`;
  return await render(response, statusLine);
}

async function render(
  requestOrResponse: Request | Response,
  statusLine: string,
): Promise<string> {
  let code = `${statusLine}\n`;
  for (const [key, value] of requestOrResponse.headers.entries()) {
    code += `${capitalize(key)}: ${value}\n`;
  }
  let body: string;
  try {
    body = await requestOrResponse.text();
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
