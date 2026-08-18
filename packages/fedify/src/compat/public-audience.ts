import { getLogger } from "@logtape/logtape";
import { PUBLIC_COLLECTION } from "@fedify/vocab";

const logger = getLogger(["fedify", "compat", "public-audience"]);

/**
 * Rewrites the compact `as:Public` or `Public` CURIE in the `object` field of a
 * serialized Follow activity to the full ActivityStreams Public collection URI.
 *
 * Some ActivityPub implementations compare the field as a plain URL
 * without applying JSON-LD expansion, causing them to reject public-addressed
 * Follow activities that use a compact IRI. This helper works around that gap.
 */
export function normalizePublicFollowObject(
  jsonLd: unknown,
): unknown {
  if (typeof jsonLd !== "object" || jsonLd === null) {
    return jsonLd;
  }

  try {
    const record = jsonLd as Record<string, unknown>;
    if (
      record.type === "Follow" &&
      (record.object === "as:Public" || record.object === "Public")
    ) {
      const normalized = {
        ...record,
        object: PUBLIC_COLLECTION.href,
      };

      return normalized;
    }
  } catch (error) {
    logger.debug(
      "Failed to normalize public follow object; sending the activity as is.\n{error}",
      {
        error,
      },
    );
  }

  return jsonLd;
}
