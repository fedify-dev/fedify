import type { PropertyPreprocessor } from "@fedify/vocab-runtime";
import { Image, Link } from "./vocab.ts";

/**
 * A property preprocessor that normalizes Link values to Image objects.
 *
 * When an `icon` or `image` property on a vocabulary object contains an
 * explicit ActivityStreams `Link` rather than an `Image`, this preprocessor
 * converts it into an `Image` by mapping `href` to `url`, copying
 * `mediaType`, `name`, `width`, `height`, and `digestMultibase`, and
 * discarding the rest.
 *
 * If the value is not a Link, or the Link has no `href`, it returns
 * `undefined` so the normal range decoder continues.
 * @since 2.3.0
 */
export const normalizeLinkToImage: PropertyPreprocessor<Image> = async (
  value,
  context,
) => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("@type" in value) ||
    !Array.isArray(value["@type"]) ||
    !value["@type"].includes("https://www.w3.org/ns/activitystreams#Link")
  ) {
    return undefined;
  }

  let link: Link;
  try {
    link = await Link.fromJsonLd(value, context);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }

  if (link.href == null) return undefined;

  return new Image({
    id: link.id,
    url: link.href,
    mediaType: link.mediaType,
    names: link.names != null && link.names.length > 0 ? link.names : undefined,
    width: link.width,
    height: link.height,
    digestMultibase: link.digestMultibase,
  });
};
