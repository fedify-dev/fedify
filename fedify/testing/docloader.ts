import { getLogger } from "@logtape/logtape";
import type {
  DocumentLoaderOptions,
  RemoteDocument,
} from "../runtime/docloader.ts";

const logger = getLogger(["fedify", "testing", "docloader"]);

/**
 * A mock of the document loader.  This does not make any actual HTTP requests
 * towards the remote server, but looks up the local fixture files instead.
 *
 * For instance, `mockDocumentLoader("http://example.com/foo/bar")` will look up
 * the file `testing/fixtures/http/example.com/foo/bar` (no suffix) and return
 * its content as the response.
 */
export async function mockDocumentLoader(
  resource: string,
  _options?: DocumentLoaderOptions,
): Promise<RemoteDocument> {
  const url = new URL(resource);
  if (
    "navigator" in globalThis && navigator.userAgent === "Cloudflare-Workers"
  ) {
    const testUrl = new URL(url);
    testUrl.hostname += ".test";
    const resp = await fetch(testUrl);
    if (resp.ok) {
      const document = await resp.json();
      logger.debug(
        "Successfully fetched fixture {resource}: {status} {statusText}\n{body}",
        {
          resource,
          status: resp.status,
          statusText: resp.statusText,
          body: document,
        },
      );
      return { contextUrl: null, document, documentUrl: resource };
    }
    const error = await resp.text();
    logger.error("Failed to fetch fixture {resource}: {error}", {
      resource,
      error,
    });
    throw new Error(error);
  }
  const path = `./fixtures/${url.host}${url.pathname}.json`;
  // deno-lint-ignore no-explicit-any
  let document: any;
  try {
    document = (await import(path, { with: { type: "json" } })).default;
  } catch (error) {
    logger.error("Failed to read fixture file {path}: {error}", {
      path,
      error,
    });
    throw error;
  }
  return { contextUrl: null, document, documentUrl: resource };
}
