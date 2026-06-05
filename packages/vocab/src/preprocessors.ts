import type { PropertyPreprocessor } from "@fedify/vocab-runtime";
import { Image, Link } from "./vocab.ts";

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
    url: link.href,
    mediaType: link.mediaType,
    names: link.names?.length != null && link.names.length > 0
      ? link.names
      : undefined,
    width: link.width,
    height: link.height,
  });
};
