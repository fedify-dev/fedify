import type { Activity } from "@fedify/vocab";
import { getStatusText } from "@poppanator/http-constants";
import { getContextLoader } from "../docloader.ts";

export function renderRequest(request: Request): Promise<string> {
  // @ts-ignore: Work around `deno publish --dry-run` bug
  request = request.clone();
  const url = new URL(request.url);
  return render(
    `${request.method} ${url.pathname + url.search}`,
    request.headers,
    request,
  );
}

export function renderResponse(response: Response): Promise<string> {
  response = response.clone();
  const code = `${response.status} ${
    response.statusText === ""
      ? getStatusText(response.status)
      : response.statusText
  }`;
  return render(
    code,
    response.headers,
    response,
  );
}

async function render(
  code: string,
  headers: Headers,
  body: Body,
): Promise<string> {
  code += "\n";
  for (const [key, value] of headers.entries()) {
    code += `${capitalize(key)}: ${value}\n`;
  }
  const bodyText = await body.text().catch((_) =>
    "[Failed to decode body; it may be binary.]"
  );
  code += `\n${bodyText}`;
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
