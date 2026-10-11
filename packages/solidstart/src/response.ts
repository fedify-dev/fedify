import type { ServerResponse } from "node:http";

export const NOT_ACCEPTABLE_BODY = "Not Acceptable";

const representationHeaders = [
  "content-length",
  "content-encoding",
  "content-range",
  "content-digest",
  "digest",
  "etag",
  "last-modified",
  "content-language",
  "content-location",
];

export function notAcceptableHeaders(
  original: Headers,
  eventHeaders: Headers,
): Headers {
  const headers = new Headers(original);
  for (const name of representationHeaders) {
    headers.delete(name);
    eventHeaders.delete(name);
  }
  const vary = [headers.get("vary"), eventHeaders.get("vary")]
    .filter((value) => value != null).join(", ");
  headers.set(
    "vary",
    vary.split(/,\s*/).some((v) => v === "*" || v.toLowerCase() === "accept")
      ? vary
      : [vary, "Accept"].filter(Boolean).join(", "),
  );
  headers.set("content-type", "text/plain");
  return headers;
}

/** Restore buffered error responses that skip SolidStart's response hook. */
export function interceptNotAcceptable(
  response: ServerResponse,
  cleanup: () => void,
): void {
  if (typeof response?.end !== "function") return;
  const originalEnd = response.end;
  const descriptor = Object.getOwnPropertyDescriptor(response, "end");
  let active = true;
  const restore = () => {
    if (!active) return;
    active = false;
    if (response.end === end) {
      if (descriptor == null) delete (response as Partial<ServerResponse>).end;
      else Object.defineProperty(response, "end", descriptor);
    }
    response.removeListener("close", restore);
    cleanup();
  };
  function end(this: ServerResponse, ...args: unknown[]): ServerResponse {
    const convert = active && this.statusCode === 404 &&
      !this.headersSent && !this.writableEnded;
    restore();
    if (!convert) return Reflect.apply(originalEnd, this, args);
    this.statusCode = 406;
    this.statusMessage = "Not Acceptable";
    const headers = new Headers();
    const vary = this.getHeader("vary");
    if (vary != null) {
      headers.set("vary", Array.isArray(vary) ? vary.join(", ") : String(vary));
    }
    const negotiated = notAcceptableHeaders(headers, new Headers());
    for (const name of representationHeaders) this.removeHeader(name);
    negotiated.forEach((value, name) => this.setHeader(name, value));
    const callback = args.at(-1);
    return Reflect.apply(originalEnd, this, [
      NOT_ACCEPTABLE_BODY,
      "utf8",
      typeof callback === "function" ? callback : undefined,
    ]);
  }
  response.end = end;
  response.once("close", restore);
}
